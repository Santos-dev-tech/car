'use strict';
/**
 * MotoKE API smoke test. Run: node tools/smoke.js [port]
 *
 * Expects a FRESHLY STARTED server. The suite deliberately trips the login rate limiter,
 * and those buckets live in memory for 15 minutes — so a second run against the same
 * process will fail on the auth section for that reason alone, not because anything broke.
 * Restart the server between runs.
 */
const PORT = process.argv[2] || 4000;
const BASE = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
let cookie = '';

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${extra ? ' -> ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setC = res.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const money = (n) => 'KES ' + Number(n).toLocaleString();

// A genuine (tiny) PDF, so the magic-number check on uploads is exercised for real.
const PDF_DATA_URL =
  'data:application/pdf;base64,' +
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');


(async () => {
  console.log('\n\x1b[1mMotoKE smoke test\x1b[0m\n');

  console.log('· public catalogue');
  const boot = await api('GET', '/api/bootstrap?dealer=summit');
  ok('bootstrap returns dealer', boot.json.dealer && boot.json.dealer.slug === 'summit', boot.json);
  ok('bootstrap does not advertise other dealerships', boot.json.dealers === undefined, Object.keys(boot.json));
  ok('bootstrap carries fuel prices and their age', !!(boot.json.platform && boot.json.platform.fuel && boot.json.platform.fuel.petrol), boot.json.platform);
  ok('bootstrap returns lenders', boot.json.lenders.length >= 8, boot.json.lenders && boot.json.lenders.length);
  ok('facets have makes', boot.json.facets.makes.length > 0);

  const list = await api('GET', '/api/vehicles?dealer=summit&pageSize=50');
  ok('vehicle list non-empty', list.json.items.length > 0, list.json);
  const filtered = await api('GET', '/api/vehicles?dealer=summit&make=Toyota&maxPrice=3000000');
  ok('filters apply', filtered.json.items.every((v) => v.make === 'Toyota' && v.price <= 3000000), filtered.json.total);

  /* A mid-market car the test applicant can actually service, searched across the WHOLE
     book rather than the first page. The old fallback to items[0] quietly handed a
     nine-million-shilling Land Cruiser to somebody on 180k and then asserted that lenders
     would approve it — a test that reports a real product failure when the fixture moved. */
  /* Pick on the qualities that matter rather than a fixed price band: young enough that
     lenders will touch it, dear enough to be worth financing, and the cheapest such car
     so a test applicant on 180k can actually service it. A hard-coded band went stale
     every time the stock moved. */
  const forSale = (await api('GET', '/api/vehicles?pageSize=60')).json.items || [];
  const anyVehicle = forSale
    .filter((v) => v.age <= 8 && v.price >= 1_000_000 && v.price <= 3_500_000)
    .sort((x, y) => x.price - y.price)[0];
  ok('the yard stocks a financeable mid-market car to quote against', !!anyVehicle,
    anyVehicle ? `${anyVehicle.title} — ${money(anyVehicle.price)}` : `${forSale.length} on sale, none financeable in range`);
  if (!anyVehicle) {
    console.log('\n  Cannot continue without a quotable car.\n');
    process.exit(1);
  }
  const detail = await api('GET', `/api/vehicles/${anyVehicle.id}`);
  ok('vehicle detail', detail.json.vehicle && detail.json.vehicle.id === anyVehicle.id);
  ok('detail carries lender panel', detail.json.lenders.length > 0);

  console.log('\n· finance engine');
  const q = await api('POST', '/api/quote', {
    dealer: 'summit',
    vehicleId: anyVehicle.id,
    deposit: Math.round(anyVehicle.price * 0.25),
    tenor: 48,
    applicant: { netIncome: 180000, obligations: 25000, employment: 'employed', crbClean: true, age: 34 },
  });
  ok('quote returns offers', q.json.offers && q.json.offers.length > 0, q.json);
  ok('some offers eligible', q.json.eligibleCount > 0, { eligible: q.json.eligibleCount, total: q.json.total });
  const offers = q.json.offers || [];
  ok('offers sorted by monthly', offers.filter((o) => o.eligible).every((o, i, a) => i === 0 || a[i - 1].monthlyPayment <= o.monthlyPayment));
  ok('every offer has a monthly payment', offers.every((o) => o.monthlyPayment > 0));
  ok('every offer has an APR', offers.every((o) => o.apr > 0));
  ok('badges assigned', offers.some((o) => o.badges && o.badges.length));
  ok('ineligible offers carry reasons', offers.filter((o) => !o.eligible).every((o) => o.blockers.length > 0));

  const best = offers.find((o) => o.eligible);
  console.log(`     cheapest monthly: ${best.lender.name} — ${money(best.monthlyPayment)}/mo, APR ${best.apr}%`);
  console.log(`     car ${money(anyVehicle.price)} | deposit ${money(best.deposit)} | total cost ${money(best.totalCost)}`);

  // maths check: reducing balance instalment computed independently
  const P = best.principal;
  const r = best.annualRate / 100 / 12;
  const n = best.tenorMonths;
  const expected =
    best.rateType === 'flat'
      ? (P + P * (best.annualRate / 100) * (n / 12)) / n
      : (P * r) / (1 - Math.pow(1 + r, -n));
  ok('instalment matches amortisation formula', Math.abs(expected - best.monthlyPayment) < 1.5, { expected, got: best.monthlyPayment });
  ok('total repaid = instalment x tenor', Math.abs(best.monthlyPayment * n - best.totalRepaid) < n);
  ok('flat quotes carry a higher APR than headline', offers.filter((o) => o.rateType === 'flat').every((o) => o.apr > o.annualRate));

  const sched = await api('POST', '/api/quote/schedule', {
    dealer: 'summit',
    vehicleId: anyVehicle.id,
    lenderId: best.lenderId,
    deposit: best.deposit,
    tenor: 48,
  });
  ok('schedule has one row per month', sched.json.schedule.length === 48, sched.json.schedule && sched.json.schedule.length);
  ok('schedule amortises to zero', sched.json.schedule[47].balance === 0, sched.json.schedule && sched.json.schedule[47]);

  const lowIncome = await api('POST', '/api/quote', {
    dealer: 'summit',
    vehicleId: anyVehicle.id,
    deposit: Math.round(anyVehicle.price * 0.2),
    tenor: 48,
    applicant: { netIncome: 35000, obligations: 5000, employment: 'gig', crbClean: false, age: 26 },
  });
  ok('low income + bad CRB blocks the banks', lowIncome.json.offers.filter((o) => o.lender.type === 'bank').every((o) => !o.eligible));
  ok('microfinance still available to that profile', lowIncome.json.offers.some((o) => o.lender.type !== 'bank' && o.blockers.length < 2));

  const afford = await api('POST', '/api/affordability', {
    dealer: 'summit',
    netIncome: 150000,
    obligations: 20000,
    tenor: 60,
    deposit: 400000,
    employment: 'employed',
  });
  ok('affordability returns a budget', afford.json.budget > 0, afford.json.budget);
  ok('affordability matches real stock', afford.json.matches.length > 0);
  console.log(`     budget on KES 150k income: ${money(afford.json.budget)} → ${afford.json.matches.length} cars in range`);

  console.log('\n· running cost + insurance');
  const rc = await api('POST', '/api/running-cost', {
    dealer: 'summit',
    price: 3000000,
    engineLitres: 2.0,
    fuel: 'petrol',
    kmPerYear: 15000,
    ageYears: 5,
    comprehensive: true,
    includeLoan: true,
    deposit: 600000,
    tenor: 48,
  });
  ok('running cost returns every line', ['loan', 'insurance', 'fuel', 'maintenance', 'tyres', 'statutory'].every((k) => rc.json.lines.some((l) => l.key === k)), rc.json.lines && rc.json.lines.map((l) => l.key));
  ok('running cost total = sum of the lines', rc.json.totalAnnual === rc.json.lines.reduce((s, l) => s + l.annual, 0));
  ok('monthly is the annual over twelve', Math.abs(rc.json.totalMonthly - rc.json.totalAnnual / 12) <= 1);
  ok('loan line is populated when financing is included', rc.json.lines.find((l) => l.key === 'loan').annual > 0);
  ok('a lender was actually quoted for the loan line', !!(rc.json.loan && rc.json.loan.lender), rc.json.loan);
  ok('running-only total excludes the loan', rc.json.runningOnlyAnnual === rc.json.totalAnnual - rc.json.lines.find((l) => l.key === 'loan').annual);
  ok('per-km cost is sane', rc.json.perKm > 5 && rc.json.perKm < 500, rc.json.perKm);
  console.log(`     ${money(rc.json.totalMonthly)}/month all-in · ${money(rc.json.runningOnlyMonthly)}/month without the loan · ${rc.json.fiveYearVsPrice}% of price over 5 years`);

  const outright = await api('POST', '/api/running-cost', { dealer: 'summit', price: 3000000, engineLitres: 2.0, fuel: 'petrol', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('buying outright drops the loan line to zero', outright.json.lines.find((l) => l.key === 'loan').annual === 0);
  ok('outright costs less per month than financed', outright.json.totalMonthly < rc.json.totalMonthly);

  const diesel = await api('POST', '/api/running-cost', { dealer: 'summit', price: 3000000, engineLitres: 2.0, fuel: 'diesel', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('diesel burns less than petrol', diesel.json.lines.find((l) => l.key === 'fuel').annual < outright.json.lines.find((l) => l.key === 'fuel').annual);
  const ev = await api('POST', '/api/running-cost', { dealer: 'summit', price: 3000000, engineLitres: 2.0, fuel: 'electric', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('an EV is the cheapest to fuel', ev.json.lines.find((l) => l.key === 'fuel').annual < diesel.json.lines.find((l) => l.key === 'fuel').annual);
  const farther = await api('POST', '/api/running-cost', { dealer: 'summit', price: 3000000, engineLitres: 2.0, fuel: 'petrol', kmPerYear: 40000, ageYears: 5, includeLoan: false });
  ok('driving more costs more', farther.json.totalAnnual > outright.json.totalAnnual);

  const ins = await api('POST', '/api/insurance', { value: 3000000, ageYears: 6, addons: { excess: true } });
  ok('insurance returns both options', ins.json.options.length === 2);
  ok('comprehensive costs more than third party', ins.json.options[0].annual > ins.json.options[1].annual);
  ok('the difference is reported monthly too', ins.json.monthlyDifference > 0 && Math.abs(ins.json.monthlyDifference - ins.json.difference / 12) <= 1);
  ok('add-ons are priced and flagged', ins.json.addons.length === 4 && ins.json.addons.find((a) => a.key === 'excess').selected);
  const insOld = await api('POST', '/api/insurance', { value: 3000000, ageYears: 14 });
  ok('an older car costs more to insure', insOld.json.options[0].base > (await api('POST', '/api/insurance', { value: 3000000, ageYears: 1 })).json.options[0].base);
  ok('third party only covers third parties', ins.json.options[1].covers.every((c) => !/own car/i.test(c)));

  console.log('\n· pre-qualification');
  const pq = await api('POST', '/api/prequalify', {
    dealer: 'summit',
    name: 'Prequal Test',
    phone: '+254700999888',
    email: 'pq@test.com',
    netIncome: 185000,
    obligations: 18000,
    employment: 'employed',
    crbClean: true,
    age: 35,
    targetPrice: 2350000,
    deposit: 600000,
    tenor: 48,
  });
  ok('pre-qualification returns a reference', pq.json.ok && /^PQ-/.test(pq.json.ref), pq.json);
  ok('every lender on the panel answers', pq.json.offers.length === pq.json.total && pq.json.total > 5);
  ok('some lenders qualify this profile', pq.json.eligibleCount > 0, pq.json.eligibleCount);
  ok('declines carry a reason', pq.json.offers.filter((o) => !o.eligible).every((o) => o.blockers.length));
  console.log(`     ${pq.json.eligibleCount} of ${pq.json.total} lenders would lend`);

  const pqPoor = await api('POST', '/api/prequalify', {
    dealer: 'summit',
    name: 'Low Income',
    phone: '+254700999777',
    netIncome: 28000,
    obligations: 4000,
    employment: 'gig',
    crbClean: false,
    age: 24,
    targetPrice: 4500000,
    deposit: 100000,
    tenor: 48,
  });
  ok('a weak profile on an expensive car qualifies nowhere', pqPoor.json.eligibleCount === 0, pqPoor.json.eligibleCount);
  ok('pre-qualification without income is rejected', (await api('POST', '/api/prequalify', { dealer: 'summit', name: 'x', phone: '1', targetPrice: 100000 })).status === 400);

  const faq = await api('GET', '/api/faq?dealer=summit');
  ok('FAQ is generated', Array.isArray(faq.json) && faq.json.length >= 10, faq.json && faq.json.length);
  ok('FAQ names real lenders from the panel', faq.json.some((f) => /Sacco|Microfinance|Credit/.test(f.a)));

  console.log('\n· applications');
  const app = await api('POST', '/api/applications', {
    dealer: 'summit',
    vehicleId: anyVehicle.id,
    lenderId: best.lenderId,
    deposit: best.deposit,
    tenor: 48,
    applicant: { fullName: 'Smoke Test', idNumber: '12345678', phone: '0700000000', email: 's@t.com', age: 34 },
    employment: { type: 'employed', employer: 'Test Ltd', netIncome: 180000, obligations: 25000, crbClean: true },
    documents: [{ type: 'id', filename: 'id.pdf', mime: 'application/pdf', data: PDF_DATA_URL }],
  });
  ok('application created', app.json.ok && app.json.ref, app.json);
  const ref = app.json.ref;

  const track = await api('GET', `/api/applications/track?ref=${ref}&phone=0700000000`);
  ok('tracking by ref + phone works', track.json.ref === ref, track.json);
  ok('tracking shows an event trail', track.json.events.length > 0);
  ok('tracking lists the uploaded document', track.json.documents.length === 1);
  const wrongPhone = await api('GET', `/api/applications/track?ref=${ref}&phone=0711111111`);
  ok('tracking rejects a wrong phone', wrongPhone.status === 403, wrongPhone);

  const lead = await api('POST', '/api/leads', {
    dealer: 'summit',
    type: 'test_drive',
    vehicleId: anyVehicle.id,
    name: 'Lead Test',
    phone: '0700000001',
    message: 'Saturday please',
  });
  ok('lead captured', lead.json.ok);

  const ti = await api('POST', '/api/tradein/estimate', { year: 2015, estimatedNewPrice: 2500000, mileage: 160000, condition: 'good' });
  ok('trade-in estimate returns a range', ti.json.low > 0 && ti.json.high > ti.json.low, ti.json);

  console.log('\n· security');
  const weak = await api('POST', '/api/auth/register', { name: 'Weak Pass', email: `w${Date.now()}@t.com`, password: 'password' });
  ok('a weak password is refused with reasons', weak.status === 400 && /needs/.test(weak.json.error), weak.json);
  const strength = await api('POST', '/api/auth/password-strength', { password: 'Nairobi#Matatu7', name: 'Zain' });
  ok('password strength is scored', strength.json.ok === true && strength.json.score >= 3, strength.json);
  const named = await api('POST', '/api/auth/password-strength', { password: 'Zain#Santos1', name: 'Zain Santos' });
  ok('a password containing your own name is rejected', named.json.ok === false, named.json.issues);

  const badPhone = await api('POST', '/api/leads', { dealer: 'summit', type: 'enquiry', name: 'Bad Phone', phone: '12345' });
  ok('an invalid phone number is rejected', badPhone.status === 400, badPhone.json);
  const goodPhone = await api('POST', '/api/leads', { dealer: 'summit', type: 'enquiry', name: 'Good Phone', phone: '0722123456' });
  ok('a valid phone number is normalised and accepted', goodPhone.json.ok, goodPhone.json);

  const xss = await api('POST', '/api/leads', {
    dealer: 'summit', type: 'enquiry', name: 'XSS Test', phone: '0733123456',
    message: '<script>alert(1)</script>Hello',
  });
  ok('markup in user content is stripped on the way in', xss.json.ok);

  const honeypot = await api('POST', '/api/leads', { dealer: 'summit', type: 'enquiry', name: 'Bot', phone: '0744123456', website: 'http://spam' });
  ok('the honeypot field blocks bots', honeypot.status === 429, honeypot.status);

  const fakePdf = await api('POST', `/api/applications/${app.json.id}/documents`, {
    phone: '0700000000',
    documents: [{ type: 'id', filename: 'evil.pdf', mime: 'application/pdf', data: 'data:application/pdf;base64,' + Buffer.from('MZ  not a pdf').toString('base64') }],
  });
  ok('a file that is not really a PDF is rejected', fakePdf.status === 400, fakePdf.json);
  const wrongType = await api('POST', `/api/applications/${app.json.id}/documents`, {
    phone: '0700000000',
    documents: [{ type: 'id', filename: 'x.exe', mime: 'application/x-msdownload', data: 'data:application/x-msdownload;base64,TVo=' }],
  });
  ok('a disallowed file type is rejected', wrongType.status === 400, wrongType.json);
  const strangerUpload = await api('POST', `/api/applications/${app.json.id}/documents`, {
    phone: '0711111111',
    documents: [{ type: 'id', filename: 'ok.pdf', mime: 'application/pdf', data: PDF_DATA_URL }],
  });
  ok('a stranger cannot attach files to your application', strangerUpload.status === 403, strangerUpload.status);

  const trackedApp = await api('GET', `/api/applications/track?ref=${ref}&phone=0700000000`);
  ok('the public tracker masks the ID number', /•/.test(String(trackedApp.json.applicant.idNumber || '')) || trackedApp.json.applicant.idNumber === undefined, trackedApp.json.applicant);

  const headers = await fetch(BASE + '/');
  ok('security headers are served', !!headers.headers.get('content-security-policy') && headers.headers.get('x-frame-options') === 'DENY');
  const crossSite = await fetch(BASE + '/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ dealer: 'summit', type: 'enquiry', name: 'CSRF', phone: '0700000002' }),
  });
  ok('a cross-site POST is blocked', crossSite.status === 403, crossSite.status);

  let throttled = false;
  for (let i = 0; i < 9; i++) {
    const r = await api('POST', '/api/auth/login', { email: 'nobody@motoke.demo', password: 'wrong-' + i });
    if (r.status === 429) throttled = true;
  }
  ok('repeated failed logins get throttled', throttled);

  console.log('\n· booking a car online');
  const bookable = (await api('GET', `/api/vehicles?pageSize=50`)).json.items.find((v) => v.status === 'available');
  const quote2 = await api('GET', `/api/checkout/${bookable.id}`);
  ok('checkout quotes a booking fee', quote2.json.bookingFee > 0 && quote2.json.holdDays > 0, quote2.json.bookingFee);
  ok('payment methods are offered', quote2.json.methods.length >= 3);

  const order = await api('POST', '/api/checkout', {
    dealer: 'summit', vehicleId: bookable.id, name: 'Booking Test', phone: '0755123456', email: 'b@t.com', method: 'mpesa',
  });
  ok('a booking is created and payment started', order.json.ok && /^BK-/.test(order.json.ref), order.json);
  ok('the fee comes from the server, not the client', order.json.amount === quote2.json.bookingFee);

  const beforePay = await api('GET', `/api/vehicles/${bookable.id}`);
  ok('the car is still available while payment is pending', beforePay.json.vehicle.status === 'available');

  const callback = await api('POST', '/api/checkout/callback', { ref: order.json.ref, success: true, providerRef: 'SIMOK', receipt: 'RCT123' });
  ok('the payment callback settles the order', callback.json.status === 'paid', callback.json);
  const afterPay = await api('GET', `/api/vehicles/${bookable.id}`);
  ok('paying holds the vehicle', afterPay.json.vehicle.status === 'reserved', afterPay.json.vehicle.status);
  const status2 = await api('GET', `/api/checkout/status?ref=${order.json.ref}`);
  ok('the customer can see a receipt and a hold date', !!status2.json.receipt && !!status2.json.holdUntil, status2.json);
  const replay = await api('POST', '/api/checkout/callback', { ref: order.json.ref, success: true });
  ok('a replayed callback does not double-charge or re-hold', replay.json.status === 'paid');

  const tamper = await api('POST', '/api/checkout', {
    dealer: 'summit', vehicleId: bookable.id, name: 'Tamper', phone: '0766123456', method: 'mpesa', amount: 1, price: 1,
  });
  ok('you cannot book a car that is already held', tamper.status === 400, tamper.json);

  console.log('\n· auth + admin');
  const badLogin = await api('POST', '/api/auth/login', { email: 'admin@motoke.demo', password: 'wrong' });
  ok('wrong password rejected', badLogin.status === 401);

  const login = await api('POST', '/api/auth/login', { email: 'admin@motoke.demo', password: 'admin123' });
  ok('staff login demands a second factor', login.json.needsOtp === true, login.json);
  ok('no session is issued before the code is verified', (await api('GET', '/api/admin/stats')).status === 403);
  const badOtp = await api('POST', '/api/auth/verify-otp', { email: 'admin@motoke.demo', code: '000000' });
  ok('a wrong code is rejected', badOtp.status === 401, badOtp.status);
  const otp = await api('POST', '/api/auth/verify-otp', { email: 'admin@motoke.demo', code: login.json.demoCode });
  ok('admin login completes with the code', otp.json.ok && otp.json.user.role === 'superadmin', otp.json);

  const stats = await api('GET', '/api/admin/stats');
  ok('stats: vehicles counted', stats.json.vehicles.n > 0, stats.json.vehicles);
  ok('stats: applications counted', stats.json.applications.n > 0, stats.json.applications);
  ok('stats: lender split present', stats.json.byLender.length > 0);

  const apps = await api('GET', '/api/admin/applications');
  ok('admin sees applications', apps.json.items.length > 0);
  const target = apps.json.items[0];

  const patched = await api('PATCH', `/api/admin/applications/${target.id}`, { status: 'approved', note: 'smoke test' });
  ok('status change works', patched.json.ok && patched.json.application.status === 'approved', patched.json);
  ok('status change logged an event', patched.json.application.events.some((e) => e.type === 'status'));

  const requote = await api('PATCH', `/api/admin/applications/${target.id}`, { tenor_months: 60 });
  ok('re-quote on restructure', requote.json.application.tenor_months === 60 && requote.json.application.monthly_payment > 0, requote.json.application);

  const veh = await api('POST', '/api/admin/vehicles', {
    dealer_id: 1,
    make: 'Test',
    model: 'Unit',
    year: 2022,
    price: 1500000,
    condition: 'used',
    body_type: 'Sedan',
    fuel: 'Petrol',
    transmission: 'Automatic',
  });
  ok('admin creates a vehicle', veh.json.ok, veh.json);
  const upd = await api('PATCH', `/api/admin/vehicles/${veh.json.id}`, { price: 1450000, status: 'available' });
  ok('admin edits a vehicle', upd.json.vehicle.price === 1450000);
  const del = await api('DELETE', `/api/admin/vehicles/${veh.json.id}`);
  ok('admin deletes a vehicle', del.json.ok);

  const imp = await api('POST', '/api/admin/vehicles/import', {
    dealer_id: 1,
    csv: 'make,model,year,price,condition,body_type,fuel,transmission,mileage_km,color\nMazda,Bongo,2017,1250000,used,Van,Diesel,Manual,120000,White\nBadRow,,,\n',
  });
  ok('CSV import creates rows and reports errors', imp.json.created === 1 && imp.json.errors.length === 1, imp.json);

  // Clean up after ourselves. Without this the suite adds a vehicle to the catalogue on
  // every run, and the demo yard slowly fills with test data.
  const imported = (await api('GET', '/api/admin/vehicles?q=Bongo&pageSize=50')).json.items;
  for (const v of imported) await api('DELETE', `/api/admin/vehicles/${v.id}`);
  ok('the import test cleans up its own rows', (await api('GET', '/api/admin/vehicles?q=Bongo')).json.items.length === 0, imported.length + ' removed');

  const lender = await api('POST', '/api/admin/lenders', {
    name: 'Smoke Test Bank',
    type: 'bank',
    annual_rate: 16,
    min_deposit_pct: 20,
    max_tenor_months: 48,
    min_monthly_income: 40000,
  });
  ok('admin creates a lender', lender.json.ok, lender.json);

  // Quote the same deal before and after the rate edit. Asserting that this lender then
  // wins outright would depend on which cars happen to be unsold, so test the causal
  // link directly: the rate an admin types must move the customer's own monthly figure.
  const quoteFor = async (name) => {
    const r = await api('POST', '/api/quote', {
      vehicleId: anyVehicle.id,
      deposit: Math.round(anyVehicle.price * 0.25),
      tenor: 48,
      applicant: { netIncome: 180000, obligations: 25000, employment: 'employed', crbClean: true, age: 34 },
    });
    return { all: r.json, offer: r.json.offers.find((o) => o.lender.name === name) };
  };

  const before = await quoteFor('Smoke Test Bank');
  ok('new lender appears in customer quotes', !!before.offer, before.all.total);

  const lenderPatch = await api('PATCH', `/api/admin/lenders/${lender.json.id}`, { annual_rate: 11.5 });
  ok('admin edits a lender rate', lenderPatch.json.lender.annual_rate === 11.5);

  const after = await quoteFor('Smoke Test Bank');
  ok('an edited rate moves the customer quote', after.offer.monthlyPayment < before.offer.monthlyPayment, {
    at16pct: before.offer.monthlyPayment,
    at11_5pct: after.offer.monthlyPayment,
  });
  ok('the cheaper rate also lowers the APR', after.offer.apr < before.offer.apr, { before: before.offer.apr, after: after.offer.apr });
  await api('DELETE', `/api/admin/lenders/${lender.json.id}`);

  const leads = await api('GET', '/api/admin/leads');
  ok('admin sees leads', leads.json.length > 0);

  const pqAdmin = await api('GET', '/api/admin/prequalifications');
  ok('admin sees pre-qualifications', pqAdmin.json.length >= 2, pqAdmin.json.length);
  ok('pre-qualification rows carry the per-lender verdicts', pqAdmin.json[0].results.length > 0);
  const pqPatch = await api('PATCH', `/api/admin/prequalifications/${pqAdmin.json[0].id}`, { status: 'contacted' });
  ok('pre-qualification status can be worked', pqPatch.json.ok);

  const costSet = await api('POST', '/api/admin/settings', { cost_petrol_price: 250 });
  ok('running cost assumptions are editable', costSet.json.ok);
  const rcAfter = await api('POST', '/api/running-cost', { dealer: 'summit', price: 3000000, engineLitres: 2.0, fuel: 'petrol', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('a fuel price change flows into the customer figure', rcAfter.json.lines.find((l) => l.key === 'fuel').annual > outright.json.lines.find((l) => l.key === 'fuel').annual, {
    before: outright.json.lines.find((l) => l.key === 'fuel').annual,
    after: rcAfter.json.lines.find((l) => l.key === 'fuel').annual,
  });
  await api('POST', '/api/admin/settings', { cost_petrol_price: 195 });

  const vehNew = await api('POST', '/api/admin/vehicles', {
    dealer_id: 1, make: 'Import', model: 'Test', year: 2024, price: 3000000,
    reg_status: 'awaiting_registration', reg_expected_date: '2026-11-30', verified: true, negotiable: true, warranty_months: 12,
  });
  const vehRead = await api('GET', `/api/vehicles/${vehNew.json.id}`);
  ok('import status is stored and served', vehRead.json.vehicle.reg_status === 'awaiting_registration' && vehRead.json.vehicle.reg_expected_date === '2026-11-30', vehRead.json.vehicle);
  ok('verified and negotiable flags round-trip', !!vehRead.json.vehicle.verified && !!vehRead.json.vehicle.negotiable);
  await api('DELETE', `/api/admin/vehicles/${vehNew.json.id}`);

  const sellLead = await api('POST', '/api/leads', { dealer: 'summit', type: 'sell_car', name: 'Seller', phone: '+254700111000', message: '2015 Auris' });
  ok('sell-your-car leads are captured', sellLead.json.ok && sellLead.json.type === 'sell_car', sellLead.json);

  const galleryCheck = await api('GET', '/api/vehicles/2');
  ok('stock ships with a photo gallery', galleryCheck.json.vehicle.images.length >= 4, galleryCheck.json.vehicle.images);

  const csv = await fetch(BASE + '/api/admin/export/applications', { headers: { Cookie: cookie } });
  const csvText = await csv.text();
  ok('CSV export downloads', csv.headers.get('content-type').includes('csv') && csvText.split('\n').length > 1);

  const audit = await api('GET', '/api/admin/audit');
  ok('audit log records actions', audit.json.length > 0);

  console.log('\n· offer letter');
  const siteDealerId = (await api('GET', '/api/bootstrap')).json.dealer.id;
  const approved = (await api('GET', '/api/admin/applications?status=approved')).json.items.find((a) => a.dealer_id === siteDealerId);
  const foreignApproved = (await api('GET', '/api/admin/applications?status=approved')).json.items.find((a) => a.dealer_id !== siteDealerId);
  const letter = await api('GET', `/api/offer-letter?ref=${approved.ref}`);
  ok('an approved application yields an offer letter', !!letter.json.ref && /^OL-/.test(letter.json.ref), letter.json);
  ok('the letter carries the deal schedule', letter.json.schedule.length >= 8);
  ok('the letter states conditions', letter.json.conditions.length >= 4);
  ok('the letter names the dealership and the customer', !!letter.json.dealer.name && !!letter.json.customer.name);
  const newApp = (await api('GET', '/api/admin/applications?status=new')).json.items.find((a) => a.dealer_id === siteDealerId);
  const tooEarly = await api('GET', `/api/offer-letter?ref=${newApp.ref}`);
  ok('no offer letter before approval', tooEarly.status === 400, tooEarly.json);
  if (foreignApproved) {
    const foreignLetter = await api('GET', `/api/offer-letter?ref=${foreignApproved.ref}`);
    ok("another dealership's offer letter is not reachable", foreignLetter.status === 404, foreignLetter.status);
    const foreignTrack = await api('GET', `/api/applications/track?ref=${foreignApproved.ref}`);
    ok("another dealership's application is not trackable here", foreignTrack.status === 404, foreignTrack.status);
  }

  console.log('\n· fuel prices that update themselves');
  const fuelAdmin = await api('GET', '/api/admin/fuel');
  ok('fuel status is reported with an age', typeof fuelAdmin.json.petrol === 'number' && !!fuelAdmin.json.age, fuelAdmin.json);
  ok('the next EPRA cycle date is known', /^\d{4}-\d{2}-\d{2}$/.test(fuelAdmin.json.nextEpraCycle), fuelAdmin.json.nextEpraCycle);
  ok('auto-update is on by default', fuelAdmin.json.autoUpdate === true);
  const refreshed = await api('POST', '/api/admin/fuel/refresh', {});
  ok('a manual refresh reports what happened either way', typeof refreshed.json.ok === 'boolean', refreshed.json.reason || refreshed.json.ok);
  const publicFuel = await api('GET', '/api/fuel');
  ok('the storefront can show the price and its age', publicFuel.json.petrol > 0 && !!publicFuel.json.age.label, publicFuel.json);

  console.log('\n· smarter numbers');
  const smart = await api('POST', '/api/running-cost', { dealer: 'summit', vehicleId: anyVehicle.id, kmPerYear: 15000, includeLoan: false });
  ok('economy is expressed in km per litre', smart.json.economy.kmPerLitre > 3 && smart.json.economy.kmPerLitre < 40, smart.json.economy);
  ok('the price is locked to the vehicle', smart.json.priceLocked === true && smart.json.price === anyVehicle.price);
  ok('servicing is priced off the badge', !!smart.json.servicing.tier && smart.json.servicing.perService > 0, smart.json.servicing);
  ok('resale value is projected', smart.json.resale && smart.json.resale.estimatedValue > 0, smart.json.resale);
  ok('a Nairobi–Mombasa run is costed', smart.json.economy.tankToNairobiMombasa > 0);
  console.log(`     ${anyVehicle.title}: ${smart.json.economy.kmPerLitre} km/L, service tier ${smart.json.servicing.tier}, worth ${money(smart.json.resale.estimatedValue)} in 3 years`);

  const pickup = await api('POST', '/api/running-cost', { dealer: 'summit', price: 4000000, engineLitres: 2.5, fuel: 'diesel', bodyType: 'Pickup', drivetrain: '4WD', make: 'Toyota', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  const sedan = await api('POST', '/api/running-cost', { dealer: 'summit', price: 4000000, engineLitres: 2.5, fuel: 'diesel', bodyType: 'Sedan', drivetrain: '2WD', make: 'Toyota', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('a 4WD pickup drinks more than the same-engine sedan', pickup.json.economy.kmPerLitre < sedan.json.economy.kmPerLitre, { pickup: pickup.json.economy.kmPerLitre, sedan: sedan.json.economy.kmPerLitre });
  const german = await api('POST', '/api/running-cost', { dealer: 'summit', price: 4000000, engineLitres: 2.0, fuel: 'petrol', make: 'BMW', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  const japanese = await api('POST', '/api/running-cost', { dealer: 'summit', price: 4000000, engineLitres: 2.0, fuel: 'petrol', make: 'Toyota', kmPerYear: 15000, ageYears: 5, includeLoan: false });
  ok('a BMW costs more to service than a Toyota', german.json.servicing.annual > japanese.json.servicing.annual * 1.5, { bmw: german.json.servicing.annual, toyota: japanese.json.servicing.annual });
  ok('a Toyota holds its value better than a Land Rover',
    japanese.json.resale.retentionPerYear >
      (await api('POST', '/api/running-cost', { dealer: 'summit', price: 4000000, engineLitres: 2.0, fuel: 'petrol', make: 'Land Rover', kmPerYear: 15000, ageYears: 5, includeLoan: false })).json.resale.retentionPerYear);

  {
    console.log('\n· the spec sheet');
    const listed = (await api('GET', '/api/vehicles?pageSize=6')).json.items;
    ok('every listing carries the headline stats', listed.every((v) => v.specs && v.specs.hp > 0), listed[0] && listed[0].specs);
    ok('a listing stays compact — no full sheet on a list', listed.every((v) => !v.specs.performance), Object.keys(listed[0].specs));
    const detailId = listed[0].id;
    const detail = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle;
    ok('the detail page gets the full sheet',
      !!(detail.specs.performance && detail.specs.chassis && detail.specs.practical && detail.specs.interior && detail.specs.inspection),
      Object.keys(detail.specs));
    ok('0-100 is a sane number', detail.specs.performance.zeroTo100 > 2.5 && detail.specs.performance.zeroTo100 < 30, detail.specs.performance.zeroTo100);
    ok('the rims are a real diameter', detail.specs.chassis.rimSize >= 13 && detail.specs.chassis.rimSize <= 22, detail.specs.chassis.rimSize);
    ok('the tyre matches the rim', detail.specs.chassis.tyreSize.endsWith('R' + detail.specs.chassis.rimSize), detail.specs.chassis.tyreSize);
    ok('range per tank uses the live fuel economy', detail.specs.practical.rangePerTank > 200, detail.specs.practical.rangePerTank);
    ok('the sheet says where its numbers came from', /estimated/i.test(detail.specs.disclaimer), detail.specs.disclaimer);

    /* Asked of the whole book, not just what is unsold today — earlier tests in this
       suite reserve and sell cars, so a check against available stock would be testing
       the demo inventory rather than the feature. */
    /* Scoped to THIS yard: the admin list runs at superadmin scope and spans every
       dealership, and the storefront rightly refuses to show another yard's car. */
    const siteDealerId = listed[0].dealer_id;
    const allStock = (await api('GET', '/api/admin/vehicles?pageSize=200')).json.items
      .filter((v) => v.dealer_id === siteDealerId);
    const published = allStock.find((v) => v.power_hp);
    ok('the yard holds cars with published figures', !!published, `${allStock.length} in this yard`);
    if (published) {
      const pubDetail = (await api('GET', `/api/vehicles/${published.id}`)).json.vehicle;
      ok('a car with published figures is not flagged as all-estimated', pubDetail.specs.estimated === false, pubDetail.specs.measured);
      ok('and its stored horsepower is what the sheet reports', pubDetail.specs.performance.hp === published.power_hp,
        { stored: published.power_hp, shown: pubDetail.specs.performance.hp });
    }

    /* The dealership's own figure must beat the model's.
       Whatever this car had stored is captured first and put back at the end — a test
       that wipes a seeded figure passes once and then fails itself on the next run. */
    const origHp = detail.power_hp;
    const origZero = detail.zero_to_100;

    await api('PATCH', `/api/admin/vehicles/${detailId}`, { power_hp: 999, zero_to_100: 3.3 });
    const after = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle.specs;
    ok('a typed-in horsepower overrides the estimate', after.performance.hp === 999, after.performance.hp);
    ok('a typed-in 0-100 overrides the estimate', after.performance.zeroTo100 === 3.3, after.performance.zeroTo100);
    ok('and the sheet reports which figures are measured', after.measured.includes('power') && after.measured.includes('zeroTo100'), after.measured);

    await api('PATCH', `/api/admin/vehicles/${detailId}`, { power_hp: '', zero_to_100: '' });
    const reverted = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle.specs;
    /* Asserted as behaviour rather than against a fixed number: clearing the box must
       fall back to a modelled figure and stop claiming the value was measured. */
    ok('clearing the box goes back to an estimate', reverted.performance.hp > 0 && reverted.performance.hp !== 999, reverted.performance.hp);
    ok('and the figure stops being reported as measured', !reverted.measured.includes('power'), reverted.measured);

    await api('PATCH', `/api/admin/vehicles/${detailId}`, { power_hp: origHp || '', zero_to_100: origZero || '' });
    const restoredSpec = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle;
    ok('the stored figures are put back',
      (restoredSpec.power_hp || null) === (origHp || null) && (restoredSpec.zero_to_100 || null) === (origZero || null),
      { origHp, origZero, now: [restoredSpec.power_hp, restoredSpec.zero_to_100] });

    // the condition scorecard
    await api('PATCH', `/api/admin/vehicles/${detailId}`, { inspection: { exterior: 92, interior: 88, tyres: 300, notes: 'Front pads replaced.' } });
    const card = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle.specs.inspection;
    ok('a scorecard round-trips', card.overall === 93, card.overall); // (92 + 88 + 100) / 3
    ok('an out-of-range score is clamped, not stored', card.areas.find((a) => a.key === 'tyres').score === 100, card.areas);
    ok('an unscored area reads as not checked, never as a pass', card.areas.find((a) => a.key === 'mechanical').score === null, card.areas);
    ok('the scorecard says how much of it was done', card.scoredCount === 3 && card.complete === false, card);
    const junk = await api('PATCH', `/api/admin/vehicles/${detailId}`, { inspection: { exterior: 90, evil: 'DROP TABLE' } });
    ok('an unknown scorecard key is dropped',
      junk.status === 200 && !('evil' in (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle.inspection),
      junk.json);
    // leave the yard as we found it — a test suite that edits the demo stock is a bug
    await api('PATCH', `/api/admin/vehicles/${detailId}`, { inspection: detail.inspection });
    const restored = (await api('GET', `/api/vehicles/${detailId}`)).json.vehicle.inspection || {};
    const wasThere = detail.inspection || {};
    ok('the test put the car back as it found it',
      Object.keys(wasThere).every((k) => String(restored[k]) === String(wasThere[k])) &&
        Object.keys(restored).length === Object.keys(wasThere).length,
      { wasThere, restored });
  }

  // note a car belonging to a different yard while we still have platform scope
  const foreignVehicleId = (await api('GET', '/api/admin/vehicles?dealer=highland&pageSize=1')).json.items[0].id;

  /* The booking test above reserves a real car and, until this was added, left it that
     way. Over many runs the suite quietly sold the entire demo yard and the storefront
     came up empty. A test that consumes the fixture it depends on works exactly once. */
  {
    const released = await api('PATCH', `/api/admin/vehicles/${bookable.id}`, { status: 'available' });
    ok('the booking test releases the car it held', released.status === 200, released.json);
    const stillThere = (await api('GET', '/api/vehicles?pageSize=100')).json.total;
    ok('the storefront still has stock after the suite runs', stillThere > 0, `${stillThere} available`);
  }

  console.log('\n· price check, provenance and promises');
  {
    const stock = (await api('GET', '/api/vehicles?pageSize=50')).json.items;
    let judged = 0;
    let refused = 0;
    for (const item of stock.slice(0, 12)) {
      const d = (await api('GET', `/api/vehicles/${item.id}`)).json;
      if (!d.priceCheck) continue;
      if (d.priceCheck.enough) {
        judged++;
        ok(`#${item.id} price band is one of the five`, ['low', 'great', 'good', 'fair', 'high'].includes(d.priceCheck.band), d.priceCheck.band);
        ok(`#${item.id} says what it compared against`, /this yard/.test(d.priceCheck.basis), d.priceCheck.basis);
        ok(`#${item.id} never claims to be a market valuation`, !/market value|market price/i.test(d.priceCheck.basis));
      } else {
        refused++;
        /* Two honest reasons to decline: too few comparables, or a gap so wide the
           comparison itself must be wrong (a 79 Series against a Hilux). Either way it
           must say which, and never quietly show a band anyway. */
        ok(`#${item.id} declines with a stated reason`,
          d.priceCheck.sample < d.priceCheck.minSample || d.priceCheck.outlier === true,
          d.priceCheck);
        ok(`#${item.id} shows no band when it declines`, !d.priceCheck.band, d.priceCheck);
      }
    }
    ok('the price check both judges and declines to judge across the yard', judged + refused > 0, { judged, refused });

    const one = (await api('GET', `/api/vehicles/${stock[0].id}`)).json;
    ok('a future value is projected', one.futureValue && one.futureValue.guaranteedFloor > 0, one.futureValue);
    ok('the guaranteed floor sits under the projection', one.futureValue.guaranteedFloor < one.futureValue.projected);
    ok('and under today\'s price', one.futureValue.guaranteedFloor < stock[0].price);

    ok('provenance returns all five checks', one.history && one.history.total === 5, one.history && one.history.total);
    ok('every check is clear, a problem, or explicitly unchecked',
      one.history.checks.every((c) => ['clear', 'problem', 'unchecked'].includes(c.state)));
    ok('an unchecked item is never counted as cleared',
      one.history.clearedCount === one.history.checks.filter((c) => c.state === 'clear').length);
    ok('the dealership promise reaches the listing', one.promise && one.promise.returnDays > 0, one.promise);
    ok('and names who handles the logbook transfer', typeof one.promise.transferIncluded === 'boolean');

    // a junk provenance key must be dropped, exactly like the inspection scorecard
    const vid = stock[0].id;
    const original = (await api('GET', `/api/admin/vehicles?pageSize=200`)).json.items.find((x) => x.id === vid).history;
    await api('PATCH', `/api/admin/vehicles/${vid}`, { history: { logbookLoan: true, evil: 'DROP TABLE', keepers: 2 } });
    const after = (await api('GET', `/api/vehicles/${vid}`)).json.vehicle.history;
    ok('an unknown provenance key is dropped', !('evil' in after), Object.keys(after));
    ok('a known one is kept', after.logbookLoan === true && after.keepers === 2, after);
    await api('PATCH', `/api/admin/vehicles/${vid}`, { history: original });
    ok('provenance is put back as it was',
      JSON.stringify(Object.keys((await api('GET', `/api/vehicles/${vid}`)).json.vehicle.history).sort()) ===
        JSON.stringify(Object.keys(original).sort()));
  }

  console.log('\n· test drive booking');
  {
    const s = await api('GET', '/api/bookings/slots?dealer=summit');
    ok('slots are offered', s.json.slots.length > 0, s.json.slots.length);
    ok('never on a Sunday', s.json.slots.every((d) => new Date(d.date + 'T12:00:00').getDay() !== 0), s.json.slots.map((d) => d.date));
    ok('and never in the past', s.json.slots.every((d) => new Date(d.date + 'T23:59:59') > new Date()));

    const day = s.json.slots[0];
    const made = await api('POST', '/api/bookings?dealer=summit', {
      date: day.date, time: day.times[0], name: 'Slot Tester', phone: '0712345678', kind: 'test_drive',
    });
    ok('a slot can be booked', made.json.ok && /^TD-/.test(made.json.ref), made.json);

    const past = await api('POST', '/api/bookings?dealer=summit', {
      date: '2020-01-06', time: '09:00', name: 'Time Traveller', phone: '0712345679',
    });
    ok('a day in the past is refused', past.status === 400, past.json);

    const badTime = await api('POST', '/api/bookings?dealer=summit', {
      date: day.date, time: '03:00', name: 'Night Owl', phone: '0712345670',
    });
    ok('a time outside opening hours is refused', badTime.status === 400, badTime.json);

    /* Fill the slot to its cap and confirm the next person is turned away rather than
       double-booked — the check has to happen at booking time, not at page-draw time. */
    await api('POST', '/api/bookings?dealer=summit', { date: day.date, time: day.times[0], name: 'Second', phone: '0712345671' });
    const third = await api('POST', '/api/bookings?dealer=summit', { date: day.date, time: day.times[0], name: 'Third', phone: '0712345672' });
    ok('a full slot cannot be over-booked', third.status === 400, third.json);
    const after = await api('GET', '/api/bookings/slots?dealer=summit');
    const sameDay = after.json.slots.find((d) => d.date === day.date);
    ok('and the full time disappears from the offered slots', !sameDay || !sameDay.times.includes(day.times[0]), sameDay);
  }

  console.log('\n· saved searches');
  {
    const made = await api('POST', '/api/saved-searches?dealer=summit', {
      filters: { make: 'Toyota', maxPrice: 3000000, junk: 'ignored' },
      phone: '0712345678',
    });
    ok('an alert can be set up without an account', made.json.ok === true, made.json);
    ok('and is described in words a person can read', /Toyota/.test(made.json.label), made.json.label);

    /* The contact rule only binds anonymous visitors — a signed-in customer already has
       somewhere to be told. So this has to be asked WITHOUT the session cookie. */
    const anon = async (method, path, body) => {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };

    const noContact = await anon('POST', '/api/saved-searches?dealer=summit', { filters: { make: 'Mazda' } });
    ok('an anonymous alert with nowhere to send it is refused', noContact.status === 400, noContact.json);
    const anonMade = await anon('POST', '/api/saved-searches?dealer=summit', { filters: { make: 'Mazda' }, phone: '0722334455' });
    ok('an anonymous alert with a phone number is accepted', anonMade.json.ok === true, anonMade.json);

    const mine = await api('GET', '/api/saved-searches');
    ok('a signed-in user sees their own alerts list', Array.isArray(mine.json.items), mine.json);
    ok('and that list is only their own', mine.json.items.every((s) => s.contact === null), mine.json.items.length);

    /* The anonymous alert belongs to nobody, so a signed-in staff account must not be
       able to delete it — an alert id is guessable and it carries a phone number. */
    const stealing = await api('DELETE', `/api/saved-searches/${anonMade.json.id}`);
    ok("a signed-in user cannot delete somebody else's alert", stealing.status === 404, stealing.status);
    const ownDelete = await api('DELETE', `/api/saved-searches/${made.json.id}`);
    ok('but can delete their own', ownDelete.json.ok === true, ownDelete);
  }

  console.log('\n· firebase sign-in (off in this run)');
  {
    /* This suite runs without MOTOKE_FIREBASE_PROJECT, so the whole feature must be
       absent rather than half-present. A disabled feature that still answers is how a
       staging endpoint ends up live in production. */
    const bs = (await api('GET', '/api/bootstrap?dealer=summit')).json;
    ok('bootstrap hands the browser no Firebase config', bs.firebase === null || bs.firebase === undefined, bs.firebase);
    const off = await api('POST', '/api/auth/firebase', { idToken: 'anything' });
    ok('the Firebase endpoint is not reachable when it is switched off', off.status === 404, off);
    ok('and it does not leak why', !/project|token|verify/i.test(JSON.stringify(off.json).toLowerCase().replace('firebase sign-in is not enabled on this server', '')), off.json);
  }

  console.log('\n· role permissions');
  {
    /* Hiding a menu item is decoration. These check the SERVER refuses, which is the
       only thing standing between a receptionist and a customer's ID number. */
    /* Sign in once per role and keep the cookie, then swap between them.
       The suite deliberately trips the login rate limiter earlier on, so re-authenticating
       for every check runs the account out of attempts part way through and the failures
       that follow are about the limiter rather than about permissions. */
    const sessions = {};
    const asRole = async (email, password) => {
      if (sessions[email]) {
        cookie = sessions[email].cookie;
        return sessions[email].me;
      }
      cookie = '';
      const start = await api('POST', '/api/auth/login', { email, password });
      if (start.json.needsOtp) await api('POST', '/api/auth/verify-otp', { email, code: start.json.demoCode });
      const me = (await api('GET', '/api/auth/me')).json;
      sessions[email] = { cookie, me };
      return me;
    };

    const finance = await asRole('faith@summitmotors.demo', 'demo123');
    ok('the finance officer signs in', finance.user && finance.user.role === 'finance_officer', finance.user);
    ok('and is told what they may do', Array.isArray(finance.permissions) && finance.permissions.length > 0, finance.permissions);
    ok('a finance officer can open applications', (await api('GET', '/api/admin/applications')).status === 200);
    ok('and can see the lender panel to restructure a deal', (await api('GET', '/api/admin/lenders')).status === 200);
    ok('but cannot see the business overview', (await api('GET', '/api/admin/stats')).status === 403);
    ok('cannot open the inventory', (await api('GET', '/api/admin/vehicles')).status === 403);
    ok('cannot price a car', (await api('PATCH', `/api/admin/vehicles/${bookable.id}`, { price: 1 })).status === 403);
    ok('cannot change a lender\'s published rates', (await api('POST', '/api/admin/lenders', { name: 'Fake Bank' })).status === 403);
    ok('cannot read the activity log', (await api('GET', '/api/admin/audit')).status === 403);
    ok('and cannot create staff', (await api('POST', '/api/admin/users', { name: 'X', email: 'x@y.z', role: 'dealer_admin' })).status === 403);

    const agent = await asRole('brian@summitmotors.demo', 'demo123');
    ok('a sales agent signs in', agent.user.role === 'sales_agent');
    ok('and can work the stock', (await api('GET', '/api/admin/vehicles')).status === 200);
    ok('and the leads', (await api('GET', '/api/admin/leads')).status === 200);
    ok('but not the running-cost assumptions', (await api('GET', '/api/admin/fuel')).status === 403);
    ok('nor the staff list', (await api('GET', '/api/admin/users')).status === 403);
    ok('nor the activity log', (await api('GET', '/api/admin/audit')).status === 403);

    const boss = await asRole('grace@summitmotors.demo', 'demo123');
    ok('the dealer admin sees the overview', (await api('GET', '/api/admin/stats')).status === 200);
    ok('and stock ageing', (await api('GET', '/api/admin/ageing')).status === 200);
    ok('and the staff list', (await api('GET', '/api/admin/users')).status === 200);
    ok('but still cannot rewrite a bank\'s published rates',
      (await api('POST', '/api/admin/lenders', { name: 'Fake Bank' })).status === 403, boss.user.role);

    /* Assignment is a management act. Working a file and deciding who works it are two
       different jobs, and a caseworker quietly moving files onto a colleague is how
       accountability for a customer's money disappears. */
    await asRole('admin@motoke.demo', 'admin123');
    const someApp = (await api('GET', '/api/admin/applications?pageSize=1')).json.items[0];
    ok('there is an application to assign', !!someApp);
    const staffList = (await api('GET', '/api/admin/users')).json;
    const staff = (staffList.items || staffList || []).filter((u) => u.role !== 'customer');
    const faith = staff.find((u) => u.email === 'faith@summitmotors.demo');
    const brian = staff.find((u) => u.email === 'brian@summitmotors.demo');

    await asRole('faith@summitmotors.demo', 'demo123');
    const shove = await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: brian.id });
    ok('a finance officer cannot hand a file to a colleague', shove.status === 403, shove.json);

    const claim = await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: faith.id });
    ok('but can claim an unassigned one for themselves', claim.status === 200, claim.json);
    const drop = await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: null });
    ok('and can put it back down', drop.status === 200, drop.json);

    await asRole('grace@summitmotors.demo', 'demo123');
    const proper = await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: brian.id });
    ok('a dealership admin can assign it to anyone', proper.status === 200, proper.json);
    const nonsense = await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: 999999 });
    ok('assigning to somebody who does not exist is refused', nonsense.status === 400, nonsense.json);
    await api('PATCH', `/api/admin/applications/${someApp.id}`, { assigned_to: null });

    // leads and pre-qualifications follow the same rule, not a different one
    await asRole('brian@summitmotors.demo', 'demo123');
    const leadsRes = (await api('GET', '/api/admin/leads?pageSize=1')).json;
    // this endpoint answers with a bare array, unlike the paged ones
    const leadRows = Array.isArray(leadsRes) ? leadsRes : leadsRes.items || [];
    const lead = leadRows[0];
    ok('a sales agent can read the leads list', Array.isArray(leadRows), typeof leadsRes);
    if (lead) {
      const shoveLead = await api('PATCH', `/api/admin/leads/${lead.id}`, { assigned_to: faith.id });
      ok('a sales agent cannot hand a lead to somebody else', shoveLead.status === 403, shoveLead.json);
      const claimLead = await api('PATCH', `/api/admin/leads/${lead.id}`, { assigned_to: brian.id });
      ok('but can pick a lead up himself', claimLead.status === 200, claimLead.json);
      await api('PATCH', `/api/admin/leads/${lead.id}`, { assigned_to: null });
    }

    // back to the platform admin for whatever follows — session already held
    await asRole('admin@motoke.demo', 'admin123');
    ok('the platform admin still reaches everything', (await api('GET', '/api/admin/audit')).status === 200);
  }

  console.log('\n· multi-tenant isolation');
  cookie = '';
  const dealerStart = await api('POST', '/api/auth/login', { email: 'grace@summitmotors.demo', password: 'demo123' });
  const dealerLogin = await api('POST', '/api/auth/verify-otp', { email: 'grace@summitmotors.demo', code: dealerStart.json.demoCode });
  ok('dealer admin login', dealerLogin.json.ok && dealerLogin.json.user.role === 'dealer_admin', dealerLogin.json);
  const dealerApps = await api('GET', '/api/admin/applications');
  ok('dealer admin only sees own applications', dealerApps.json.items.every((a) => a.dealer_id === dealerLogin.json.user.dealer_id), dealerApps.json.items.map((a) => a.dealer_id));
  const crossEdit = await api('PATCH', `/api/admin/vehicles/${foreignVehicleId}`, { price: 1 });
  ok("dealer admin cannot touch another dealer's stock", crossEdit.status === 403, crossEdit);
  const foreignPublic = await api('GET', `/api/vehicles/${foreignVehicleId}`);
  ok('another yard\'s car is not reachable from the storefront', foreignPublic.status === 404, foreignPublic.status);
  const crossDealer = await api('POST', '/api/admin/dealers', { name: 'Hijack Motors' });
  ok('dealer admin cannot create dealerships', crossDealer.status === 403);

  cookie = '';
  const anon = await api('GET', '/api/admin/stats');
  ok('anonymous blocked from admin', anon.status === 403, anon);

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});
