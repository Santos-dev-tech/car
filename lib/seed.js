'use strict';
/**
 * MotoKE - demo seed data.
 *
 * NOTE ON NAMES AND RATES: every dealership and lender below is a fictional
 * demo entity, and every rate/fee is indicative sample data. They exist so the
 * engine has something to chew on. Replace them with the real institution's
 * figures from Admin > Lenders before showing commercial terms to anyone.
 */
const { all, get, insert, run, setSetting } = require('./db');
const { hashPassword } = require('./auth');

const img = (make, model, color, view) =>
  `/img/vehicle.svg?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&color=${encodeURIComponent(color || '#334')}${view ? `&view=${view}` : ''}`;

/** A small gallery per vehicle so the detail page has thumbnails to page through. */
const gallery = (make, model, color) =>
  ['front', 'rear', 'side', 'interior', 'dash', 'wheels'].map((v) => img(make, model, color, v));

const DEALERS = [
  {
    slug: 'summit',
    name: 'Summit Motors Kenya',
    tagline: 'Kenya’s widest range of certified pre-owned',
    logo_text: 'SM',
    primary_color: '#ffc000',
    accent_color: '#181818',
    phone: '+254 700 100 100',
    whatsapp: '+254700100100',
    email: 'sales@summitmotors.demo',
    address: 'Mombasa Road, Nairobi',
    city: 'Nairobi',
    about:
      'Summit Motors has moved over 12,000 units since 2009. Every unit is inspected on a 150-point checklist and comes with a 6-month powertrain warranty.',
    branches: [
      { name: 'Mombasa Road HQ', city: 'Nairobi', address: 'Mombasa Rd, opp. Sameer Business Park', phone: '+254 700 100 100' },
      { name: 'Westlands Showroom', city: 'Nairobi', address: 'Waiyaki Way, Westlands', phone: '+254 700 100 101' },
      { name: 'Nyali Branch', city: 'Mombasa', address: 'Links Road, Nyali', phone: '+254 700 100 102' },
    ],
  },
  {
    slug: 'sahara',
    name: 'Sahara Auto Group',
    tagline: 'Fleet, family and everything between',
    logo_text: 'SA',
    primary_color: '#d24b4b',
    accent_color: '#181818',
    phone: '+254 711 200 200',
    whatsapp: '+254711200200',
    email: 'hello@saharaauto.demo',
    address: 'Ngong Road, Nairobi',
    city: 'Nairobi',
    about: 'Sahara Auto Group specialises in fleet supply and corporate leasing, with a growing retail arm.',
    branches: [
      { name: 'Ngong Road', city: 'Nairobi', address: 'Ngong Rd, Adams Arcade', phone: '+254 711 200 200' },
      { name: 'Eldoret Yard', city: 'Eldoret', address: 'Uganda Road', phone: '+254 711 200 201' },
    ],
  },
  {
    slug: 'zawadi',
    name: 'Zawadi Motors',
    tagline: 'Drive home today',
    logo_text: 'ZM',
    primary_color: '#e07b00',
    accent_color: '#181818',
    phone: '+254 722 300 300',
    whatsapp: '+254722300300',
    email: 'info@zawadimotors.demo',
    address: 'Kiambu Road, Nairobi',
    city: 'Nairobi',
    about: 'Zawadi Motors focuses on first-time buyers, with in-house financing for applicants banks turn away.',
    branches: [{ name: 'Kiambu Road', city: 'Nairobi', address: 'Kiambu Rd, Runda', phone: '+254 722 300 300' }],
  },
  {
    slug: 'highland',
    name: 'Highland Prestige Autos',
    tagline: 'Premium German and British marques',
    logo_text: 'HP',
    primary_color: '#8fbf5a',
    accent_color: '#181818',
    phone: '+254 733 400 400',
    whatsapp: '+254733400400',
    email: 'concierge@highlandprestige.demo',
    address: 'Karen, Nairobi',
    city: 'Nairobi',
    about: 'Highland Prestige imports and services premium marques, with full service history on every unit.',
    branches: [
      { name: 'Karen Showroom', city: 'Nairobi', address: 'Karen Rd', phone: '+254 733 400 400' },
      { name: 'Nakuru', city: 'Nakuru', address: 'Kenyatta Ave', phone: '+254 733 400 401' },
    ],
  },
  {
    slug: 'pwani',
    name: 'Pwani Car Bazaar',
    tagline: 'Coast’s biggest yard',
    logo_text: 'PB',
    primary_color: '#4aa3d2',
    accent_color: '#181818',
    phone: '+254 744 500 500',
    whatsapp: '+254744500500',
    email: 'sales@pwanibazaar.demo',
    address: 'Nyerere Avenue, Mombasa',
    city: 'Mombasa',
    about: 'Pwani Car Bazaar clears direct from the port, offering duty-paid and duty-unpaid units.',
    branches: [
      { name: 'Nyerere Avenue', city: 'Mombasa', address: 'Nyerere Ave', phone: '+254 744 500 500' },
      { name: 'Malindi', city: 'Malindi', address: 'Lamu Rd', phone: '+254 744 500 501' },
    ],
  },
];

const LENDERS = [
  {
    name: 'Equatorial Bank — Asset Finance',
    short_name: 'Equatorial Bank',
    type: 'bank',
    logo_text: 'EB',
    color: '#1d4ed8',
    rate_type: 'reducing',
    annual_rate: 13.5,
    min_deposit_pct: 20,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 500000,
    max_loan: 15000000,
    min_monthly_income: 50000,
    max_dti_pct: 55,
    max_vehicle_age_years: 8,
    processing_fee_pct: 2,
    processing_fee_min: 10000,
    valuation_fee: 7500,
    tracking_fee: 0,
    legal_fee: 5000,
    insurance_rate_pct: 4.0,
    insurance_financed: 1,
    capitalize_fees: 0,
    allowed_employment: '["employed","contract","self_employed","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 1,
    bank_statement_months: 6,
    approval_days: 5,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 2,
    notes: 'Salary account not required, but a 0.5% rate discount applies if salary is channelled to the bank.',
    requirements:
      '["Copy of National ID / passport","KRA PIN certificate","6 months bank statements","3 recent payslips or 6 months M-Pesa statement","Completed asset finance application form","Pro-forma invoice from the dealer"]',
    sort_order: 1,
  },
  {
    name: 'Nairobi Commercial Bank — AutoDrive',
    short_name: 'NCB AutoDrive',
    type: 'bank',
    logo_text: 'NC',
    color: '#047857',
    rate_type: 'reducing',
    annual_rate: 14.5,
    min_deposit_pct: 20,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 400000,
    max_loan: 12000000,
    min_monthly_income: 45000,
    max_dti_pct: 60,
    max_vehicle_age_years: 8,
    processing_fee_pct: 2.5,
    processing_fee_min: 7500,
    valuation_fee: 6000,
    tracking_fee: 18000,
    legal_fee: 3500,
    insurance_rate_pct: 4.2,
    insurance_financed: 1,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 1,
    bank_statement_months: 6,
    approval_days: 4,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 1,
    notes: 'Fees can be rolled into the facility, so the cash you bring on day one is just the deposit.',
    requirements:
      '["National ID","KRA PIN","6 months bank statements","Latest payslip","Pro-forma invoice","Passport photo"]',
    sort_order: 2,
  },
  {
    name: 'Rift Valley Bank — Wheels Plus',
    short_name: 'Rift Valley Bank',
    type: 'bank',
    logo_text: 'RV',
    color: '#7c2d12',
    rate_type: 'reducing',
    annual_rate: 12.9,
    min_deposit_pct: 30,
    min_tenor_months: 12,
    max_tenor_months: 48,
    min_loan: 800000,
    max_loan: 20000000,
    min_monthly_income: 80000,
    max_dti_pct: 50,
    max_vehicle_age_years: 6,
    processing_fee_pct: 1.5,
    processing_fee_min: 15000,
    valuation_fee: 8500,
    tracking_fee: 0,
    legal_fee: 6000,
    insurance_rate_pct: 3.8,
    insurance_financed: 0,
    capitalize_fees: 0,
    allowed_employment: '["employed","business"]',
    allowed_conditions: '["new","foreign_used"]',
    requires_clean_crb: 1,
    bank_statement_months: 12,
    approval_days: 7,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 3,
    notes: 'Cheapest headline rate on the panel, but the strictest on deposit, income and vehicle age.',
    requirements:
      '["National ID","KRA PIN","12 months bank statements","Employment letter","Audited accounts (business applicants)","Pro-forma invoice"]',
    sort_order: 3,
  },
  {
    name: 'Trans-Africa Bank — Motor Finance',
    short_name: 'Trans-Africa Bank',
    type: 'bank',
    logo_text: 'TA',
    color: '#4338ca',
    rate_type: 'reducing',
    annual_rate: 15.5,
    min_deposit_pct: 15,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 300000,
    max_loan: 10000000,
    min_monthly_income: 40000,
    max_dti_pct: 60,
    max_vehicle_age_years: 10,
    processing_fee_pct: 2.5,
    processing_fee_min: 6000,
    valuation_fee: 5000,
    tracking_fee: 20000,
    legal_fee: 0,
    insurance_rate_pct: 4.5,
    insurance_financed: 1,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 1,
    bank_statement_months: 6,
    approval_days: 3,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 1,
    notes: 'Lowest bank deposit at 15% and accepts vehicles up to 10 years old.',
    requirements: '["National ID","KRA PIN","6 months bank statements","Payslips or business records","Pro-forma invoice"]',
    sort_order: 4,
  },
  {
    name: 'Coast Union Bank — Gari Loan',
    short_name: 'Coast Union Bank',
    type: 'bank',
    logo_text: 'CU',
    color: '#0e7490',
    rate_type: 'reducing',
    annual_rate: 14.0,
    min_deposit_pct: 25,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 500000,
    max_loan: 14000000,
    min_monthly_income: 60000,
    max_dti_pct: 55,
    max_vehicle_age_years: 8,
    processing_fee_pct: 2,
    processing_fee_min: 10000,
    valuation_fee: 7000,
    tracking_fee: 15000,
    legal_fee: 4000,
    insurance_rate_pct: 4.0,
    insurance_financed: 1,
    capitalize_fees: 0,
    allowed_employment: '["employed","contract","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 1,
    bank_statement_months: 6,
    approval_days: 5,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 2,
    notes: 'Strong at the Coast; branch network handles Mombasa port clearing paperwork.',
    requirements: '["National ID","KRA PIN","6 months bank statements","Payslip","Pro-forma invoice"]',
    sort_order: 5,
  },
  {
    name: 'Kifaru Credit — Asset Finance',
    short_name: 'Kifaru Credit',
    type: 'microfinance',
    logo_text: 'KC',
    color: '#b91c1c',
    rate_type: 'flat',
    annual_rate: 14,
    min_deposit_pct: 30,
    min_tenor_months: 6,
    max_tenor_months: 36,
    min_loan: 150000,
    max_loan: 4000000,
    min_monthly_income: 25000,
    max_dti_pct: 65,
    max_vehicle_age_years: 15,
    processing_fee_pct: 3,
    processing_fee_min: 5000,
    valuation_fee: 4000,
    tracking_fee: 25000,
    legal_fee: 0,
    insurance_rate_pct: 5.0,
    insurance_financed: 1,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business","gig"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 3,
    approval_days: 1,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 0,
    notes: 'Quoted on a flat rate — the headline number looks lower than a bank’s but the true cost is higher. Compare the APR column.',
    requirements: '["National ID","KRA PIN","3 months M-Pesa statement","Two guarantors","Pro-forma invoice"]',
    sort_order: 6,
  },
  {
    name: 'Safari Microfinance — Gari Yangu',
    short_name: 'Safari Microfinance',
    type: 'microfinance',
    logo_text: 'SF',
    color: '#ea580c',
    rate_type: 'flat',
    annual_rate: 18,
    min_deposit_pct: 25,
    min_tenor_months: 6,
    max_tenor_months: 24,
    min_loan: 100000,
    max_loan: 2500000,
    min_monthly_income: 20000,
    max_dti_pct: 70,
    max_vehicle_age_years: 18,
    processing_fee_pct: 4,
    processing_fee_min: 4000,
    valuation_fee: 3500,
    tracking_fee: 25000,
    legal_fee: 0,
    insurance_rate_pct: 5.5,
    insurance_financed: 1,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business","gig"]',
    allowed_conditions: '["used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 3,
    approval_days: 1,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 0,
    notes: 'Built for boda, taxi and matatu operators — income assessed on M-Pesa flow, not payslips.',
    requirements: '["National ID","KRA PIN","3 months M-Pesa statement","One guarantor"]',
    sort_order: 7,
  },
  {
    name: 'Tumaini Asset Finance',
    short_name: 'Tumaini Finance',
    type: 'microfinance',
    logo_text: 'TF',
    color: '#9333ea',
    rate_type: 'reducing',
    annual_rate: 21,
    min_deposit_pct: 20,
    min_tenor_months: 12,
    max_tenor_months: 48,
    min_loan: 200000,
    max_loan: 6000000,
    min_monthly_income: 30000,
    max_dti_pct: 60,
    max_vehicle_age_years: 12,
    processing_fee_pct: 3,
    processing_fee_min: 6000,
    valuation_fee: 5000,
    tracking_fee: 22000,
    legal_fee: 0,
    insurance_rate_pct: 4.8,
    insurance_financed: 1,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business","gig"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 3,
    approval_days: 2,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 0,
    notes: 'Reducing balance at a microfinance speed — will consider applicants with a listed but settled CRB record.',
    requirements: '["National ID","KRA PIN","3 months bank or M-Pesa statement","Business permit (self-employed)"]',
    sort_order: 8,
  },
  {
    name: 'Wajenzi Sacco — Car Loan',
    short_name: 'Wajenzi Sacco',
    type: 'sacco',
    logo_text: 'WS',
    color: '#15803d',
    rate_type: 'reducing',
    annual_rate: 12.0,
    min_deposit_pct: 10,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 200000,
    max_loan: 8000000,
    min_monthly_income: 25000,
    max_dti_pct: 66,
    max_vehicle_age_years: 12,
    processing_fee_pct: 1,
    processing_fee_min: 3000,
    valuation_fee: 4500,
    tracking_fee: 0,
    legal_fee: 0,
    insurance_rate_pct: 4.0,
    insurance_financed: 0,
    capitalize_fees: 0,
    allowed_employment: '["employed","contract","self_employed","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 6,
    approval_days: 10,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 0,
    notes: 'Cheapest money on the panel, but you must be a member for 6 months and hold shares worth a third of the loan. Approval goes through a credit committee.',
    requirements:
      '["Sacco membership number (6 months+)","National ID","KRA PIN","6 months contribution record","Two guarantors who are members","Pro-forma invoice"]',
    sort_order: 9,
  },
  {
    name: 'Mwangaza Sacco — Asset Plan',
    short_name: 'Mwangaza Sacco',
    type: 'sacco',
    logo_text: 'MZ',
    color: '#0891b2',
    rate_type: 'reducing',
    annual_rate: 13.2,
    min_deposit_pct: 10,
    min_tenor_months: 12,
    max_tenor_months: 60,
    min_loan: 150000,
    max_loan: 6000000,
    min_monthly_income: 22000,
    max_dti_pct: 66,
    max_vehicle_age_years: 14,
    processing_fee_pct: 1,
    processing_fee_min: 2500,
    valuation_fee: 4000,
    tracking_fee: 0,
    legal_fee: 0,
    insurance_rate_pct: 4.0,
    insurance_financed: 0,
    capitalize_fees: 0,
    allowed_employment: '["employed","contract","self_employed","business"]',
    allowed_conditions: '["new","used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 6,
    approval_days: 14,
    logbook_holder: 'lender',
    early_settlement_fee_pct: 0,
    notes: 'Deposits as low as 10% for members in good standing. Slowest turnaround on the panel.',
    requirements: '["Sacco membership","National ID","KRA PIN","Contribution record","Two guarantors"]',
    sort_order: 10,
  },
  {
    name: 'Dealer In-House Plan',
    short_name: 'In-House Plan',
    type: 'inhouse',
    logo_text: 'IH',
    color: '#334155',
    rate_type: 'flat',
    annual_rate: 16,
    min_deposit_pct: 40,
    min_tenor_months: 6,
    max_tenor_months: 24,
    min_loan: 100000,
    max_loan: 3000000,
    min_monthly_income: 20000,
    max_dti_pct: 70,
    max_vehicle_age_years: 20,
    processing_fee_pct: 2,
    processing_fee_min: 5000,
    valuation_fee: 0,
    tracking_fee: 25000,
    legal_fee: 0,
    insurance_rate_pct: 0,
    insurance_financed: 0,
    capitalize_fees: 1,
    allowed_employment: '["employed","contract","self_employed","business","gig"]',
    allowed_conditions: '["used","foreign_used"]',
    requires_clean_crb: 0,
    bank_statement_months: 0,
    approval_days: 1,
    logbook_holder: 'dealer',
    early_settlement_fee_pct: 0,
    notes: 'Financed directly by the dealership. Same-day approval, no CRB check, but the biggest deposit and the shortest term.',
    requirements: '["National ID","KRA PIN","Proof of residence","One guarantor"]',
    sort_order: 11,
  },
];

const F = {
  common: ['Air conditioning', 'Power steering', 'Power windows', 'Central locking', 'ABS', 'Airbags'],
  mid: ['Reverse camera', 'Alloy rims', 'Bluetooth', 'Push start', 'Fog lights'],
  high: ['Leather seats', 'Sunroof', 'Cruise control', 'Parking sensors', 'Climate control', 'Keyless entry'],
};
const feat = (...sets) => JSON.stringify([...new Set(sets.flatMap((s) => F[s] || []))]);

/**
 * Published manufacturer figures for the models in the demo stock, where a yard would
 * realistically have them to hand. Anything not listed here is left for
 * `lib/performance.js` to estimate, which is the honest default — the site labels the
 * difference so nobody mistakes a projection for a brochure number.
 *
 * [hp, torque Nm, 0-100 s, top speed km/h, kerb kg, rim in]
 */
const MEASURED = {
  'Toyota Land Cruiser Prado': [174, 450, 12.7, 175, 2135, 18],
  'Toyota Hilux': [148, 400, 12.8, 170, 2015, 17],
  'Toyota Harrier': [149, 193, 9.9, 180, 1620, 18],
  'Toyota Corolla Cross': [194, 202, 8.1, 180, 1500, 18],
  'Mercedes-Benz C200': [181, 280, 7.7, 240, 1525, 18],
  'BMW 320i': [181, 290, 7.1, 235, 1495, 18],
  'Audi Q5': [249, 370, 6.3, 237, 1770, 19],
  'Volkswagen Tiguan': [148, 250, 9.2, 202, 1560, 19],
  'Land Rover Discovery Sport': [178, 430, 9.3, 191, 1930, 19],
  'Nissan X-Trail': [147, 207, 10.5, 183, 1520, 17],
  'Honda Vezel': [129, 156, 9.6, 180, 1330, 17],
  'Mazda Demio': [104, 250, 10.1, 180, 1080, 16],
  'Suzuki Swift': [101, 118, 11.9, 190, 950, 16],
  'Nissan Note': [127, 254, 8.8, 158, 1220, 16],
  'Isuzu D-Max': [161, 360, 12.7, 175, 1975, 17],
};

/** A five-area inspection scorecard, worse the harder the car has worked. */
function inspectionFor(condition, km, price) {
  if (condition === 'new') return null; // nothing to inspect on a zero-mileage car
  const wear = Math.min(28, Math.round(km / 7000)); // ~4 points per 28,000 km
  const lift = price > 4_000_000 ? 3 : 0; // the premium stock gets prepared harder
  const s = (base, extra = 0) => Math.max(55, Math.min(99, base - wear + lift + extra));
  return {
    exterior: s(97),
    interior: s(96, 1),
    mechanical: s(98, -1),
    tyres: s(95, -3), // tyres are the first thing to go and the cheapest to fix
    electronics: s(98, 1),
    checkedOn: new Date(Date.now() - ((km % 21) + 3) * 864e5).toISOString().slice(0, 10),
    notes: 'Checked in on arrival by our own workshop. Full report available on request.',
  };
}

/** The stored spec columns for one seeded car: the published figures plus the scorecard. */
function specsFor(make, model, condition, km, price) {
  const m = MEASURED[`${make} ${model}`];
  const insp = inspectionFor(condition, km, price);
  return {
    power_hp: m ? m[0] : null,
    torque_nm: m ? m[1] : null,
    zero_to_100: m ? m[2] : null,
    top_speed: m ? m[3] : null,
    kerb_weight: m ? m[4] : null,
    rim_size: m ? m[5] : null,
    inspection: insp ? JSON.stringify(insp) : null,
  };
}

// [make, model, variant, year, price, condition, body, fuel, trans, drive, cc, km, color, seats, dealerIdx, featured]
const VEHICLES = [
  ['Toyota', 'Vitz', 'F Safety Edition', 2019, 1180000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1000, 62000, 'Silver', 5, 0, 0],
  ['Toyota', 'Axio', 'X Hybrid', 2019, 1650000, 'foreign_used', 'Sedan', 'Hybrid', 'Automatic', '2WD', 1500, 78000, 'Pearl White', 5, 0, 1],
  ['Toyota', 'Fielder', 'G WxB', 2018, 1780000, 'foreign_used', 'Station Wagon', 'Petrol', 'Automatic', '2WD', 1500, 91000, 'Black', 5, 0, 0],
  ['Toyota', 'Premio', 'F EX', 2018, 2350000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 1800, 84000, 'Silver', 5, 0, 1],
  ['Toyota', 'Harrier', 'Premium', 2018, 4250000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 72000, 'Pearl White', 5, 0, 1],
  ['Toyota', 'Land Cruiser Prado', 'TX-L', 2017, 6900000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '4WD', 2800, 96000, 'Graphite', 7, 0, 1],
  ['Nissan', 'Note', 'e-Power', 2019, 1290000, 'foreign_used', 'Hatchback', 'Hybrid', 'Automatic', '2WD', 1200, 66000, 'Blue', 5, 0, 0],
  ['Mazda', 'Demio', 'XD Diesel', 2018, 1120000, 'foreign_used', 'Hatchback', 'Diesel', 'Automatic', '2WD', 1500, 88000, 'Soul Red', 5, 0, 0],

  ['Toyota', 'Hilux', 'Double Cab SR5', 2020, 4950000, 'used', 'Pickup', 'Diesel', 'Manual', '4WD', 2400, 112000, 'White', 5, 1, 1],
  ['Isuzu', 'D-Max', 'LS Double Cab', 2020, 4890000, 'used', 'Pickup', 'Diesel', 'Manual', '4WD', 2500, 128000, 'White', 5, 1, 0],
  ['Nissan', 'Navara', 'SE Double Cab', 2019, 4350000, 'used', 'Pickup', 'Diesel', 'Automatic', '4WD', 2300, 134000, 'Grey', 5, 1, 0],
  ['Mitsubishi', 'L200', 'Sportero', 2019, 4180000, 'used', 'Pickup', 'Diesel', 'Automatic', '4WD', 2400, 121000, 'Silver', 5, 1, 0],
  ['Toyota', 'Hiace', '9L Van', 2018, 3450000, 'used', 'Van', 'Diesel', 'Manual', '2WD', 2500, 168000, 'White', 9, 1, 0],
  ['Nissan', 'X-Trail', '20X', 2018, 2950000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 74000, 'Bronze', 5, 1, 1],
  ['Toyota', 'Corolla Cross', 'Hybrid GR-S', 2026, 5950000, 'new', 'SUV', 'Hybrid', 'Automatic', '2WD', 1800, 0, 'Pearl White', 5, 1, 1],

  ['Toyota', 'Passo', 'Moda', 2019, 1290000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1000, 58000, 'Mint', 5, 2, 0],
  ['Suzuki', 'Swift', 'RS', 2019, 1490000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1200, 61000, 'Red', 5, 2, 1],
  ['Honda', 'Fit', 'Hybrid F Package', 2018, 1240000, 'foreign_used', 'Hatchback', 'Hybrid', 'Automatic', '2WD', 1500, 82000, 'Silver', 5, 2, 0],
  ['Mazda', 'Axela', 'Sport 15S', 2018, 1890000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1500, 79000, 'Deep Blue', 5, 2, 0],
  ['Toyota', 'Probox', 'DX', 2016, 980000, 'used', 'Van', 'Petrol', 'Automatic', '2WD', 1500, 186000, 'White', 5, 2, 0],
  ['Nissan', 'March', 'Bolero', 2017, 810000, 'used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1200, 142000, 'Purple', 5, 2, 0],
  ['Honda', 'Vezel', 'Hybrid Z', 2018, 2650000, 'foreign_used', 'SUV', 'Hybrid', 'Automatic', '2WD', 1500, 71000, 'Black', 5, 2, 1],

  ['Mercedes-Benz', 'C200', 'AMG Line', 2019, 4750000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 2000, 58000, 'Obsidian Black', 5, 3, 1],
  ['BMW', '320i', 'M Sport', 2019, 4450000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 2000, 63000, 'Alpine White', 5, 3, 1],
  ['Land Rover', 'Discovery Sport', 'HSE', 2018, 6250000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '4WD', 2000, 77000, 'Santorini Black', 7, 3, 1],
  ['Volkswagen', 'Tiguan', 'R-Line', 2019, 4550000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 1400, 68000, 'Silver', 5, 3, 0],
  ['Audi', 'Q5', 'Quattro S-Line', 2018, 5350000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 74000, 'Grey', 5, 3, 0],
  ['Toyota', 'Land Cruiser V8', 'ZX', 2016, 9800000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '4WD', 4500, 118000, 'Pearl White', 7, 3, 1],
  ['Mercedes-Benz', 'GLE 350d', 'AMG Premium', 2019, 8900000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 3000, 66000, 'Selenite Grey', 5, 3, 0],

  ['Subaru', 'Forester', 'XT Turbo', 2018, 3150000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 81000, 'Dark Blue', 5, 4, 1],
  ['Subaru', 'Impreza', 'Sport', 2018, 2350000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', 'AWD', 1600, 76000, 'Crystal White', 5, 4, 0],
  ['Mazda', 'CX-5', 'XD L Package', 2018, 3250000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 2200, 84000, 'Soul Red', 5, 4, 1],
  ['Honda', 'CR-V', 'EX Masterpiece', 2019, 3950000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 1500, 69000, 'Lunar Silver', 5, 4, 0],
  ['Mitsubishi', 'Outlander', 'PHEV G', 2018, 2790000, 'foreign_used', 'SUV', 'Hybrid', 'Automatic', 'AWD', 2000, 88000, 'White Pearl', 5, 4, 0],
  ['Toyota', 'Rav4', 'Adventure', 2019, 4650000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 64000, 'Urban Khaki', 5, 4, 1],
  ['Toyota', 'Voxy', 'ZS Kirameki', 2018, 2890000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 2000, 79000, 'Black', 8, 4, 0],
  ['Nissan', 'Serena', 'Highway Star', 2018, 2650000, 'foreign_used', 'MPV', 'Hybrid', 'Automatic', '2WD', 2000, 83000, 'Silver', 8, 4, 0],

  // ---- second wave of stock, so every yard still looks full once the demo pipeline reserves units ----
  ['Toyota', 'Vitz', 'Jewela', 2017, 950000, 'used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1000, 118000, 'White', 5, 0, 0],
  ['Toyota', 'Belta', 'X Business', 2016, 890000, 'used', 'Sedan', 'Petrol', 'Automatic', '2WD', 1300, 152000, 'Silver', 5, 0, 0],
  ['Toyota', 'Wish', 'X S Package', 2017, 1750000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 1800, 94000, 'Grey', 7, 0, 0],
  ['Toyota', 'Allion', 'A15 G Plus', 2018, 2280000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 1500, 81000, 'Pearl White', 5, 0, 0],
  ['Nissan', 'Juke', '15RX', 2017, 1420000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', '2WD', 1500, 97000, 'Red', 5, 0, 0],
  ['Honda', 'Insight', 'Exclusive', 2018, 1560000, 'foreign_used', 'Sedan', 'Hybrid', 'Automatic', '2WD', 1500, 76000, 'Blue', 5, 0, 0],
  ['Mazda', 'CX-3', 'XD Touring', 2018, 2180000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '2WD', 1500, 88000, 'Soul Red', 5, 0, 0],
  ['Toyota', 'Land Cruiser Prado', 'TZ-G', 2019, 8400000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '4WD', 2800, 61000, 'Pearl White', 7, 0, 1],

  ['Isuzu', 'NPR', '5-Tonne Box Body', 2019, 5200000, 'used', 'Truck', 'Diesel', 'Manual', '2WD', 3000, 142000, 'White', 3, 1, 0],
  ['Toyota', 'Land Cruiser', '79 Series Pickup', 2018, 7200000, 'used', 'Pickup', 'Diesel', 'Manual', '4WD', 4200, 138000, 'White', 5, 1, 1],
  ['Toyota', 'Fortuner', 'GX', 2019, 5600000, 'used', 'SUV', 'Diesel', 'Automatic', '4WD', 2400, 108000, 'Silver', 7, 1, 0],
  ['Nissan', 'NV350 Caravan', 'DX', 2018, 3150000, 'foreign_used', 'Van', 'Diesel', 'Manual', '2WD', 2500, 121000, 'White', 6, 1, 0],
  ['Mitsubishi', 'Fuso Canter', '3.5T', 2018, 3900000, 'used', 'Truck', 'Diesel', 'Manual', '2WD', 3000, 156000, 'White', 3, 1, 0],
  ['Toyota', 'Hilux', 'Single Cab', 2019, 3450000, 'used', 'Pickup', 'Diesel', 'Manual', '2WD', 2400, 149000, 'White', 3, 1, 0],
  ['Suzuki', 'Jimny', 'Sierra', 2019, 3100000, 'foreign_used', 'SUV', 'Petrol', 'Manual', '4WD', 1500, 54000, 'Kinetic Yellow', 4, 1, 1],
  ['Toyota', 'Rush', 'G', 2020, 3250000, 'used', 'SUV', 'Petrol', 'Automatic', '2WD', 1500, 72000, 'Silver', 7, 1, 0],

  ['Toyota', 'Ractis', 'X', 2016, 830000, 'used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1300, 164000, 'Blue', 5, 2, 0],
  ['Nissan', 'Tiida', 'Latio', 2015, 720000, 'used', 'Sedan', 'Petrol', 'Automatic', '2WD', 1500, 178000, 'Silver', 5, 2, 0],
  ['Toyota', 'Porte', 'Welcab', 2017, 1080000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 1300, 92000, 'Beige', 5, 2, 0],
  ['Suzuki', 'Alto', 'Lapin', 2018, 690000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 660, 68000, 'Cream', 4, 2, 0],
  ['Daihatsu', 'Mira', 'e:S', 2018, 660000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 660, 71000, 'White', 4, 2, 0],
  ['Honda', 'Freed', 'Hybrid G', 2017, 1480000, 'foreign_used', 'MPV', 'Hybrid', 'Automatic', '2WD', 1500, 89000, 'Silver', 7, 2, 0],
  ['Toyota', 'Sienta', 'G', 2018, 1690000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 1500, 77000, 'Orange', 7, 2, 1],
  ['Nissan', 'Note', 'Medalist', 2017, 990000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 1200, 103000, 'Grey', 5, 2, 0],

  ['BMW', 'X3', 'xDrive20d M Sport', 2018, 5450000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 2000, 71000, 'Mineral Grey', 5, 3, 0],
  ['Mercedes-Benz', 'E250', 'Avantgarde', 2018, 5900000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 2000, 62000, 'Iridium Silver', 5, 3, 0],
  ['Porsche', 'Macan', 'S', 2017, 7600000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 3000, 69000, 'Carrara White', 5, 3, 1],
  ['Land Rover', 'Range Rover Evoque', 'SE Dynamic', 2018, 5850000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 2000, 73000, 'Firenze Red', 5, 3, 0],
  ['Volkswagen', 'Golf', 'GTI', 2018, 3250000, 'foreign_used', 'Hatchback', 'Petrol', 'Automatic', '2WD', 2000, 66000, 'Tornado Red', 5, 3, 0],
  ['Lexus', 'RX 300', 'F Sport', 2019, 8200000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', 'AWD', 2000, 58000, 'Sonic Titanium', 5, 3, 1],
  ['Jaguar', 'F-Pace', 'Prestige', 2017, 5400000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 2000, 79000, 'Ammonite Grey', 5, 3, 0],
  ['Audi', 'A4', '2.0 TFSI S-Line', 2018, 3950000, 'foreign_used', 'Sedan', 'Petrol', 'Automatic', '2WD', 2000, 68000, 'Glacier White', 5, 3, 0],

  ['Subaru', 'Outback', 'Limited', 2018, 3450000, 'foreign_used', 'Station Wagon', 'Petrol', 'Automatic', 'AWD', 2500, 82000, 'Storm Grey', 5, 4, 0],
  ['Subaru', 'XV', 'Advance Hybrid', 2019, 3050000, 'foreign_used', 'SUV', 'Hybrid', 'Automatic', 'AWD', 2000, 64000, 'Lagoon Blue', 5, 4, 0],
  ['Toyota', 'Harrier', 'Turbo Elegance', 2019, 4750000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', '2WD', 2000, 59000, 'Precious Black', 5, 4, 1],
  ['Nissan', 'Patrol', 'Ti-L', 2016, 8600000, 'foreign_used', 'SUV', 'Petrol', 'Automatic', '4WD', 5600, 112000, 'Gun Metallic', 7, 4, 0],
  ['Mazda', 'CX-8', 'XD L Package', 2019, 4250000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', 'AWD', 2200, 67000, 'Machine Grey', 7, 4, 0],
  ['Toyota', 'Alphard', 'S C Package', 2018, 5250000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 2500, 74000, 'Black', 8, 4, 1],
  ['Honda', 'Odyssey', 'Absolute EX', 2018, 3350000, 'foreign_used', 'MPV', 'Petrol', 'Automatic', '2WD', 2400, 86000, 'White Orchid', 8, 4, 0],
  ['Mitsubishi', 'Pajero', 'Exceed', 2016, 4450000, 'foreign_used', 'SUV', 'Diesel', 'Automatic', '4WD', 3200, 124000, 'Cool Silver', 7, 4, 0],
];

const STAFF = [
  ['Zain Santos', 'admin@motoke.demo', 'admin123', 'superadmin', null],
  ['Grace Wanjiku', 'grace@summitmotors.demo', 'demo123', 'dealer_admin', 0],
  ['Brian Otieno', 'brian@summitmotors.demo', 'demo123', 'sales_agent', 0],
  ['Faith Njeri', 'faith@summitmotors.demo', 'demo123', 'finance_officer', 0],
  ['Janet Muthoni', 'janet@summitmotors.demo', 'demo123', 'receptionist', 0],
  ['Ali Hassan', 'ali@saharaauto.demo', 'demo123', 'dealer_admin', 1],
  ['Mercy Chebet', 'mercy@zawadimotors.demo', 'demo123', 'dealer_admin', 2],
  ['Daniel Kimani', 'daniel@highlandprestige.demo', 'demo123', 'dealer_admin', 3],
  ['Salma Omar', 'salma@pwanibazaar.demo', 'demo123', 'dealer_admin', 4],
];

function seedIfEmpty() {
  const existing = get('SELECT COUNT(*) AS n FROM dealers');
  if (existing && existing.n > 0) return { seeded: false };

  const dealerIds = [];
  for (const d of DEALERS) {
    const { branches, ...row } = d;
    const id = insert('dealers', row);
    dealerIds.push(id);
    for (const b of branches) insert('branches', { ...b, dealer_id: id });
  }

  const lenderIds = LENDERS.map((l) => insert('lenders', l));

  // Every dealer offers every lender except the in-house plan, which only
  // Zawadi (the first-time-buyer specialist) and Pwani run.
  const inHouseId = lenderIds[lenderIds.length - 1];
  dealerIds.forEach((did, i) => {
    lenderIds.forEach((lid) => {
      const enabled = lid === inHouseId ? (i === 2 || i === 4 ? 1 : 0) : 1;
      insert('dealer_lenders', { dealer_id: did, lender_id: lid, enabled });
    });
  });

  for (const v of VEHICLES) {
    const [make, model, variant, year, price, condition, body, fuel, trans, drive, cc, km, color, seats, dIdx, featured] = v;
    const dealerId = dealerIds[dIdx];
    const branch = get('SELECT id FROM branches WHERE dealer_id=? LIMIT 1', [dealerId]);
    const tier = price > 4000000 ? ['common', 'mid', 'high'] : price > 2000000 ? ['common', 'mid'] : ['common'];
    insert('vehicles', {
      dealer_id: dealerId,
      branch_id: branch ? branch.id : null,
      make,
      model,
      variant,
      year,
      price,
      old_price: featured ? Math.round((price * 1.06) / 10000) * 10000 : null,
      condition,
      body_type: body,
      fuel,
      transmission: trans,
      drivetrain: drive,
      engine_cc: cc,
      mileage_km: km,
      color,
      seats,
      doors: body === 'Pickup' ? 4 : body === 'Van' || body === 'MPV' ? 5 : body === 'Sedan' ? 4 : 5,
      reg_no: `K${String.fromCharCode(65 + (year % 26))}${String.fromCharCode(65 + (price % 26))} ${100 + (price % 800)}${String.fromCharCode(65 + (km % 26))}`,
      status: 'available',
      featured,
      description: `${year} ${make} ${model} ${variant || ''}`.trim() +
        `. ${condition === 'new' ? 'Brand new, zero mileage, full manufacturer warranty.' : condition === 'foreign_used' ? 'Directly imported, duty paid, cleared and registered.' : 'Locally used, one owner, full service history available.'} ${trans} transmission, ${fuel.toLowerCase()} engine${cc ? ` (${cc}cc)` : ''}.`,
      images: JSON.stringify(gallery(make, model, color)),
      features: feat(...tier),
      duty_paid: 1,
      // a slice of the imported stock is still clearing the port / awaiting plates
      reg_status: condition === 'foreign_used' && price % 7 === 0 ? 'awaiting_registration' : condition === 'new' ? 'awaiting_registration' : 'registered',
      reg_expected_date:
        condition === 'foreign_used' && price % 7 === 0
          ? new Date(Date.now() + (18 + (price % 40)) * 864e5).toISOString().slice(0, 10)
          : null,
      negotiable: price > 2500000 ? 1 : 0,
      verified: 1,
      warranty_months: condition === 'new' ? 36 : price > 3000000 ? 6 : 3,
      source_ref: condition === 'foreign_used' ? `CFJ${1000000 + (price % 8999999)}` : null,
      ...specsFor(make, model, condition, km, price),
    });
  }

  for (const [name, email, password, role, dIdx] of STAFF) {
    const { hash, salt } = hashPassword(password);
    insert('users', {
      name,
      email,
      role,
      password_hash: hash,
      salt,
      dealer_id: dIdx == null ? null : dealerIds[dIdx],
      phone: '+2547' + String(10000000 + Math.floor(Math.random() * 89999999)),
    });
  }

  // one demo customer
  const c = hashPassword('demo123');
  insert('users', {
    name: 'John Mwangi',
    email: 'customer@motoke.demo',
    role: 'customer',
    password_hash: c.hash,
    salt: c.salt,
    phone: '+254712345678',
  });

  setSetting('platform_name', 'MotoKE');
  setSetting('currency', 'KES');
  setSetting('seeded_at', new Date().toISOString());
  setSetting('content_updated_at', new Date().toISOString());

  // One dealership per deployment. Change this to hand the same build to another yard.
  setSetting('site_dealer', DEALERS[0].slug);

  // Booking deposits
  setSetting('booking_fee_pct', 2);
  setSetting('booking_fee_min', 20000);
  setSetting('booking_fee_max', 150000);
  setSetting('booking_hold_days', 7);

  // Pump prices: EPRA maximum retail, Nairobi. Refreshed automatically from here on.
  setSetting('cost_petrol_price', 195);
  setSetting('cost_diesel_price', 180);
  setSetting('cost_prices_as_at', new Date().toISOString());
  setSetting('fuel_auto_update', 'on');
  /* EPRA's published pump prices. Verified to parse, and the scraper reads the
     dealership's own town rather than the first row (which is Mombasa, and cheaper). */
  setSetting('fuel_source_url', require('./market').DEFAULT_FUEL_SOURCE);

  setSetting('require_staff_2fa', 'on');
  setSetting('demo_mode', 'on');

  /* This is a SINGLE-DEALERSHIP install, so almost everything belongs to the yard the
     storefront serves. The stock list above is laid out across five dealerships because
     the security boundary needs something on the other side of it to be provable — with
     an empty far side, `smoke.js` asserting "another yard's car is not reachable" would
     pass for the wrong reason. Three cars each is enough for that; the rest come home,
     otherwise four cars in five are invisible to the shop. */
  const KEEP_FOREIGN = 3;
  const siteId = dealerIds[0];
  const siteBranches = all('SELECT id FROM branches WHERE dealer_id=? ORDER BY id', [siteId]).map((b) => b.id);
  let moved = 0;
  for (const otherId of dealerIds.slice(1)) {
    const rows = all('SELECT id FROM vehicles WHERE dealer_id=? ORDER BY price ASC', [otherId]).slice(KEEP_FOREIGN);
    for (const row of rows) {
      // Re-point the branch too, or the listing shows another company's address.
      run('UPDATE vehicles SET dealer_id=?, branch_id=? WHERE id=?', [siteId, siteBranches[moved % siteBranches.length], row.id]);
      moved++;
    }
  }

  return { seeded: true, dealers: dealerIds.length, lenders: lenderIds.length, vehicles: VEHICLES.length, consolidated: moved };
}

module.exports = { seedIfEmpty, DEALERS, LENDERS, MEASURED, inspectionFor };
