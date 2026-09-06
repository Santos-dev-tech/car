'use strict';
/**
 * MotoKE - asset finance quotation + eligibility engine.
 *
 * Models how Kenyan vehicle asset finance is actually priced:
 *   - banks quote a reducing-balance rate; most micro-lenders quote flat
 *   - fees (processing, valuation, tracking, legal) are charged upfront or capitalised
 *   - comprehensive insurance year 1 is often financed alongside (IPF)
 *   - eligibility gates on income, DTI, deposit, vehicle age, employment type, CRB
 *
 * Every number a customer sees comes out of quote(); nothing is hard-coded in the UI.
 */

const round = (n) => Math.round(n);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Reducing-balance monthly instalment (standard amortisation). */
function pmtReducing(principal, annualRatePct, months) {
  if (months <= 0) return principal;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Flat-rate monthly instalment: interest computed on the original principal. */
function pmtFlat(principal, annualRatePct, months) {
  if (months <= 0) return principal;
  const interest = principal * (annualRatePct / 100) * (months / 12);
  return (principal + interest) / months;
}

/** Full amortisation table (always reducing-balance for display of a reducing loan). */
function schedule(principal, annualRatePct, months, rateType) {
  const rows = [];
  if (rateType === 'flat') {
    const inst = pmtFlat(principal, annualRatePct, months);
    const monthlyInterest = (principal * (annualRatePct / 100) * (months / 12)) / months;
    const monthlyPrincipal = principal / months;
    let bal = principal;
    for (let i = 1; i <= months; i++) {
      bal = Math.max(0, bal - monthlyPrincipal);
      rows.push({
        n: i,
        payment: round(inst),
        interest: round(monthlyInterest),
        principal: round(monthlyPrincipal),
        balance: round(bal),
      });
    }
    return rows;
  }
  const r = annualRatePct / 100 / 12;
  const inst = pmtReducing(principal, annualRatePct, months);
  let bal = principal;
  for (let i = 1; i <= months; i++) {
    const interest = bal * r;
    let principalPart = inst - interest;
    if (i === months) principalPart = bal;
    bal = Math.max(0, bal - principalPart);
    rows.push({ n: i, payment: round(inst), interest: round(interest), principal: round(principalPart), balance: round(bal) });
  }
  return rows;
}

/**
 * Effective APR via IRR on the real cashflows:
 *   t0: customer effectively receives (loan - fees paid out of pocket at drawdown)
 *   t1..tn: instalments
 * Bisection - robust, no derivative needed.
 */
function effectiveApr(netAdvance, instalment, months) {
  if (netAdvance <= 0 || months <= 0) return 0;
  const npv = (i) => {
    if (i === 0) return instalment * months - netAdvance;
    let s = 0;
    for (let t = 1; t <= months; t++) s += instalment / Math.pow(1 + i, t);
    return s - netAdvance;
  };
  // npv is monotonically decreasing in i: npv(lo) > 0 > npv(hi) brackets the root.
  let lo = 0;
  let hi = 1; // 100% per month - far beyond any real product
  if (npv(lo) <= 0) return 0; // instalments never repay the advance
  if (npv(hi) > 0) return hi * 12 * 100; // off the scale; clamp rather than lie
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

function feeBreakdown(lender, loanBase, price) {
  let processing = (loanBase * (lender.processing_fee_pct || 0)) / 100;
  if (lender.processing_fee_min) processing = Math.max(processing, lender.processing_fee_min);
  if (lender.processing_fee_max) processing = Math.min(processing, lender.processing_fee_max);
  const items = [];
  if (processing > 0) items.push({ label: 'Facility / processing fee', amount: round(processing) });
  if (lender.valuation_fee) items.push({ label: 'Valuation fee', amount: round(lender.valuation_fee) });
  if (lender.tracking_fee) items.push({ label: 'Tracking device', amount: round(lender.tracking_fee) });
  if (lender.legal_fee) items.push({ label: 'Legal / chattels registration', amount: round(lender.legal_fee) });
  const insurance = lender.insurance_rate_pct ? (price * lender.insurance_rate_pct) / 100 : 0;
  return { items, insurance: round(insurance) };
}

/** Age of the vehicle in years, as a lender counts it (current year - year of manufacture). */
function vehicleAge(vehicle, now = new Date()) {
  if (!vehicle || !vehicle.year) return 0;
  return now.getFullYear() - Number(vehicle.year);
}

/**
 * Produce a full quote for one lender.
 * @param lender  row from `lenders`
 * @param input   { price, deposit, tenorMonths, vehicle, applicant }
 *   applicant: { netIncome, obligations, employment, crbClean, age }
 */
function quote(lender, input) {
  const price = Number(input.price) || 0;
  const tenor = clamp(Number(input.tenorMonths) || lender.max_tenor_months, 1, 120);
  const minDeposit = round((price * (lender.min_deposit_pct || 0)) / 100);

  let deposit = Math.max(0, Math.round(Number(input.deposit) || 0));
  const depositShortfall = Math.max(0, minDeposit - deposit);
  const depositUsed = Math.max(deposit, minDeposit); // engine quotes at the lender's floor

  const loanBase = Math.max(0, price - depositUsed);
  const fees = feeBreakdown(lender, loanBase, price);
  const feeTotal = fees.items.reduce((s, f) => s + f.amount, 0);
  const insurance = fees.insurance;

  const capitalised = lender.capitalize_fees ? feeTotal : 0;
  const insuranceCapitalised = lender.insurance_financed ? insurance : 0;
  const principal = loanBase + capitalised + insuranceCapitalised;

  const rateType = lender.rate_type === 'flat' ? 'flat' : 'reducing';
  const instalment =
    rateType === 'flat'
      ? pmtFlat(principal, lender.annual_rate, tenor)
      : pmtReducing(principal, lender.annual_rate, tenor);

  const totalRepaid = instalment * tenor;

  /* Conditions of the facility that the BORROWER pays, on the day, in cash.
     A Kenyan lender requires a tracker fitted to its specification and its interest
     registered against the logbook with NTSA. Neither is optional and neither was in this
     figure, so "Cash on day one" — the number a customer plans around — was understating
     itself by roughly fifteen thousand shillings. Someone who saved exactly the deposit
     and arrived short was let down by our arithmetic, not by the lender. */
  const trackerFitting = Number(input.trackerFitting ?? 12000);
  const inchargeFee = Number(input.inchargeFee ?? 3500);
  const lenderConditions = trackerFitting + inchargeFee;

  const upfrontFees = feeTotal - capitalised + (insurance - insuranceCapitalised);
  const cashUpfront = depositUsed + upfrontFees + lenderConditions;
  const totalCost = cashUpfront + totalRepaid;
  const totalInterest = totalRepaid - principal;
  const apr = effectiveApr(loanBase - upfrontFees > 0 ? loanBase - upfrontFees : loanBase, instalment, tenor);

  // ---- eligibility ----
  const a = input.applicant || {};
  const netIncome = Number(a.netIncome) || 0;
  const obligations = Number(a.obligations) || 0;
  const disposable = Math.max(0, netIncome - obligations);
  const dti = netIncome > 0 ? ((instalment + obligations) / netIncome) * 100 : null;
  const age = vehicleAge(input.vehicle);

  const blockers = [];
  const warnings = [];
  const notes = [];

  if (depositShortfall > 0) {
    warnings.push(
      `Requires at least ${lender.min_deposit_pct}% deposit (KES ${minDeposit.toLocaleString()}) — quoted at that level, KES ${depositShortfall.toLocaleString()} above your figure.`
    );
  }
  if (tenor > lender.max_tenor_months) blockers.push(`Maximum tenor is ${lender.max_tenor_months} months.`);
  if (tenor < lender.min_tenor_months) blockers.push(`Minimum tenor is ${lender.min_tenor_months} months.`);
  if (principal < lender.min_loan) blockers.push(`Minimum facility is KES ${Number(lender.min_loan).toLocaleString()}.`);
  if (principal > lender.max_loan) blockers.push(`Maximum facility is KES ${Number(lender.max_loan).toLocaleString()}.`);

  if (netIncome > 0 && netIncome < lender.min_monthly_income) {
    blockers.push(`Requires net monthly income of at least KES ${Number(lender.min_monthly_income).toLocaleString()}.`);
  }
  if (dti != null && dti > lender.max_dti_pct) {
    blockers.push(
      `Repayment would be ${dti.toFixed(0)}% of your income; this lender caps total obligations at ${lender.max_dti_pct}%.`
    );
  } else if (dti != null && dti > lender.max_dti_pct - 8) {
    warnings.push(`Repayment sits at ${dti.toFixed(0)}% of income — close to this lender's ${lender.max_dti_pct}% ceiling.`);
  }

  if (input.vehicle && lender.max_vehicle_age_years && age > lender.max_vehicle_age_years) {
    blockers.push(`Will not finance vehicles older than ${lender.max_vehicle_age_years} years (this one is ${age}).`);
  }

  const allowedEmployment = safeJson(lender.allowed_employment, []);
  if (a.employment && allowedEmployment.length && !allowedEmployment.includes(a.employment)) {
    blockers.push(`Does not lend to applicants who are ${labelEmployment(a.employment)}.`);
  }
  const allowedConditions = safeJson(lender.allowed_conditions, []);
  if (input.vehicle && input.vehicle.condition && allowedConditions.length && !allowedConditions.includes(input.vehicle.condition)) {
    blockers.push(`Does not finance ${String(input.vehicle.condition).replace('_', ' ')} units.`);
  }
  if (lender.requires_clean_crb && a.crbClean === false) {
    blockers.push('Requires a clean CRB record.');
  }
  if (a.age) {
    const ageAtMaturity = Number(a.age) + tenor / 12;
    if (Number(a.age) < lender.min_age) blockers.push(`Minimum applicant age is ${lender.min_age}.`);
    if (ageAtMaturity > lender.max_age_at_maturity) {
      blockers.push(`Loan would mature past the maximum age of ${lender.max_age_at_maturity}.`);
    }
  }

  if (disposable > 0 && instalment > disposable) {
    warnings.push('Instalment exceeds your stated income less existing commitments.');
  }
  if (lender.bank_statement_months) notes.push(`${lender.bank_statement_months} months of bank statements required.`);
  notes.push(`Logbook held by ${lender.logbook_holder === 'lender' ? 'the lender until settlement' : 'you, with a charge registered'}.`);
  notes.push(`Indicative approval in ${lender.approval_days} working day${lender.approval_days === 1 ? '' : 's'}.`);

  // Largest instalment this applicant could carry with this lender, and the car price it implies.
  let maxAffordablePrice = null;
  if (netIncome > 0) {
    const maxInstalment = Math.max(0, (netIncome * lender.max_dti_pct) / 100 - obligations);
    if (maxInstalment > 0) {
      const r = lender.annual_rate / 100 / 12;
      let maxPrincipal;
      if (rateType === 'flat') {
        maxPrincipal = (maxInstalment * tenor) / (1 + (lender.annual_rate / 100) * (tenor / 12));
      } else if (r === 0) {
        maxPrincipal = maxInstalment * tenor;
      } else {
        maxPrincipal = (maxInstalment * (1 - Math.pow(1 + r, -tenor))) / r;
      }
      maxAffordablePrice = round(maxPrincipal / (1 - (lender.min_deposit_pct || 0) / 100));
    }
  }

  return {
    lenderId: lender.id,
    lender: {
      id: lender.id,
      name: lender.name,
      short_name: lender.short_name,
      type: lender.type,
      logo_text: lender.logo_text,
      color: lender.color,
      approval_days: lender.approval_days,
      requirements: safeJson(lender.requirements, []),
      notes: lender.notes,
    },
    rateType,
    annualRate: lender.annual_rate,
    price,
    depositRequested: deposit,
    deposit: depositUsed,
    depositPct: price ? +((depositUsed / price) * 100).toFixed(1) : 0,
    minDepositPct: lender.min_deposit_pct,
    depositShortfall,
    tenorMonths: tenor,
    loanBase: round(loanBase),
    principal: round(principal),
    fees: fees.items,
    feeTotal: round(feeTotal),
    insurance: round(insurance),
    insuranceFinanced: !!lender.insurance_financed,
    feesCapitalised: !!lender.capitalize_fees,
    upfrontFees: round(upfrontFees),
    lenderConditions: {
      trackerFitting: round(trackerFitting),
      inchargeFee: round(inchargeFee),
      total: round(lenderConditions),
      note: 'The lender requires a tracker fitted to its specification and its interest registered against the logbook. Both are paid by you, on the day.',
    },
    cashUpfront: round(cashUpfront),
    monthlyPayment: round(instalment),
    totalRepaid: round(totalRepaid),
    totalInterest: round(totalInterest),
    totalCost: round(totalCost),
    apr: +apr.toFixed(2),
    dti: dti == null ? null : +dti.toFixed(1),
    maxAffordablePrice,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    notes,
  };
}

/** Quote every lender, mark the best ones, sort. */
function compare(lenders, input, sortBy = 'monthly') {
  const quotes = lenders.map((l) => quote(l, input));
  const eligible = quotes.filter((q) => q.eligible);
  const rest = quotes.filter((q) => !q.eligible);

  const sorters = {
    monthly: (a, b) => a.monthlyPayment - b.monthlyPayment,
    total: (a, b) => a.totalCost - b.totalCost,
    deposit: (a, b) => a.cashUpfront - b.cashUpfront,
    rate: (a, b) => a.apr - b.apr,
    speed: (a, b) => a.lender.approval_days - b.lender.approval_days,
  };
  const sorter = sorters[sortBy] || sorters.monthly;
  eligible.sort(sorter);
  rest.sort(sorter);

  if (eligible.length) {
    const byMonthly = [...eligible].sort(sorters.monthly)[0];
    const byTotal = [...eligible].sort(sorters.total)[0];
    const bySpeed = [...eligible].sort(sorters.speed)[0];
    const byUpfront = [...eligible].sort(sorters.deposit)[0];
    byMonthly.badges = [...(byMonthly.badges || []), 'Lowest monthly'];
    byTotal.badges = [...(byTotal.badges || []), 'Cheapest overall'];
    bySpeed.badges = [...(bySpeed.badges || []), 'Fastest approval'];
    byUpfront.badges = [...(byUpfront.badges || []), 'Least cash upfront'];
  }
  return { offers: [...eligible, ...rest], eligibleCount: eligible.length, total: quotes.length };
}

function safeJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function labelEmployment(k) {
  return (
    {
      employed: 'in permanent employment',
      contract: 'on contract',
      self_employed: 'self-employed',
      business: 'business owners',
      gig: 'gig / informal earners',
    }[k] || k
  );
}

module.exports = { quote, compare, schedule, pmtReducing, pmtFlat, effectiveApr, vehicleAge, safeJson };
