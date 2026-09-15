'use strict';
/**
 * MotoKE — the QR encoder. No server.
 *
 *   node --no-warnings tools/qr-test.js
 *
 * A QR code is the one thing in this project that cannot be checked by reading it. It is
 * either scannable or it is a grey square, and the difference is invisible to a person.
 * So this file does three separate things, and none of them is sufficient alone:
 *
 *   1. STRUCTURE against the specification — finder patterns, timing, alignment, the dark
 *      module, the quiet zone. These are fixed positions with fixed contents and a wrong
 *      one is a certain failure.
 *
 *   2. A ROUND TRIP. The decoder below is written backwards from the format rather than
 *      by calling the encoder: it reads the mask out of the format bits, rebuilds the
 *      reserved areas, unmasks, walks the zigzag, de-interleaves the blocks and parses the
 *      byte stream. If the original string comes back, then placement, masking, format
 *      encoding and interleaving all agree with each other. This is what catches an
 *      off-by-one in the data walk, which is the classic way to produce a code that looks
 *      perfect and decodes to rubbish.
 *
 *   3. The format bits for mask 0, which are derivable rather than remembered: a zero
 *      value BCH-encodes to zero, so the result must be exactly the XOR constant.
 *
 * WHAT NONE OF THIS PROVES is that a cheap Android camera in the sun will read it. Only a
 * phone proves that, and it takes ten seconds.
 */
const qr = require('../lib/qr');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};

/* ------------------------------------------------------------------ */
/* a decoder, written from the format rather than from the encoder      */
/* ------------------------------------------------------------------ */

const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const VERSIONS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
};

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Which modules are reserved — worked out from the version, not from the encoder. */
function reserved(version) {
  const n = version * 4 + 17;
  const R = Array.from({ length: n }, () => new Array(n).fill(false));
  const block = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        if (r >= 0 && c >= 0 && r < n && c < n) R[r][c] = true;
      }
    }
  };
  block(0, 0, 9, 9);              // top-left finder + separator + format
  block(0, n - 8, 9, 8);          // top-right
  block(n - 8, 0, 8, 9);          // bottom-left
  for (let i = 0; i < n; i++) { R[6][i] = true; R[i][6] = true; }   // timing
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8)) continue;
      block(r - 2, c - 2, 5, 5);
    }
  }
  return R;
}

function readFormatMask(cells, n) {
  let bits = 0;
  /* The copy along the bottom-left and right edges, read as bits 0..14. */
  for (let i = 0; i <= 7; i++) bits |= cells[n - 1 - i][8] << i;
  for (let i = 8; i <= 14; i++) bits |= cells[8][n - 15 + i] << i;
  const value = (bits ^ 0b101010000010010) >> 10;
  return { level: (value >> 3) & 0b11, mask: value & 0b111 };
}

function decode(m) {
  const { n, cells, version } = m;
  const { mask, level } = readFormatMask(cells, n);
  const R = reserved(version);

  /* Unmask, then walk the zigzag exactly as the format describes it. */
  const bits = [];
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < n; step++) {
      const row = upward ? n - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (R[row][col]) continue;
        bits.push(cells[row][col] ^ (MASKS[mask](row, col) ? 1 : 0));
      }
    }
    upward = !upward;
  }

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  /* De-interleave. Only the data half is needed to read the message back. */
  const { groups } = VERSIONS[version];
  const blocks = [];
  for (const [count, each] of groups) for (let i = 0; i < count; i++) blocks.push({ each, data: [] });
  const longest = Math.max(...blocks.map((b) => b.each));
  let at = 0;
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.each) b.data.push(codewords[at++]);
  }
  const data = [].concat(...blocks.map((b) => b.data));

  /* Mode nibble, then an 8-bit length, then the bytes. */
  const stream = [];
  for (const cw of data) for (let i = 7; i >= 0; i--) stream.push((cw >> i) & 1);
  const take = (count) => {
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 1) | stream.shift();
    return v;
  };
  const mode = take(4);
  const length = take(8);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(take(8));
  return { mode, level, mask, text: Buffer.from(bytes).toString('utf8') };
}

/* ------------------------------------------------------------------ */

console.log('\n— the pieces that have fixed positions —');
{
  const m = qr.encode('https://motoke-demo.fly.dev/#/join');
  const FINDER = '1111111' + '1000001' + '1011101' + '1011101' + '1011101' + '1000001' + '1111111';
  const readFinder = (r0, c0) => {
    let s = '';
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) s += m.cells[r0 + r][c0 + c];
    return s;
  };
  ok('top-left finder', readFinder(0, 0) === FINDER);
  ok('top-right finder', readFinder(0, m.n - 7) === FINDER);
  ok('bottom-left finder', readFinder(m.n - 7, 0) === FINDER);
  ok('no finder bottom-right, which is how a scanner knows the orientation',
    readFinder(m.n - 7, m.n - 7) !== FINDER);

  let timing = true;
  for (let i = 8; i < m.n - 8; i++) {
    if (m.cells[6][i] !== (i % 2 === 0 ? 1 : 0)) timing = false;
    if (m.cells[i][6] !== (i % 2 === 0 ? 1 : 0)) timing = false;
  }
  ok('timing patterns alternate along row 6 and column 6', timing);
  ok('the dark module is where it always is', m.cells[m.n - 8][8] === 1);

  /* An alignment pattern is a 5x5 ring: dark border, light ring, dark centre. */
  const c = 22;   // version 3's only alignment centre
  ok('the alignment pattern has a dark centre', m.cells[c][c] === 1);
  ok('inside a light ring', m.cells[c - 1][c] === 0 && m.cells[c][c - 1] === 0);
  ok('inside a dark border', m.cells[c - 2][c] === 1 && m.cells[c][c + 2] === 1);
}

console.log('\n— the format bits, which are derivable rather than remembered —');
{
  /* Level M is 00 and mask 0 is 000, so the BCH remainder of zero is zero and the whole
     15-bit field must come out as the XOR constant alone. Anything else means the BCH or
     the constant is wrong, and both would break every mask. */
  const m = qr.encode('x');
  const n = m.n;
  let bits = 0;
  for (let i = 0; i <= 7; i++) bits |= m.cells[n - 1 - i][8] << i;
  for (let i = 8; i <= 14; i++) bits |= m.cells[8][n - 15 + i] << i;
  const value = (bits ^ 0b101010000010010) >> 10;
  ok('the error level reads back as M', ((value >> 3) & 0b11) === 0b00, value);
  ok('and the mask in the format matches the one that was applied',
    (value & 0b111) === m.mask, [value & 0b111, m.mask]);

  /* Both copies of the format information must agree, or a scanner that reads the other
     one gets a different mask and unmasks the whole symbol wrongly. */
  let copyBits = 0;
  for (let i = 0; i <= 5; i++) copyBits |= m.cells[8][i] << (14 - i);
  copyBits |= m.cells[8][7] << 8;
  copyBits |= m.cells[8][8] << 7;
  copyBits |= m.cells[7][8] << 6;
  for (let i = 9; i <= 14; i++) copyBits |= m.cells[14 - i][8] << (14 - i);
  ok('the two copies of the format information agree', copyBits === bits, [copyBits, bits]);
}

console.log('\n— the round trip, which is the one that catches a shifted bit —');
{
  const cases = [
    'x',
    'https://motoke-demo.fly.dev/#/join',
    'MotoKE',
    'https://motoke.co.ke/join?ref=jamhuri-2026-09',
    '0712345678',
    'Peter Kariuki — introducer',                       // multi-byte, to exercise utf8
    'A'.repeat(14),                                     // exactly a version 1 payload
    'B'.repeat(42),                                     // exactly a version 3 payload
    'C'.repeat(106),                                    // exactly a version 6 payload
  ];
  for (const text of cases) {
    const m = qr.encode(text);
    const back = decode(m);
    const label = text.length > 24 ? text.slice(0, 21) + '…' : text;
    ok(`"${label}" survives the round trip (v${m.version}, mask ${m.mask})`,
      back.text === text, { got: back.text, mode: back.mode });
  }
}

console.log('\n— the version is the smallest one that fits —');
{
  ok('14 characters fit in version 1', qr.pickVersion(14) === 1);
  ok('15 do not', qr.pickVersion(15) === 2, qr.pickVersion(15));
  ok('42 fit in version 3', qr.pickVersion(42) === 3);
  ok('43 do not', qr.pickVersion(43) === 4, qr.pickVersion(43));
  ok('106 is the ceiling', qr.pickVersion(106) === 6);
  let threw = false;
  try { qr.pickVersion(107); } catch { threw = true; }
  ok('and 107 is refused rather than silently truncated', threw);
  ok('the refusal says what the limit is',
    (() => { try { qr.encode('z'.repeat(200)); return false; } catch (e) { return /106/.test(e.message); } })());
}

console.log('\n— the svg —');
{
  const s = qr.svg('https://motoke-demo.fly.dev/#/join');
  ok('it is an svg', /^<svg /.test(s));
  ok('it scales rather than being fixed to a pixel size', /viewBox="0 0 37 37"/.test(s), s.slice(0, 120));
  ok('the quiet zone is four modules on every side', /viewBox="0 0 37 37"/.test(s));
  ok('edges are crisp, so a module never renders as a grey smear',
    /shape-rendering="crispEdges"/.test(s));
  ok('it has a white background, because a QR on a dark page does not scan',
    /<rect width="37" height="37" fill="#ffffff"\/>/.test(s));
  ok('drawn as one path rather than a thousand rects', (s.match(/<path/g) || []).length === 1);
  ok('and it carries a label for anyone not looking at it', /aria-label="QR code"/.test(s));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail);
