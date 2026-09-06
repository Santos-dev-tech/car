'use strict';
/**
 * MotoKE - sample pipeline activity so the admin console has something in it
 * on first run. Only ever runs when the applications table is empty.
 */
const { all, get, insert, run, update } = require('./db');
const fin = require('./finance');

const NAMES = [
  ['Peter Kamau', 'peter.kamau@example.com', '+254712004501', 'employed', 145000, 22000],
  ['Aisha Mohamed', 'aisha.m@example.com', '+254722004502', 'business', 320000, 65000],
  ['Dennis Ochieng', 'dennis.o@example.com', '+254733004503', 'self_employed', 98000, 15000],
  ['Caroline Wairimu', 'caro.w@example.com', '+254701004504', 'employed', 210000, 48000],
  ['Samuel Kiptoo', 'sam.kiptoo@example.com', '+254715004505', 'contract', 87000, 9000],
  ['Njeri Mwangi', 'njeri.mw@example.com', '+254726004506', 'employed', 175000, 31000],
  ['Hassan Abdi', 'hassan.abdi@example.com', '+254738004507', 'business', 260000, 40000],
  ['Lydia Akinyi', 'lydia.a@example.com', '+254709004508', 'employed', 64000, 8000],
  ['George Mutua', 'g.mutua@example.com', '+254717004509', 'self_employed', 130000, 26000],
  ['Winnie Chelangat', 'winnie.c@example.com', '+254729004510', 'employed', 92000, 12000],
  ['Ibrahim Yusuf', 'ibrahim.y@example.com', '+254740004511', 'gig', 55000, 6000],
  ['Esther Nduta', 'esther.n@example.com', '+254712004512', 'employed', 305000, 70000],
  ['Kevin Barasa', 'kevin.b@example.com', '+254721004513', 'contract', 78000, 11000],
  ['Rose Atieno', 'rose.at@example.com', '+254735004514', 'business', 190000, 33000],
  ['Tom Kariuki', 'tom.k@example.com', '+254748004515', 'employed', 118000, 19000],
  ['Nancy Wangui', 'nancy.w@example.com', '+254702004516', 'employed', 240000, 52000],
  ['Collins Otieno', 'collins.o@example.com', '+254713004517', 'self_employed', 85000, 14000],
  ['Zawadi Mwende', 'zawadi.m@example.com', '+254724004518', 'employed', 160000, 28000],
  ['Brian Njoroge', 'brian.nj@example.com', '+254737004519', 'gig', 48000, 5000],
  ['Halima Said', 'halima.s@example.com', '+254749004520', 'business', 410000, 90000],
  ['Michael Oduor', 'mike.od@example.com', '+254703004521', 'employed', 135000, 24000],
  ['Purity Mueni', 'purity.m@example.com', '+254714004522', 'contract', 72000, 7000],
];

const STATUS_MIX = [
  'new', 'new', 'new', 'new',
  'documents_pending', 'documents_pending', 'documents_pending',
  'under_review', 'under_review', 'under_review',
  'submitted_to_lender', 'submitted_to_lender', 'submitted_to_lender',
  'approved', 'approved', 'approved',
  'disbursed', 'disbursed',
  'delivered', 'delivered',
  'declined', 'cancelled',
];

const STATUS_STORY = {
  new: [['created', 'Application submitted from the website.']],
  documents_pending: [
    ['created', 'Application submitted from the website.'],
    ['status', 'Status moved to documents pending — awaiting payslips and bank statements.'],
  ],
  under_review: [
    ['created', 'Application submitted from the website.'],
    ['documents', 'ID, KRA PIN and 6 months bank statements received.'],
    ['status', 'Status moved to under review — internal credit check running.'],
  ],
  submitted_to_lender: [
    ['created', 'Application submitted from the website.'],
    ['documents', 'Full document set received.'],
    ['status', 'Status moved to under review.'],
    ['status', 'Pack submitted to the lender. Pro-forma invoice and valuation attached.'],
  ],
  approved: [
    ['created', 'Application submitted from the website.'],
    ['documents', 'Full document set received.'],
    ['status', 'Pack submitted to the lender.'],
    ['status', 'Lender approved the facility. Offer letter issued for signature.'],
  ],
  disbursed: [
    ['created', 'Application submitted from the website.'],
    ['documents', 'Full document set received.'],
    ['status', 'Lender approved the facility.'],
    ['note', 'Offer letter signed; comprehensive insurance placed.'],
    ['status', 'Funds disbursed to the dealership. Logbook process started.'],
  ],
  delivered: [
    ['created', 'Application submitted from the website.'],
    ['documents', 'Full document set received.'],
    ['status', 'Lender approved the facility.'],
    ['status', 'Funds disbursed to the dealership.'],
    ['status', 'Vehicle handed over to the customer. Logbook lodged with the lender.'],
  ],
  declined: [
    ['created', 'Application submitted from the website.'],
    ['status', 'Pack submitted to the lender.'],
    ['status', 'Declined — adverse CRB listing. Customer referred to the in-house plan.'],
  ],
  cancelled: [
    ['created', 'Application submitted from the website.'],
    ['note', 'Customer could not raise the deposit within 14 days.'],
    ['status', 'Application cancelled at the customer’s request.'],
  ],
};

const LEADS = [
  ['test_drive', 'Anne Wanjiru', '+254712880001', 'Would like a Saturday morning slot.'],
  ['test_drive', 'Joseph Kilonzo', '+254722880002', 'Interested in the double cab for a farm run.'],
  ['trade_in', 'Mary Njoki', '+254733880003', 'Trading in a 2013 Toyota Auris.'],
  ['trade_in', 'Ken Mutiso', '+254701880004', '2015 Subaru Impreza, 140,000 km.'],
  ['callback', 'Sylvia Adhiambo', '+254715880005', 'Call after 5pm, wants to know about sacco financing.'],
  ['enquiry', 'Ali Bakari', '+254726880006', 'Do you deliver to Mombasa?'],
  ['enquiry', 'Grace Mumbi', '+254738880007', 'Is the price negotiable for cash buyers?'],
  ['callback', 'Victor Kiplagat', '+254709880008', 'Wants a fleet quote for 4 units.'],
];

function daysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString().replace('T', ' ').slice(0, 19);
}
const pick = (arr, i) => arr[i % arr.length];

function seedDemoActivity() {
  const existing = get('SELECT COUNT(*) n FROM applications');
  if (existing && existing.n > 0) return { seeded: false };

  const dealers = all('SELECT * FROM dealers ORDER BY id');
  if (!dealers.length) return { seeded: false };
  const staff = all("SELECT * FROM users WHERE role IN ('sales_agent','dealer_admin','finance_officer')");

  let made = 0;
  NAMES.forEach((person, i) => {
    const [fullName, email, phone, employment, netIncome, obligations] = person;
    const dealer = pick(dealers, i);
    const vehicles = all("SELECT * FROM vehicles WHERE dealer_id=? AND status='available' ORDER BY id", [dealer.id]);
    if (!vehicles.length) return;
    const vehicle = pick(vehicles, i * 3 + 1);
    const lenders = all(
      `SELECT l.* FROM lenders l LEFT JOIN dealer_lenders dl ON dl.lender_id=l.id AND dl.dealer_id=?
       WHERE l.active=1 AND (dl.dealer_id IS NULL OR dl.enabled=1) ORDER BY l.sort_order`,
      [dealer.id]
    );
    if (!lenders.length) return;

    const status = pick(STATUS_MIX, i);
    const tenor = [24, 36, 48, 60][i % 4];
    const depositPct = [20, 25, 30, 35][i % 4];
    const deposit = Math.round((vehicle.price * depositPct) / 100);
    const applicantProfile = { netIncome, obligations, employment, crbClean: status !== 'declined', age: 28 + (i % 22) };

    // choose the lender the engine would actually recommend for this profile
    const cmp = fin.compare(lenders, { price: vehicle.price, deposit, tenorMonths: tenor, vehicle, applicant: applicantProfile });
    const chosen = cmp.offers[i % Math.max(1, Math.min(3, cmp.offers.length))] || cmp.offers[0];
    const lender = lenders.find((l) => l.id === chosen.lenderId) || lenders[0];
    const offer = fin.quote(lender, { price: vehicle.price, deposit, tenorMonths: tenor, vehicle, applicant: applicantProfile });

    const created = daysAgo(46 - i * 2);
    const ref = `MK-${created.slice(2, 4)}${created.slice(5, 7)}-${(1000 + i * 137).toString(16).toUpperCase().padStart(6, '0').slice(-6)}`;
    const assignee = staff.filter((s) => s.dealer_id === dealer.id)[i % Math.max(1, staff.filter((s) => s.dealer_id === dealer.id).length)];

    const appId = insert('applications', {
      ref,
      dealer_id: dealer.id,
      vehicle_id: vehicle.id,
      lender_id: lender.id,
      user_id: null,
      applicant: JSON.stringify({
        fullName,
        email,
        phone,
        idNumber: String(20000000 + i * 33331),
        kraPin: 'A00' + (1000000 + i * 7919) + 'X',
        dob: `19${70 + (i % 25)}-0${1 + (i % 9)}-1${i % 9}`,
        address: pick(['Kilimani, Nairobi', 'Nyali, Mombasa', 'Kileleshwa, Nairobi', 'Langata, Nairobi', 'Milimani, Nakuru'], i),
        maritalStatus: i % 2 ? 'married' : 'single',
        age: applicantProfile.age,
      }),
      employment: JSON.stringify({
        type: employment,
        employer: pick(['Safaricom PLC', 'Kenya Power', 'Self-employed', 'Ministry of Health', 'Bidco Africa', 'Own business'], i),
        position: pick(['Engineer', 'Accountant', 'Trader', 'Nurse', 'Sales Manager', 'Consultant'], i),
        yearsEmployed: 1 + (i % 12),
        netIncome,
        obligations,
        crbClean: applicantProfile.crbClean,
      }),
      offer: JSON.stringify(offer),
      vehicle_snapshot: JSON.stringify({
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant,
        year: vehicle.year,
        price: vehicle.price,
        condition: vehicle.condition,
        images: JSON.parse(vehicle.images || '[]'),
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      }),
      price: vehicle.price,
      deposit: offer.deposit,
      loan_amount: offer.principal,
      tenor_months: offer.tenorMonths,
      monthly_payment: offer.monthlyPayment,
      status,
      assigned_to: assignee ? assignee.id : null,
      created_at: created,
      updated_at: daysAgo(Math.max(0, 46 - i * 2 - 3)),
    });

    const story = STATUS_STORY[status] || STATUS_STORY.new;
    story.forEach(([type, message], k) => {
      insert('application_events', {
        application_id: appId,
        type,
        actor: k === 0 ? fullName : assignee ? assignee.name : 'System',
        message,
        created_at: daysAgo(Math.max(0, 46 - i * 2 - k)),
      });
    });

    if (['approved', 'submitted_to_lender', 'under_review', 'documents_pending'].includes(status))
      run("UPDATE vehicles SET status='reserved' WHERE id=?", [vehicle.id]);
    if (['disbursed', 'delivered'].includes(status)) run("UPDATE vehicles SET status='sold' WHERE id=?", [vehicle.id]);

    made++;
  });

  let leadsMade = 0;
  LEADS.forEach((l, i) => {
    const [type, name, phone, message] = l;
    const dealer = pick(dealers, i);
    const v = get('SELECT id FROM vehicles WHERE dealer_id=? ORDER BY id LIMIT 1 OFFSET ?', [dealer.id, i % 5]);
    insert('leads', {
      dealer_id: dealer.id,
      type,
      vehicle_id: type === 'trade_in' ? null : v ? v.id : null,
      name,
      phone,
      email: name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
      message,
      payload: JSON.stringify(type === 'trade_in' ? { currentVehicle: message, estimate: 850000 } : {}),
      status: i < 3 ? 'new' : i < 6 ? 'contacted' : 'closed',
      created_at: daysAgo(i * 3 + 1),
    });
    leadsMade++;
  });

  // give a few vehicles realistic view counts
  all('SELECT id FROM vehicles').forEach((v, i) => run('UPDATE vehicles SET views=? WHERE id=?', [((i * 37) % 240) + 12, v.id]));

  return { seeded: true, applications: made, leads: leadsMade };
}

module.exports = { seedDemoActivity };
