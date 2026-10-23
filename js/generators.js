// Problem templates. Each template turns random parameters into a problem.
// Nothing here is a fixed question bank: every number is drawn at random.
//
// A template's gen(rng, level) returns:
//   key      unique description of the numbers (used to detect repeats)
//   params   the raw numbers (used by the tests to re-check the answer)
//   shown    numbers that must appear in the question text
//   answer   the correct value
//   kind     'number' | 'percent' | 'years' | 'times'
//   exact    true if "exact" tolerance means the exact value
//   sig      otherwise: significant figures needed in "exact" mode
//   minTol   optional minimum relative tolerance (for rule-of-thumb answers)
//   explain  one-line shortcut
//   plain    plain phrasings of the question
//   frames   consulting-style phrasings: [{ id, text }]

import { clean, roundSig, sigDigits, fmtNum, fmtPct, withCommas, sup } from './format.js';

export const MODES = {
  mult: { name: 'Multiplication', icon: '×' },
  pct: { name: 'Percentages', icon: '%' },
  growth: { name: 'Growth rates', icon: '↗' },
  div: { name: 'Division', icon: '÷' },
};

// ---------- helpers ----------

const UNIT = { 0: '', 3: 'K', 6: 'M', 9: 'B', 12: 'T' };

// counts: commas below 1M ("1,250 stores"); money: compact ("€2.4M")
const F = (n) => fmtNum(n, { compact: false });
const C = (n) => fmtNum(n);
const cur = (r) => r.pick(['€', '£']);

// Format a result, rounding long values to 3 significant figures.
function approx(n, sig = 3) {
  return sigDigits(n) <= 4 ? fmtNum(n) : '≈ ' + fmtNum(roundSig(n, sig));
}
function approxPct(n, sig = 3) {
  return sigDigits(n) <= 4 ? fmtPct(n) : '≈ ' + fmtPct(roundSig(n, sig));
}
function signedPct(n) {
  return (n > 0 ? '+' : '') + fmtPct(n);
}
function fixed(n, d = 3) {
  return String(Number(n.toFixed(d)));
}

// [10, -20, -2] -> "10 − 20 − 2"
function sumExpr(terms) {
  return terms.map((t, i) => (i === 0 ? (t < 0 ? '−' : '') + withCommas(Math.abs(t), 2) : `${t < 0 ? '−' : '+'} ${withCommas(Math.abs(t), 2)}`)).join(' ');
}

function intNoZero(r, min, max) {
  let x;
  do x = r.int(min, max);
  while (x % 10 === 0);
  return x;
}

// A "business" number with `sig` significant digits in [10^minExp, 10^(maxExp+1))
function biz(r, sig, minExp, maxExp) {
  const exp = r.int(minExp, maxExp);
  const m = sig === 1 ? r.int(1, 9) : intNoZero(r, 10 ** (sig - 1), 10 ** sig - 1);
  return clean(m * 10 ** (exp - sig + 1));
}

// Retry fn() until ok(result) (generators use this to keep numbers tidy)
function until(fn, ok, tries = 200) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = fn();
    if (ok(v)) return v;
  }
  return v;
}

// 2.5M -> [2.5, 6]; 4,000 -> [4, 3]; 350 -> [350, 0]
function splitUnit(n) {
  const a = Math.abs(n);
  for (const e of [12, 9, 6, 3]) if (a >= 10 ** e) return [clean(n / 10 ** e), e];
  return [n, 0];
}

// 4,500 -> [45, 2]
function stripZeros(n) {
  let m = clean(n);
  let z = 0;
  if (!Number.isInteger(m)) return [m, 0];
  while (m !== 0 && m % 10 === 0) {
    m /= 10;
    z++;
  }
  return [m, z];
}

function zerosPhrase(z) {
  if (z === 0) return '';
  if (z > 0) return `, then add ${z} zero${z === 1 ? '' : 's'}`;
  return `, then move the decimal ${-z} place${z === -1 ? '' : 's'} left`;
}

// "Drop zeros: 42 ÷ 35 = 1.2, then add 4 zeros → 12,000"
function explainStripDivide(D, d, q) {
  const [mD, zD] = stripZeros(D);
  const [md, zd] = stripZeros(d);
  const core = clean(mD / md);
  if (zD === 0 && zd === 0) return `${F(D)} ÷ ${F(d)} = ${approx(q)}`;
  return `Drop zeros: ${withCommas(mD, 3)} ÷ ${withCommas(md, 3)} = ${approx(core)}${zerosPhrase(zD - zd)} → ${approx(q)}`;
}

// "÷350 = ÷1,000 × 2.86 → 4.2M ÷ 1,000 = 4.2K, × 2.86 ≈ 12K"
function explainReciprocal(D, d, q) {
  const P = 10 ** Math.ceil(Math.log10(d));
  if (P === d) return `÷ ${F(d)} just moves the decimal → ${approx(q)}`;
  const k = roundSig(P / d, 3);
  return `÷ ${F(d)} ≈ ÷ ${F(P)} × ${k} → ${C(D)} ÷ ${F(P)} = ${approx(clean(D / P))}, × ${k} ≈ ${fmtNum(roundSig(q, 3))}`;
}

// "Same units: 4,800M ÷ 120M = 4,800 ÷ 120 = 40×"
function explainSameUnits(X, Y, q, label) {
  const [, e] = splitUnit(Y);
  const xs = withCommas(clean(X / 10 ** e), 3);
  const ys = withCommas(clean(Y / 10 ** e), 3);
  const head = e ? `Same units: ${xs}${UNIT[e]} ÷ ${ys}${UNIT[e]} = ` : '';
  return `${head}${xs} ÷ ${ys} ${sigDigits(q) <= 3 ? '=' : '≈'} ${withCommas(roundSig(q, 3), 3)}${label}`;
}

// Shared phrasings
const mulPlain = (a, b) => [`${a} × ${b}`, `What is ${a} × ${b}?`, `Calculate ${a} × ${b}`, `${a} times ${b} = ?`];
const divPlain = (a, b) => [`${a} ÷ ${b}`, `What is ${a} ÷ ${b}?`, `Calculate ${a} ÷ ${b}`, `${a} divided by ${b} = ?`];

// Render every frame whose `when` accepts the values.
function renderFrames(r, frames, v) {
  return frames.filter((f) => !f.when || f.when(v)).map((f) => ({ id: f.id, text: f.text(r, v, cur(r)) }));
}

// ---------- context frames ----------
// Each frame has realistic ranges for its numbers (and its result), so a
// story only appears when the figures make sense, e.g. no "9.8B customers"
// or "trucks driving 5 km a year". Otherwise the plain wording is used.

const inR = (x, lo, hi) => x >= lo && x <= hi;
const isInt = Number.isInteger;

// count a × per-unit b (tried both ways round, since a × b = b × a)
const MULT_FRAMES = [
  { id: 'm.stores', when: (v) => inR(v.a, 20, 20000) && inR(v.b, 1000, 2e6),
    text: (r, v) => `A retailer has ${F(v.a)} ${r.pick(['stores', 'supermarkets', 'pharmacies', 'shops'])}, each selling ${F(v.b)} units a year. How many units are sold in total?` },
  { id: 'm.subs', when: (v) => inR(v.a, 1e4, 3e8) && inR(v.b, 5, 2000),
    text: (r, v, c) => `${F(v.a)} ${r.pick(['subscribers', 'members', 'customers'])} each pay ${c}${F(v.b)} a year. What is annual revenue?` },
  { id: 'm.households', when: (v) => inR(v.a, 1e5, 5e8) && inR(v.b, 100, 20000),
    text: (r, v, c) => `A country has ${F(v.a)} households, each spending ${c}${F(v.b)} a year on ${r.pick(['energy', 'groceries', 'insurance', 'broadband'])}. How big is the market?` },
  { id: 'm.units', when: (v) => inR(v.a, 100, 1e8) && inR(v.b, 2, 50000) && v.a * v.b <= 5e11,
    text: (r, v, c) => `A manufacturer sells ${F(v.a)} ${r.pick(['units', 'devices', 'machines', 'kits'])} at ${c}${F(v.b)} each. What is the revenue?` },
  { id: 'm.flights', when: (v) => inR(v.a, 1000, 5e6) && inR(v.b, 50, 400),
    text: (r, v) => `An airline operates ${F(v.a)} flights a year with ${F(v.b)} passengers each on average. How many passengers in total?` },
  { id: 'm.reps', when: (v) => inR(v.a, 10, 20000) && inR(v.b, 5, 2000),
    text: (r, v) => `${F(v.a)} sales reps each close ${F(v.b)} deals a year. How many deals in total?` },
  { id: 'm.aisles', when: (v) => inR(v.a, 10, 500) && inR(v.b, 20, 2000),
    text: (r, v) => `A warehouse has ${F(v.a)} aisles with ${F(v.b)} pallet slots each. How many slots are there?` },
  { id: 'm.clinics', when: (v) => inR(v.a, 10, 5000) && inR(v.b, 100, 10000),
    text: (r, v) => `A clinic chain has ${F(v.a)} clinics, each seeing ${F(v.b)} patients a month. Patients per month?` },
  { id: 'm.lines', when: (v) => inR(v.a, 2, 200) && inR(v.b, 100, 1e5),
    text: (r, v) => `A plant runs ${F(v.a)} production lines, each making ${F(v.b)} units a week. What is weekly output?` },
  { id: 'm.hotels', when: (v) => inR(v.a, 10, 10000) && inR(v.b, 20, 1000),
    text: (r, v) => `A hotel group owns ${F(v.a)} hotels with ${F(v.b)} rooms each on average. How many rooms in total?` },
  { id: 'm.trucks', when: (v) => inR(v.a, 10, 1e5) && inR(v.b, 1e4, 2e5),
    text: (r, v) => `A logistics firm runs ${F(v.a)} trucks, each driving ${F(v.b)} km a year. Total km driven?` },
  { id: 'm.app', when: (v) => inR(v.a, 1e4, 1e9) && inR(v.b, 2, 200),
    text: (r, v) => `An app has ${F(v.a)} daily users who each see ${F(v.b)} ads a day. How many ad views per day?` },
  { id: 'm.billing', when: (v) => inR(v.a, 100, 1e5) && inR(v.b, 50, 2000),
    text: (r, v, c) => `A consultancy bills ${F(v.a)} hours a month at ${c}${F(v.b)} an hour. What are monthly billings?` },
  { id: 'm.cafes', when: (v) => inR(v.a, 10, 30000) && inR(v.b, 100, 2000),
    text: (r, v) => `A coffee chain has ${F(v.a)} cafés serving ${F(v.b)} cups a day each. Cups per day?` },
  { id: 'm.bank', when: (v) => inR(v.a, 10, 10000) && inR(v.b, 500, 50000),
    text: (r, v) => `A bank has ${F(v.a)} branches with ${F(v.b)} accounts each. How many accounts in total?` },
  { id: 'm.cars', when: (v) => inR(v.a, 1000, 5e6) && inR(v.b, 5000, 150000),
    text: (r, v, c) => `A dealer group sells ${F(v.a)} cars a year at an average of ${c}${F(v.b)}. What is annual revenue?` },
  // small numbers
  { id: 'm.days', when: (v) => inR(v.a, 10, 999) && inR(v.b, 5, 7),
    text: (r, v) => `A shop sells ${F(v.a)} items a day and opens ${v.b} days a week. How many items a week?` },
  { id: 'm.crates', when: (v) => inR(v.a, 10, 999) && inR(v.b, 4, 24),
    text: (r, v) => `A truck carries ${F(v.a)} crates with ${v.b} bottles each. How many bottles is that?` },
  { id: 'm.screens', when: (v) => inR(v.a, 4, 40) && inR(v.b, 50, 400),
    text: (r, v) => `A cinema chain has ${v.a} screens with ${v.b} seats each. How many seats in total?` },
  { id: 'm.team', when: (v) => inR(v.a, 3, 15) && inR(v.b, 30, 80),
    text: (r, v) => `A project team of ${v.a} consultants each works ${v.b} hours a week. How many hours in total?` },
  { id: 'm.coffee', when: (v) => inR(v.a, 50, 2000) && inR(v.b, 2, 9),
    text: (r, v, c) => `A café sells ${F(v.a)} coffees a day at ${c}${v.b} each. What is daily revenue?` },
  { id: 'm.train', when: (v) => inR(v.a, 4, 16) && inR(v.b, 40, 99),
    text: (r, v) => `A train has ${v.a} carriages with ${v.b} seats each. How many seats?` },
];

function multFrames(r, a, b) {
  const both = [...renderFrames(r, MULT_FRAMES, { a, b }), ...renderFrames(r, MULT_FRAMES, { a: b, b: a })];
  return both.filter((f, i) => both.findIndex((g) => g.id === f.id) === i);
}

// p% of base B
const PCT_OF_FRAMES = [
  { id: 'p.share', when: (v) => inR(v.B, 1e6, 1e12) && inR(v.p, 1, 60),
    text: (r, v, c) => `A market is worth ${c}${C(v.B)}. A player with ${fmtPct(v.p)} market share has what revenue?` },
  { id: 'p.churn', when: (v) => inR(v.B, 1e4, 5e8) && inR(v.p, 2, 40),
    text: (r, v) => `A ${r.pick(['telecom', 'bank', 'streaming service', 'gym chain'])} has ${F(v.B)} customers and ${fmtPct(v.p)} leave each year. How many customers leave?` },
  { id: 'p.margin', when: (v) => inR(v.B, 1e6, 5e11) && inR(v.p, 3, 45),
    text: (r, v, c) => `A company has revenue of ${c}${C(v.B)} and a ${fmtPct(v.p)} operating margin. What is operating profit?` },
  { id: 'p.own', when: (v) => inR(v.B, 1e5, 5e8) && inR(v.p, 5, 95),
    text: (r, v) => `${fmtPct(v.p)} of ${F(v.B)} households own a ${r.pick(['dog', 'car', 'smart speaker', 'heat pump', 'bike'])}. How many households is that?` },
  { id: 'p.budget', when: (v) => inR(v.B, 1e5, 5e10) && inR(v.p, 2, 50),
    text: (r, v, c) => `Of a ${c}${C(v.B)} budget, ${fmtPct(v.p)} goes to ${r.pick(['marketing', 'IT', 'R&D', 'training'])}. How much is that?` },
  { id: 'p.conv', when: (v) => inR(v.B, 1e4, 1e9) && inR(v.p, 0.5, 15),
    text: (r, v) => `A website gets ${F(v.B)} visitors a month and ${fmtPct(v.p)} of them buy. How many orders is that?` },
  { id: 'p.tax', when: (v) => inR(v.B, 1e5, 1e11) && inR(v.p, 10, 40),
    text: (r, v, c) => `A firm earns ${c}${C(v.B)} pre-tax profit and pays ${fmtPct(v.p)} tax. What is the tax bill?` },
  { id: 'p.defect', when: (v) => inR(v.B, 1e4, 1e9) && inR(v.p, 0.5, 12),
    text: (r, v) => `A factory makes ${F(v.B)} parts with a ${fmtPct(v.p)} defect rate. How many parts are defective?` },
  { id: 'p.uplift', when: (v) => inR(v.B, 1e5, 1e12) && inR(v.p, 1, 30),
    text: (r, v, c) => `Revenue of ${c}${C(v.B)} grows ${fmtPct(v.p)} next year. How much extra revenue is that?` },
  { id: 'p.discount', when: (v) => inR(v.B, 1e4, 1e9) && inR(v.p, 2, 50),
    text: (r, v, c) => `A ${c}${C(v.B)} contract gets a ${fmtPct(v.p)} discount. How much is the discount worth?` },
];

// part P of whole W
const WHAT_PCT_FRAMES = [
  { id: 'w.online', when: (v) => isInt(v.P) && inR(v.W, 1e4, 1e9),
    text: (r, v) => `A retailer sold ${F(v.P)} of its ${F(v.W)} units online. What percentage is that?` },
  { id: 'w.survey', when: (v) => isInt(v.P) && inR(v.W, 200, 1e5),
    text: (r, v) => `${F(v.P)} of ${F(v.W)} survey respondents prefer the new product. What percentage is that?` },
  { id: 'w.mkt', when: (v) => inR(v.W, 1e6, 1e12) && inR(v.P / v.W, 0.01, 0.4),
    text: (r, v, c) => `Marketing spend is ${c}${C(v.P)} on revenue of ${c}${C(v.W)}. What % of revenue is marketing?` },
  { id: 'w.segment', when: (v) => inR(v.W, 1e6, 1e12),
    text: (r, v, c) => `One segment brings in ${c}${C(v.P)} of ${c}${C(v.W)} total revenue. What is its share?` },
  { id: 'w.remote', when: (v) => isInt(v.P) && inR(v.W, 50, 5e5),
    text: (r, v) => `${F(v.P)} of a company's ${F(v.W)} employees work remotely. What percentage is that?` },
  { id: 'w.share', when: (v) => inR(v.W, 1e6, 1e12) && inR(v.P / v.W, 0.005, 0.7),
    text: (r, v, c) => `A firm has sales of ${c}${C(v.P)} in a ${c}${C(v.W)} market. What is its market share?` },
];

// change from X to Y
const CHANGE_FRAMES = [
  { id: 'c.rev', when: (v) => v.X >= 1e5,
    text: (r, v, c) => `Revenue went from ${c}${C(v.X)} to ${c}${C(v.Y)}. What is the percentage change?` },
  { id: 'c.users', when: (v) => isInt(v.X) && isInt(v.Y) && inR(v.X, 1e4, 3e9),
    text: (r, v) => `Monthly active users moved from ${F(v.X)} to ${F(v.Y)}. What is the % change?` },
  { id: 'c.cost', when: (v) => inR(v.X, 1, 1e4),
    text: (r, v, c) => `Unit costs changed from ${c}${C(v.X)} to ${c}${C(v.Y)}. What is the % change?` },
  { id: 'c.head', when: (v) => isInt(v.X) && isInt(v.Y) && inR(v.X, 50, 5e5),
    text: (r, v) => `Headcount went from ${F(v.X)} to ${F(v.Y)}. By what % did it change?` },
  { id: 'c.vol', when: (v) => isInt(v.X) && isInt(v.Y) && v.X >= 1e3,
    text: (r, v) => `Shipments went from ${F(v.X)} to ${F(v.Y)} units year on year. What is the % change?` },
  { id: 'c.price', when: (v) => inR(v.X, 1, 5e3),
    text: (r, v, c) => `The average ${r.pick(['price', 'basket size', 'ticket price'])} moved from ${c}${C(v.X)} to ${c}${C(v.Y)}. What is the % change?` },
  { id: 'c.deal', when: (v) => inR(v.X, 1e4, 1e8),
    text: (r, v, c) => `The average contract value moved from ${c}${C(v.X)} to ${c}${C(v.Y)}. What is the % change?` },
];

// value V after a change of c%; find the original
const REVERSE_FRAMES = [
  { id: 'r.price', when: (v) => v.c > 0 && v.V >= 1e5,
    text: (r, v, c) => `After a ${fmtPct(v.c)} price rise, revenue is ${c}${C(v.V)}. What was revenue before?` },
  { id: 'r.vat', when: (v) => inR(v.c, 5, 25) && inR(v.V, 1, 1e6),
    text: (r, v, c) => `A price of ${c}${C(v.V)} includes ${fmtPct(v.c)} VAT. What is the price before VAT?` },
  { id: 'r.users', when: (v) => v.c > 0 && isInt(v.V) && v.V >= 1e4,
    text: (r, v) => `Users grew ${fmtPct(v.c)} to ${F(v.V)}. How many users were there before?` },
  { id: 'r.drop', when: (v) => v.c < 0 && v.V >= 1e5,
    text: (r, v, c) => `Sales fell ${fmtPct(-v.c)} to ${c}${C(v.V)}. What were sales before the drop?` },
  { id: 'r.cut', when: (v) => v.c < 0 && v.c >= -40 && isInt(v.V) && inR(v.V, 50, 5e5),
    text: (r, v) => `After cutting ${fmtPct(-v.c)} of its staff, a firm has ${F(v.V)} employees. How many did it have before?` },
  { id: 'r.disc', when: (v) => v.c < 0 && v.c >= -50 && inR(v.V, 1e3, 1e8),
    text: (r, v, c) => `With a ${fmtPct(-v.c)} discount, a contract costs ${c}${C(v.V)}. What was the list price?` },
];

// V growing (or shrinking) r% a year for n years
const COMPOUND_FRAMES = [
  { id: 'g.market', when: (v) => v.s > 0 && v.V >= 1e6,
    text: (r, v, c) => `A ${c}${C(v.V)} market grows ${fmtPct(v.r)} a year. How big is it after ${v.n} years?` },
  { id: 'g.rev', when: (v) => v.s > 0 && v.V >= 1e5,
    text: (r, v, c) => `A company with ${c}${C(v.V)} revenue expects ${fmtPct(v.r)} annual growth. What is revenue in ${v.n} years?` },
  { id: 'g.pop', when: (v) => v.s > 0 && inR(v.V, 1e5, 4e7) && v.r <= 5,
    text: (r, v) => `A city of ${F(v.V)} people grows ${fmtPct(v.r)} a year. What is the population after ${v.n} years?` },
  { id: 'g.users', when: (v) => v.s > 0 && inR(v.V, 1e4, 1e9),
    text: (r, v) => `A platform with ${F(v.V)} users grows ${fmtPct(v.r)} a year. How many users after ${v.n} years?` },
  { id: 'd.churn', when: (v) => v.s < 0 && inR(v.V, 1e3, 5e8) && v.r <= 30,
    text: (r, v) => `A customer base of ${F(v.V)} shrinks ${fmtPct(v.r)} a year. How many customers after ${v.n} years?` },
  { id: 'd.cost', when: (v) => v.s < 0 && v.V >= 1e5 && v.r <= 20,
    text: (r, v, c) => `Costs of ${c}${C(v.V)} are cut ${fmtPct(v.r)} a year. What are they after ${v.n} years?` },
  { id: 'd.vol', when: (v) => v.s < 0 && inR(v.V, 1e4, 1e10) && v.r <= 25,
    text: (r, v) => `${r.pick(['Print', 'Landline', 'Cheque', 'DVD'])} volumes of ${F(v.V)} decline ${fmtPct(v.r)} a year. What is the volume after ${v.n} years?` },
];

const CAGR_FRAMES = [
  { id: 'a.rev', when: (v) => v.S >= 1e5,
    text: (r, v, c) => `Revenue grew from ${c}${C(v.S)} to ${c}${C(v.E)} over ${v.n} years. What is the CAGR?` },
  { id: 'a.mkt', when: (v) => v.S >= 1e6,
    text: (r, v, c) => `A market expanded from ${c}${C(v.S)} to ${c}${C(v.E)} in ${v.n} years. What is the annual growth rate?` },
  { id: 'a.users', when: (v) => inR(v.S, 1e3, 1e9) && v.E <= 3e9,
    text: (r, v) => `Users rose from ${F(v.S)} to ${F(v.E)} over ${v.n} years. What is the compound annual growth rate?` },
  { id: 'a.ebitda', when: (v) => v.S >= 1e5,
    text: (r, v, c) => `EBITDA went from ${c}${C(v.S)} to ${c}${C(v.E)} in ${v.n} years. What is the CAGR?` },
];

// total D shared over d (result q)
const DIV_FRAMES = [
  { id: 'd.store', when: (v) => inR(v.D, 1e7, 1e11) && inR(v.d, 50, 5e4) && inR(v.q, 1e5, 2e7),
    text: (r, v, c) => `A ${c}${C(v.D)} market is served by ${F(v.d)} ${r.pick(['stores', 'outlets', 'branches'])}. What is the average revenue per ${r.pick(['location', 'site'])}?` },
  { id: 'd.emp', when: (v) => inR(v.D, 1e6, 5e10) && inR(v.d, 10, 5e5) && inR(v.q, 2e4, 2e5),
    text: (r, v, c) => `A ${c}${C(v.D)} payroll covers ${F(v.d)} employees. What is the average cost per employee?` },
  { id: 'd.unit', when: (v) => inR(v.D, 1e4, 1e10) && inR(v.d, 100, 1e8) && inR(v.q, 0.5, 1e4),
    text: (r, v, c) => `Total costs of ${c}${C(v.D)} are spread over ${F(v.d)} units. What is the cost per unit?` },
  { id: 'd.hosp', when: (v) => isInt(v.D) && inR(v.D, 1e5, 1.5e9) && inR(v.d, 10, 1e5) && inR(v.q, 500, 1e6),
    text: (r, v) => `A country of ${F(v.D)} people has ${F(v.d)} ${r.pick(['hospitals', 'pharmacies', 'schools'])}. How many people per ${r.pick(['site', 'location'])}?` },
  { id: 'd.cust', when: (v) => inR(v.D, 1e5, 1e11) && inR(v.d, 100, 1e8) && inR(v.q, 10, 1e6),
    text: (r, v, c) => `${c}${C(v.D)} of revenue comes from ${F(v.d)} customers. What is revenue per customer?` },
  { id: 'd.sqm', when: (v) => inR(v.D, 1e5, 1e9) && inR(v.d, 100, 1e7) && inR(v.q, 50, 2000),
    text: (r, v, c) => `A ${c}${C(v.D)} annual rent bill covers ${F(v.d)} m² of space. What is rent per m²?` },
  { id: 'd.parcels', when: (v) => isInt(v.D) && inR(v.D, 1e4, 1e9) && inR(v.d, 10, 1e5) && inR(v.q, 1000, 1e5),
    text: (r, v) => `${F(v.D)} parcels a year are split evenly across ${F(v.d)} delivery vans. How many parcels per van?` },
  { id: 'd.capita', when: (v) => inR(v.D, 1e6, 1e12) && inR(v.d, 1e5, 1.5e9) && inR(v.q, 5, 1e4),
    text: (r, v, c) => `A country spends ${c}${C(v.D)} a year on ${r.pick(['coffee', 'pet food', 'streaming', 'gym memberships'])} and has ${F(v.d)} people. What is spend per person?` },
  { id: 'd.order', when: (v) => inR(v.D, 1e4, 1e8) && inR(v.d, 10, 1e6) && inR(v.q, 50, 5000),
    text: (r, v, c) => `A ${c}${C(v.D)} order covers ${F(v.d)} ${r.pick(['laptops', 'phones', 'office chairs', 'bikes'])}. What is the price per item?` },
];

// X is how many times Y
const RATIO_FRAMES = [
  { id: 'x.firms', when: (v) => v.Y >= 1e5,
    text: (r, v, c) => `Company A has revenue of ${c}${C(v.X)}; company B has ${c}${C(v.Y)}. How many times bigger is A?` },
  { id: 'x.market', when: (v) => v.X >= 1e6 && v.Y >= 1e4,
    text: (r, v, c) => `The market is worth ${c}${C(v.X)} and your client sells ${c}${C(v.Y)}. The market is how many times your client's sales?` },
  { id: 'x.pop', when: (v) => isInt(v.X) && isInt(v.Y) && inR(v.X, 1e5, 1.5e9) && v.Y >= 1e3,
    text: (r, v) => `Country A has ${F(v.X)} people and region B has ${F(v.Y)}. How many times larger is A?` },
  { id: 'x.budget', when: (v) => v.Y >= 1e4 && v.X <= 1e11,
    text: (r, v, c) => `A ${c}${C(v.X)} group budget versus a ${c}${C(v.Y)} team budget: how many times larger is the group budget?` },
];

// ---------- explanations ----------

// Split-and-add (or round-and-subtract) for products like 347 × 46.
function explainSplit(a, b) {
  if (b < 10) {
    const parts = [];
    let rest = a;
    const len = String(a).length;
    // split off the leading one or two place values, keep the last two digits together
    for (let p = len - 1; p >= 2; p--) {
      const chunk = Math.floor(rest / 10 ** p) * 10 ** p;
      if (chunk) parts.push(chunk);
      rest -= chunk;
    }
    if (rest) parts.push(rest);
    if (parts.length === 1) parts.splice(0, 1, a - (a % 10), a % 10);
    const products = parts.map((x) => x * b);
    return `${F(a)} × ${b} = ${parts.map((x) => `${F(x)}×${b}`).join(' + ')} = ${products.map(F).join(' + ')} = ${F(a * b)}`;
  }
  const ones = b % 10;
  if (ones >= 7) {
    const up = b + (10 - ones);
    return `${F(a)} × ${b} = ${F(a)}×${up} − ${F(a)}×${up - b} = ${F(a * up)} − ${F(a * (up - b))} = ${F(a * b)}`;
  }
  const tens = b - ones;
  return `${F(a)} × ${b} = ${F(a)}×${tens} + ${F(a)}×${ones} = ${F(a * tens)} + ${F(a * ones)} = ${F(a * b)}`;
}

const FRACTIONS = {
  5: ['1/20', 20, 1], 10: ['1/10', 10, 1], 12.5: ['⅛', 8, 1], 20: ['⅕', 5, 1], 25: ['¼', 4, 1],
  37.5: ['⅜', 8, 3], 40: ['⅖', 5, 2], 50: ['½', 2, 1], 60: ['⅗', 5, 3], 62.5: ['⅝', 8, 5],
  75: ['¾', 4, 3], 80: ['⅘', 5, 4], 87.5: ['⅞', 8, 7],
};

function explainPctOf(p, B, ans) {
  const f = FRACTIONS[p];
  if (f) {
    const [label, den, num] = f;
    return `${fmtPct(p)} = ${label} → ${C(B)} ÷ ${den}${num > 1 ? ` × ${num}` : ''} = ${approx(ans)}`;
  }
  const tens = Math.floor(p / 10);
  const ones = clean(p - tens * 10);
  const ten = clean(B / 10);
  const one = clean(B / 100);
  if (tens === 0) return `1% = ${C(one)} → ${fmtPct(p)} = ${withCommas(p, 2)} × ${C(one)} = ${approx(ans)}`;
  const tenPart = tens === 1 ? C(ten) : `${tens}×${C(ten)}`;
  const onePart = ones === 0 ? '' : ` + ${withCommas(ones, 2)}×${C(one)}`;
  return `10% = ${C(ten)}, 1% = ${C(one)} → ${fmtPct(p)} = ${tenPart}${onePart} = ${approx(ans)}`;
}

function explainShare(part, whole, ans, label = '') {
  const f = FRACTIONS[Math.abs(roundSig(ans, 6))];
  if (f && Math.abs(ans - roundSig(ans, 6)) < 1e-9) {
    return `${label}${C(part)} ÷ ${C(whole)} = ${ans < 0 ? '−' : ''}${f[0]} = ${fmtPct(ans)}`;
  }
  return `${label}1% of ${C(whole)} = ${C(clean(whole / 100))} → ${C(part)} ÷ ${C(clean(whole / 100))} ${approxPct(ans).startsWith('≈') ? '' : '= '}${approxPct(ans)}`;
}

// ---------- templates ----------

export const TEMPLATES = [
  // ===== Multiplication =====
  {
    id: 'mult.digits',
    mode: 'mult',
    name: '2-digit × 2-digit',
    gen(r, L) {
      let a, b;
      if (L === 1) [a, b] = [intNoZero(r, 12, 99), r.int(3, 9)];
      else if (L === 2) [a, b] = [intNoZero(r, 13, 99), intNoZero(r, 13, 99)];
      else [a, b] = [intNoZero(r, 101, 999), intNoZero(r, 13, 99)];
      if (a < b) [a, b] = [b, a];
      return {
        key: `${a}x${b}`, params: { a, b }, shown: [a, b],
        answer: a * b, kind: 'number', exact: true,
        explain: explainSplit(a, b),
        plain: mulPlain(F(a), F(b)),
        frames: multFrames(r, a, b),
      };
    },
  },
  {
    id: 'mult.3x1',
    mode: 'mult',
    name: '3-digit × 1-digit',
    gen(r, L) {
      const a = L === 3 ? intNoZero(r, 1001, 9999) : intNoZero(r, 101, 999);
      const b = L === 1 ? r.int(2, 5) : L === 2 ? r.int(6, 9) : r.int(3, 9);
      return {
        key: `${a}x${b}`, params: { a, b }, shown: [a, b],
        answer: a * b, kind: 'number', exact: true,
        explain: explainSplit(a, b),
        plain: mulPlain(F(a), F(b)),
        frames: multFrames(r, a, b),
      };
    },
  },
  {
    id: 'mult.zeros',
    mode: 'mult',
    name: 'Trailing zeros (4,500 × 30)',
    gen(r, L) {
      let ma, za, mb, zb;
      if (L === 1) {
        ma = r.chance(0.5) ? r.int(2, 9) : intNoZero(r, 11, 99);
        [za, mb, zb] = [r.int(1, 3), r.int(2, 9), r.int(1, 2)];
      } else if (L === 2) {
        [ma, za, mb, zb] = [intNoZero(r, 11, 99), r.int(2, 4), intNoZero(r, 11, 99), r.int(1, 2)];
      } else {
        [ma, za, mb, zb] = [intNoZero(r, 101, 999), r.int(2, 4), intNoZero(r, 11, 99), r.int(1, 3)];
      }
      let a = ma * 10 ** za;
      let b = mb * 10 ** zb;
      if (a < b) [a, b] = [b, a];
      const ans = a * b;
      return {
        key: `${a}x${b}`, params: { a, b }, shown: [a, b],
        answer: ans, kind: 'number', exact: L < 3, sig: 3,
        explain: `${F(ma)} × ${F(mb)} = ${F(ma * mb)}, then add ${za + zb} zeros → ${F(ans)}`,
        plain: mulPlain(F(a), F(b)),
        frames: multFrames(r, a, b),
      };
    },
  },
  {
    id: 'mult.units',
    mode: 'mult',
    name: 'Mixed units (2.5M × 4,000)',
    gen(r, L) {
      const ua = r.chance(L === 1 ? 0.2 : 0.3) ? 9 : 6;
      let ma, mb, eb;
      if (L === 1) {
        ma = r.pick([1.2, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 7.5, 8, 9, ...(ua === 6 ? [12, 15, 25, 40] : [])]);
        [mb, eb] = [r.pick([2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 25]), r.int(2, ua === 9 ? 3 : 4)];
      } else if (L === 2) {
        ma = intNoZero(r, 11, 99) / 10;
        [mb, eb] = r.chance(0.5) ? [intNoZero(r, 11, 99), r.int(1, ua === 9 ? 2 : 3)] : [r.int(2, 9), r.int(3, ua === 9 ? 3 : 4)];
      } else {
        ma = intNoZero(r, 101, 999) / 100;
        [mb, eb] = [intNoZero(r, 11, 99), r.int(2, ua === 9 ? 2 : 4)];
      }
      const a = clean(ma * 10 ** ua);
      const b = clean(mb * 10 ** eb);
      const ans = clean(a * b);
      const [va, ea] = splitUnit(a);
      const [vb, ebu] = splitUnit(b);
      const prod = clean(va * vb);
      const unitStep = ebu ? `${UNIT[ea]} × ${UNIT[ebu]} = ${UNIT[ea + ebu] ?? '10^' + (ea + ebu)}` : `still ${UNIT[ea]}`;
      return {
        key: `${a}x${b}`, params: { a, b }, shown: [a, b],
        answer: ans, kind: 'number', exact: L < 3, sig: 3,
        explain: `${withCommas(va, 3)} × ${withCommas(vb, 3)} = ${withCommas(prod, 3)}; ${unitStep} → ${approx(ans)}`,
        plain: mulPlain(C(a), F(b)),
        frames: multFrames(r, a, b),
      };
    },
  },
  {
    id: 'mult.near',
    mode: 'mult',
    name: 'Near-round tricks (98 × 37)',
    gen(r, L) {
      if (L < 3) {
        const a = intNoZero(r, L === 1 ? 12 : 13, 999);
        const m = L === 1 ? r.pick([9, 11, 99, 101]) : r.pick([19, 21, 29, 31, 39, 41, 49, 51, 98, 102, 199, 201]);
        const base = [10, 20, 30, 40, 50, 100, 200].reduce((p, x) => (Math.abs(x - m) < Math.abs(p - m) ? x : p));
        const k = m - base;
        const sign = k > 0 ? '+' : '−';
        return {
          key: `${a}x${m}`, params: { a, b: m }, shown: [a, m],
          answer: a * m, kind: 'number', exact: true,
          explain: `${F(a)} × ${m} = ${F(a)}×${base} ${sign} ${F(a)}×${Math.abs(k)} = ${F(a * base)} ${sign} ${F(a * Math.abs(k))} = ${F(a * m)}`,
          plain: mulPlain(F(a), F(m)),
          frames: multFrames(r, a, m),
        };
      }
      if (r.chance(0.5)) {
        // difference of squares: (c − d)(c + d) = c² − d²
        const c = r.pick([
          ...Array.from({ length: 98 }, (_, i) => 20 + i * 10),
          ...Array.from({ length: 8 }, (_, i) => 25 + i * 10),
          ...Array.from({ length: 14 }, (_, i) => 250 + i * 50),
        ]);
        const d = r.int(1, Math.min(c >= 100 ? 12 : 9, c - 11));
        const a = c + d;
        const b = c - d;
        return {
          key: `${a}x${b}`, params: { a, b }, shown: [a, b],
          answer: a * b, kind: 'number', exact: true,
          explain: `Both are ${d} away from ${c}: ${c}² − ${d}² = ${F(c * c)} − ${d * d} = ${F(a * b)}`,
          plain: mulPlain(F(b), F(a)),
          frames: multFrames(r, a, b),
        };
      }
      // both near the same base: (B + x)(B + y) = B × (B + x + y) + x·y
      const B = r.pick([50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000]);
      const x = r.pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const y = r.pick([-9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      let a = B + x;
      let b = B + y;
      if (a < b) [a, b] = [b, a];
      const xy = (a - B) * (b - B);
      return {
        key: `${a}x${b}`, params: { a, b }, shown: [a, b],
        answer: a * b, kind: 'number', exact: true,
        explain: `Near ${B}: ${B} × (${F(a)} ${b - B < 0 ? '−' : '+'} ${Math.abs(b - B)}) ${xy < 0 ? '−' : '+'} ${Math.abs(xy)} = ${F(B * (a + b - B))} ${xy < 0 ? '−' : '+'} ${Math.abs(xy)} = ${F(a * b)}`,
        plain: mulPlain(F(a), F(b)),
        frames: multFrames(r, a, b),
      };
    },
  },

  // ===== Percentages =====
  {
    id: 'pct.of',
    mode: 'pct',
    name: 'X% of a number',
    gen(r, L) {
      let p, B;
      if (L === 1) {
        p = r.pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 90]);
        B = biz(r, r.int(1, 2), 3, 9);
      } else if (L === 2) {
        p = r.chance(0.6) ? r.int(1, 19) * 5 : r.int(2, 19);
        B = biz(r, 2, 3, 9);
      } else {
        p = r.chance(0.5)
          ? r.pick([2.5, 3.5, 4.5, 6.5, 7.5, 8.5, 12.5, 17.5, 22.5, 27.5, 32.5, 37.5, 42.5, 62.5, 87.5])
          : intNoZero(r, 3, 97);
        B = biz(r, r.int(2, 3), 4, 10);
      }
      const ans = clean((B * p) / 100);
      return {
        key: `${p}%${B}`, params: { p, B }, shown: [p, B],
        answer: ans, kind: 'number', exact: false, sig: 3,
        explain: explainPctOf(p, B, ans),
        plain: [`${fmtPct(p)} of ${C(B)}`, `What is ${fmtPct(p)} of ${C(B)}?`, `Find ${fmtPct(p)} of ${C(B)}`, `${C(B)} × ${fmtPct(p)} = ?`],
        frames: renderFrames(r, PCT_OF_FRAMES, { p, B }),
      };
    },
  },
  {
    id: 'pct.whatpct',
    mode: 'pct',
    name: 'What % is X of Y?',
    gen(r, L) {
      let P, W;
      if (L < 3) {
        [P, W] = until(
          () => {
            const pct = L === 1 ? r.pick([2, 4, 5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60, 75, 80]) : r.int(3, 95);
            const w = biz(r, L === 1 ? r.int(1, 2) : 2, 2, 9);
            return [clean((w * pct) / 100), w];
          },
          ([p]) => sigDigits(p) <= 3 && p >= 1
        );
      } else {
        W = biz(r, r.int(2, 3), 3, 9);
        P = roundSig(W * (0.03 + r.next() * 0.9), 2);
      }
      const ans = clean((P / W) * 100);
      return {
        key: `${P}/${W}`, params: { P, W }, shown: [P, W],
        answer: ans, kind: 'percent', exact: false, sig: 3,
        explain: explainShare(P, W, ans),
        plain: [`What % is ${C(P)} of ${C(W)}?`, `${C(P)} is what percent of ${C(W)}?`, `${C(P)} ÷ ${C(W)} as a %`, `Express ${C(P)} as a share of ${C(W)}`],
        frames: renderFrames(r, WHAT_PCT_FRAMES, { P, W }),
      };
    },
  },
  {
    id: 'pct.change',
    mode: 'pct',
    name: '% change between two numbers',
    gen(r, L) {
      let X, Y;
      if (L < 3) {
        [X, Y] = until(
          () => {
            const c = L === 1
              ? r.pick([5, 10, 20, 25, 40, 50, 100, -5, -10, -20, -25, -40, -50])
              : (r.chance(0.65) ? 1 : -1) * (r.chance(0.6) ? 5 * r.int(1, 12) : r.int(2, 15));
            const x = biz(r, L === 1 ? r.int(1, 2) : 2, 2, 9);
            return [x, clean(x * (1 + c / 100))];
          },
          ([x, y]) => sigDigits(y) <= 3 && sigDigits(x) <= 3
        );
      } else {
        [X, Y] = until(
          () => {
            const x = biz(r, r.int(2, 3), 3, 9);
            return [x, roundSig(x * (0.55 + r.next() * 1.25), r.int(2, 3))];
          },
          ([x, y]) => Math.abs(y / x - 1) >= 0.02
        );
      }
      const ans = clean(((Y - X) / X) * 100);
      return {
        key: `${X}>${Y}`, params: { X, Y }, shown: [X, Y],
        answer: ans, kind: 'percent', exact: false, sig: 3, signed: true,
        explain: explainShare(clean(Y - X), X, ans, '(new − old) ÷ old: '),
        plain: [`% change from ${C(X)} to ${C(Y)}?`, `${C(X)} → ${C(Y)}: what is the % change?`, `What is the percentage change from ${C(X)} to ${C(Y)}?`, `From ${C(X)} to ${C(Y)} is a change of what %?`],
        frames: renderFrames(r, CHANGE_FRAMES, { X, Y }),
      };
    },
  },
  {
    id: 'pct.reverse',
    mode: 'pct',
    name: 'Reverse % (value before a change)',
    gen(r, L) {
      let c, V, O;
      if (L < 3) {
        [c, O, V] = until(
          () => {
            const cc = L === 1 ? r.pick([10, 20, 25, 50, -10, -20, -25, -50]) : (r.chance(0.6) ? 1 : -1) * 5 * r.int(1, 8);
            const o = biz(r, L === 1 ? r.int(1, 2) : 2, 2, 9);
            return [cc, o, clean(o * (1 + cc / 100))];
          },
          ([, , v]) => sigDigits(v) <= 3
        );
      } else {
        c = (r.chance(0.6) ? 1 : -1) * r.pick([2.5, 3.5, 4.5, 7.5, 12.5, 15, 17.5, 22.5, 27.5, 32.5, 35, 45, 13, 17, 23, 19]);
        V = biz(r, r.int(2, 3), 3, 9);
        O = clean(V / (1 + c / 100));
      }
      const f = clean(1 + c / 100);
      return {
        key: `${c}|${V}`, params: { c, V }, shown: [Math.abs(c), V],
        answer: O, kind: 'number', exact: false, sig: 3,
        explain: `Divide by ${f}: ${C(V)} ÷ ${f} ${approx(O).startsWith('≈') ? '' : '= '}${approx(O)}${c > 0 ? ` (not ${C(V)} × ${clean(1 - c / 100)})` : ''}`,
        plain: c > 0
          ? [`After a ${fmtPct(c)} increase a value is ${C(V)}. What was it before?`, `${C(V)} is ${fmtPct(c)} more than what number?`, `What number grown by ${fmtPct(c)} gives ${C(V)}?`]
          : [`After a ${fmtPct(-c)} decrease a value is ${C(V)}. What was it before?`, `${C(V)} is ${fmtPct(-c)} less than what number?`, `What number cut by ${fmtPct(-c)} gives ${C(V)}?`],
        frames: renderFrames(r, REVERSE_FRAMES, { c, V }),
      };
    },
  },

  // ===== Growth =====
  {
    id: 'growth.compound',
    mode: 'growth',
    name: 'Compound growth over years',
    gen(r, L) {
      let rate, n, s;
      if (L === 1) [rate, n, s] = [r.pick([5, 10, 20]), 2, 1];
      else if (L === 2) [rate, n, s] = [r.int(2, 12), r.int(2, 3), r.chance(0.25) ? -1 : 1];
      else [rate, n, s] = [r.int(2, 15) + (r.chance(0.2) ? 0.5 : 0), r.int(3, 5), r.chance(0.3) ? -1 : 1];
      const V = biz(r, L === 1 ? r.int(1, 2) : 2, 4, 9);
      const base = clean(1 + (s * rate) / 100);
      const f = base ** n;
      const ans = clean(V * f);
      const extra = Math.abs((f - 1 - (s * n * rate) / 100) * 100);
      const why = s > 0
        ? `simple ${n} × ${fmtPct(rate)} = ${fmtPct(n * rate)}, compounding adds ~${fixed(extra, 1)}%`
        : `simple ${fmtPct(n * rate)} off, compounding softens it by ~${fixed(extra, 1)}%`;
      const verb = s > 0 ? 'growing' : 'shrinking';
      return {
        key: `${V}|${s * rate}|${n}`, params: { V, rate, n, s }, shown: [V, rate],
        answer: ans, kind: 'number', exact: false, sig: 3,
        explain: `${base}${sup(n)} ≈ ${fixed(f)} (${why}) → ${C(V)} × ${fixed(f)} ≈ ${fmtNum(roundSig(ans, 3))}`,
        plain: [
          `${C(V)} ${verb} ${fmtPct(rate)} a year for ${n} years = ?`,
          `What is ${C(V)} after ${n} years of ${s > 0 ? '+' : '−'}${fmtPct(rate)} a year?`,
          `${s > 0 ? 'Grow' : 'Shrink'} ${C(V)} by ${fmtPct(rate)} a year for ${n} years`,
        ],
        frames: renderFrames(r, COMPOUND_FRAMES, { V, r: rate, n, s }),
      };
    },
  },
  {
    id: 'growth.cagr',
    mode: 'growth',
    name: 'CAGR between two values',
    gen(r, L) {
      const [S, E, n] = until(
        () => {
          let n, g, S, E;
          if (L === 1) {
            n = 2;
            g = r.pick([10, 20, 25, 50, 100]);
            S = biz(r, r.int(1, 2), 2, 8);
            E = clean(S * (1 + g / 100) ** 2);
          } else if (L === 2) {
            n = r.int(2, 5);
            g = r.int(3, 20);
            S = biz(r, 2, 3, 9);
            E = roundSig(S * (1 + g / 100) ** n, 2);
          } else {
            n = r.int(3, 10);
            g = r.int(2, 25) + (r.chance(0.3) ? 0.5 : 0);
            S = biz(r, r.int(2, 3), 3, 9);
            E = roundSig(S * (1 + g / 100) ** n, r.int(2, 3));
          }
          return [S, E, n];
        },
        ([S, E]) => sigDigits(E) <= (L === 1 ? 3 : 4) && E / S > 1.03
      );
      const ans = clean(((E / S) ** (1 / n) - 1) * 100);
      const guess = Math.max(1, Math.round(ans));
      const ratio = E / S;
      return {
        key: `${S}>${E}|${n}`, params: { S, E, n }, shown: [S, E],
        answer: ans, kind: 'percent', exact: false,
        sig: L === 1 ? 3 : 2,
        minTol: [0.01, 0.06, 0.06][L - 1],
        explain: `${C(E)} ÷ ${C(S)} ≈ ${fixed(ratio, 2)}×; test ${clean(1 + guess / 100)}${sup(n)} ≈ ${fixed((1 + guess / 100) ** n, 2)} → CAGR ≈ ${fmtPct(roundSig(ans, 2))}`,
        plain: [
          `CAGR from ${C(S)} to ${C(E)} over ${n} years?`,
          `${C(S)} → ${C(E)} in ${n} years. Annual growth rate?`,
          `What yearly growth takes ${C(S)} to ${C(E)} in ${n} years?`,
        ],
        frames: renderFrames(r, CAGR_FRAMES, { S, E, n }),
      };
    },
  },
  {
    id: 'growth.rule72',
    mode: 'growth',
    name: 'Rule of 72 (doubling time)',
    gen(r, L) {
      const V = biz(r, 2, 3, 9);
      let variant, x, M;
      if (L === 1) {
        variant = r.chance(0.6) ? 'time' : 'rate';
        x = variant === 'time' ? r.pick([2, 3, 4, 6, 8, 9, 12, 18, 24]) : r.pick([3, 4, 6, 8, 9, 12, 18, 24, 36]);
        M = 2;
      } else if (L === 2) {
        variant = r.pick(['time', 'rate', 'multi']);
        if (variant === 'time') [x, M] = [r.pick([1.5, 2.5, 4.5, 5, 7, 7.5, 10, 11, 14, 15, 16, 20]), 2];
        else if (variant === 'rate') [x, M] = [r.pick([5, 7, 10, 14, 15, 16, 20]), 2];
        else [x, M] = [r.pick([6, 8, 9, 12, 16, 18]), 4];
      } else {
        variant = r.chance(0.75) ? 'multi' : 'time';
        M = variant === 'multi' ? r.pick([3, 4, 8]) : 2;
        x = r.int(3, 20) + (r.chance(0.25) ? 0.5 : 0);
      }
      const ruleK = { 2: 72, 3: 110, 4: 144, 8: 216 }[M];
      const ans = clean(ruleK / x);
      const truth = variant === 'rate' ? (2 ** (1 / x) - 1) * 100 : Math.log(M) / Math.log(1 + x / 100);
      const minTol = Math.max(0.03, Math.abs(ans - truth) / ans + 0.02);
      const c = cur(r);
      const target = clean(V * M);
      const goal = { 2: 'double', 3: 'triple', 4: 'quadruple', 8: 'grow 8×' }[M];
      let plain, frames, explain, kind;
      if (variant === 'rate') {
        kind = 'percent';
        explain = `Rule of 72: 72 ÷ ${x} ≈ ${fixed(ans, 1)}% a year (exact ≈ ${fixed(truth, 1)}%)`;
        plain = [`What annual growth takes ${C(V)} to ${C(target)} in ${x} years? (rule of 72)`, `Roughly what growth rate doubles ${C(V)} in ${x} years?`];
        frames = [
          { id: 'q.rev', text: `A company wants to double revenue from ${c}${C(V)} to ${c}${C(target)} in ${x} years. Roughly what annual growth is needed?` },
          { id: 'q.users', when: V <= 2e8 && x <= 8, text: `A start-up with ${F(V)} users aims to reach ${F(target)} in ${x} years. About what yearly growth does that take?` },
        ];
      } else {
        kind = 'years';
        explain = M === 2
          ? `Rule of 72: 72 ÷ ${x} ≈ ${fixed(ans, 1)} years (exact ≈ ${fixed(truth, 1)})`
          : M === 3
            ? `Tripling: rule of ~110 → 110 ÷ ${x} ≈ ${fixed(ans, 1)} years (exact ≈ ${fixed(truth, 1)})`
            : `${M === 4 ? 'Two' : 'Three'} doublings: ${Math.log2(M)} × 72 ÷ ${x} ≈ ${fixed(ans, 1)} years (exact ≈ ${fixed(truth, 1)})`;
        plain = [
          `At ${fmtPct(x)} a year, about how many years for ${C(V)} to reach ${C(target)}?`,
          `Roughly how long does ${C(V)} take to ${goal} at ${fmtPct(x)} growth?`,
        ];
        frames = [
          { id: 'q.mkt', text: `A ${c}${C(V)} market grows ${fmtPct(x)} a year. Roughly how many years until it is worth ${c}${C(target)}?` },
          { id: 'q.inv', text: `An investment of ${c}${C(V)} earns ${fmtPct(x)} a year. About how long until it reaches ${c}${C(target)}?` },
          { id: 'q.base', when: V <= 2e8, text: `A customer base of ${F(V)} grows ${fmtPct(x)} a year. Roughly when does it ${goal} to ${F(target)}?` },
        ];
      }
      return {
        key: `${variant}|${M}|${x}|${V}`, params: { variant, M, x, V }, shown: [x, V],
        answer: ans, kind, exact: false, sig: 2, minTol,
        explain, plain, frames: frames.filter((f) => f.when !== false).map(({ id, text }) => ({ id, text })),
      };
    },
  },
  {
    id: 'growth.stacked',
    mode: 'growth',
    name: 'Stacked % changes',
    gen(r, L) {
      const count = L === 3 ? 3 : 2;
      const pickChange = () => {
        if (L === 1) return r.pick([5, 10, 20, 25, 50, -10, -20, -50]);
        if (L === 2) return (r.chance(0.65) ? 1 : -1) * (r.chance(0.6) ? 5 * r.int(1, 6) : r.int(2, 15));
        return (r.chance(0.65) ? 1 : -1) * 5 * r.int(1, 6);
      };
      // reject combinations that cancel out exactly (e.g. +25% then −20%)
      const cs = until(
        () => Array.from({ length: count }, pickChange),
        (list) => Math.abs(list.reduce((acc, c) => acc * (1 + c / 100), 1) - 1) > 0.001
      );
      const f = cs.reduce((acc, c) => acc * (1 + c / 100), 1);
      const net = clean((f - 1) * 100);
      const final = r.chance(0.5);
      const V = final ? biz(r, L === 1 ? r.int(1, 2) : 2, 4, 9) : null;
      const verb = (c) => (c >= 0 ? `rises ${fmtPct(c)}` : `falls ${fmtPct(-c)}`);
      const past = (c) => (c >= 0 ? `rose ${fmtPct(c)}` : `fell ${fmtPct(-c)}`);
      const factors = cs.map((c) => clean(1 + c / 100)).join(' × ');
      const curC = cur(r);
      if (final) {
        const ans = clean(V * f);
        return {
          key: `${cs.join(',')}|${V}`, params: { cs, V }, shown: [V, ...cs.map(Math.abs)],
          answer: ans, kind: 'number', exact: false, sig: 3,
          explain: `Multiply the factors: ${factors} = ${fixed(f, 4)} → ${C(V)} × ${fixed(f, 4)} ${approx(ans).startsWith('≈') ? '' : '= '}${approx(ans)}`,
          plain: [`${C(V)}, then ${cs.map(signedPct).join(', then ')}. New value?`, `Apply ${cs.map(signedPct).join(' and ')} to ${C(V)}`],
          frames: [
            { id: 's.rev', ok: V >= 1e5, text: `Revenue of ${curC}${C(V)} ${cs.map(past).join(', then ')}. What is revenue now?` },
            { id: 's.users', ok: V >= 1e4 && V <= 1e9, text: `A platform with ${F(V)} users ${cs.map(past).join(', then ')}. How many users now?` },
            { id: 's.cost', ok: V >= 1e5, text: `A cost base of ${curC}${C(V)} ${cs.map(past).join(', then ')}. What is it now?` },
          ].filter((f) => f.ok).map(({ id, text }) => ({ id, text })),
        };
      }
      const explain = count === 2
        ? `a + b + a×b/100 = ${sumExpr([cs[0], cs[1], clean((cs[0] * cs[1]) / 100)])} = ${signedPct(net)}`
        : `${factors} = ${fixed(f, 4)} → ${signedPct(roundSig(net, 3))}`;
      const frames = [
        { id: 's.sales', text: `Sales ${cs.map(past).join(', then ')}. What is the total % change?` },
        { id: 's.price', text: `A price ${cs.map(past).join(', then ')}. What is the net % change?` },
      ];
      if (count === 2) frames.push({ id: 's.volprice', text: `Volume ${verb(cs[0])} and price ${verb(cs[1])}. By what % does revenue change?` });
      return {
        key: cs.join(','), params: { cs, V: null }, shown: cs.map(Math.abs),
        answer: net, kind: 'percent', exact: false, sig: 3, signed: true,
        explain,
        plain: [`${cs.map(signedPct).join(' then ')}: net % change?`, `What is the overall change after ${cs.map(signedPct).join(', ')}?`],
        frames,
      };
    },
  },

  // ===== Division =====
  {
    id: 'div.clean',
    mode: 'div',
    name: 'Large-number division',
    gen(r, L) {
      // dividend has at most 3 significant digits, e.g. 4.2M ÷ 350 = 12K
      const [D, d, q] = until(
        () => {
          let d, q;
          if (L === 1) [d, q] = [r.int(2, 9) * 10 ** r.int(1, 3), biz(r, r.int(1, 2), 1, 5)];
          else if (L === 2) [d, q] = [intNoZero(r, 11, 99) * 10 ** r.int(0, 3), biz(r, r.int(1, 2), 1, 5)];
          else [d, q] = [(r.chance(0.5) ? intNoZero(r, 11, 99) : r.int(11, 99) * 5) * 10 ** r.int(0, 4), biz(r, 2, 1, 6)];
          return [clean(q * d), d, q];
        },
        ([D]) => sigDigits(D) <= 3
      );
      return {
        key: `${D}/${d}`, params: { D, d }, shown: [D, d],
        answer: q, kind: 'number', exact: true,
        explain: explainStripDivide(D, d, q),
        plain: divPlain(C(D), F(d)),
        frames: renderFrames(r, DIV_FRAMES, { D, d, q }),
      };
    },
  },
  {
    id: 'div.approx',
    mode: 'div',
    name: 'Estimating division (÷350)',
    gen(r, L) {
      const [D, d] = until(
        () => {
          if (L === 1) return [biz(r, 2, 4, 9), r.pick([2, 4, 5, 8, 16, 20, 25, 40, 50, 125, 250]) * 10 ** r.int(0, 2)];
          if (L === 2) return [biz(r, 2, 4, 10), intNoZero(r, 11, 99) * 10 ** r.int(0, 3)];
          return [biz(r, r.int(2, 3), 5, 10), (r.chance(0.5) ? intNoZero(r, 11, 99) : r.int(11, 99) * 5) * 10 ** r.int(0, 3)];
        },
        ([D, d]) => D / d >= 2
      );
      const q = clean(D / d);
      return {
        key: `${D}/${d}`, params: { D, d }, shown: [D, d],
        answer: q, kind: 'number', exact: false,
        sig: L === 1 ? 3 : 2,
        minTol: [0, 0.01, 0.02][L - 1],
        explain: explainReciprocal(D, d, q),
        plain: divPlain(C(D), F(d)).concat([`Roughly, ${C(D)} ÷ ${F(d)} = ?`]),
        frames: renderFrames(r, DIV_FRAMES, { D, d, q }),
      };
    },
  },
  {
    id: 'div.ratio',
    mode: 'div',
    name: 'How many times bigger?',
    gen(r, L) {
      const [X, Y] = until(
        () => {
          if (L === 1) {
            const y = biz(r, r.int(1, 2), 3, 8);
            return [clean(y * r.pick([2, 3, 4, 5, 6, 8, 10, 20, 25, 40, 50, 100, 200, 250, 500, 1000])), y];
          }
          if (L === 2) {
            const y = biz(r, r.int(1, 2), 3, 8);
            return [clean(y * intNoZero(r, 12, 99) * r.pick([1, 1, 10, 100])), y];
          }
          const y = biz(r, 2, 3, 8);
          return [roundSig(y * 10 ** (0.5 + r.next() * 3), r.int(2, 3)), y];
        },
        ([x]) => sigDigits(x) <= 3 && x <= 5e12
      );
      const k = clean(X / Y);
      return {
        key: `${X}/${Y}`, params: { X, Y }, shown: [X, Y],
        answer: k, kind: 'times', exact: L < 3, sig: 2, minTol: L === 3 ? 0.02 : 0,
        explain: explainSameUnits(X, Y, k, '×'),
        plain: [`How many times bigger is ${C(X)} than ${C(Y)}?`, `${C(X)} is how many times ${C(Y)}?`, `${C(X)} ÷ ${C(Y)} = ?×`],
        frames: renderFrames(r, RATIO_FRAMES, { X, Y }),
      };
    },
  },
  {
    id: 'div.payback',
    mode: 'div',
    name: 'Payback & break-even',
    gen(r, L) {
      const c = cur(r);
      if (r.chance(0.5)) {
        // payback years = investment ÷ annual saving
        let I, S;
        if (L === 1) {
          S = biz(r, r.int(1, 2), 4, 8);
          I = clean(S * r.int(2, 10));
        } else if (L === 2) {
          [S, I] = until(() => {
            const s = biz(r, 2, 4, 8);
            return [s, clean(s * r.pick([1.5, 2.5, 3.5, 4.5, 5.5, 6, 7, 8, 9, 12]))];
          }, ([, i]) => sigDigits(i) <= 3);
        } else {
          I = biz(r, 2, 5, 9);
          S = roundSig(I / (1.5 + r.next() * 10.5), 2);
        }
        const years = clean(I / S);
        return {
          key: `pb|${I}/${S}`, params: { I, S }, shown: [I, S],
          answer: years, kind: 'years', exact: L < 3, sig: 2, minTol: L === 3 ? 0.02 : 0,
          explain: explainSameUnits(I, S, years, ' years'),
          plain: [`Payback: ${c}${C(I)} invested, ${c}${C(S)} saved per year. How many years?`],
          frames: [
            { id: 'b.invest', text: `A ${c}${C(I)} investment saves ${c}${C(S)} a year. What is the payback period?` },
            { id: 'b.machine', text: `A new machine costs ${c}${C(I)} and adds ${c}${C(S)} of profit a year. How many years to pay it back?` },
            { id: 'b.it', text: `A ${c}${C(I)} IT system cuts costs by ${c}${C(S)} a year. Payback in years?` },
          ],
        };
      }
      // break-even units = fixed costs ÷ margin per unit
      let Fx, m;
      if (L === 1) {
        m = r.pick([2, 4, 5, 8, 10, 20, 25, 40, 50, 200, 250]);
        Fx = clean(m * biz(r, r.int(1, 2), 3, 6));
      } else if (L === 2) {
        [m, Fx] = until(() => {
          const mm = r.chance(0.5) ? intNoZero(r, 11, 99) : intNoZero(r, 11, 99) * 10;
          return [mm, clean(mm * biz(r, 2, 3, 6))];
        }, ([, f]) => sigDigits(f) <= 3);
      } else {
        Fx = biz(r, 2, 5, 8);
        m = r.chance(0.5) ? intNoZero(r, 11, 99) : intNoZero(r, 11, 99) * 10;
      }
      const units = clean(Fx / m);
      return {
        key: `be|${Fx}/${m}`, params: { I: Fx, S: m }, shown: [Fx, m],
        answer: units, kind: 'number', exact: L < 3, sig: 2, minTol: L === 3 ? 0.02 : 0,
        explain: L < 3 ? explainStripDivide(Fx, m, units) + ' units' : explainReciprocal(Fx, m, units) + ' units',
        plain: [`Break-even: fixed costs ${c}${C(Fx)}, margin ${c}${F(m)} per unit. Units needed?`],
        frames: [
          { id: 'b.units', text: `Fixed costs are ${c}${C(Fx)} and each unit earns ${c}${F(m)} contribution. How many units to break even?` },
          { id: 'b.launch', text: `A launch costs ${c}${C(Fx)}; each new customer brings ${c}${F(m)} profit. How many customers to break even?` },
          { id: 'b.store', text: `A store has ${c}${C(Fx)} of yearly fixed costs and makes ${c}${F(m)} per sale. How many sales to break even?` },
        ],
      };
    },
  },
];

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export function templatesForMode(mode) {
  return TEMPLATES.filter((t) => t.mode === mode);
}

export function answerHint(problem) {
  switch (problem.kind) {
    case 'percent':
      return problem.signed ? 'Answer in %, use − for a decrease' : 'Answer in %';
    case 'years':
      return 'Answer in years';
    case 'times':
      return 'Answer as a multiple, e.g. 40';
    default:
      return 'Use K, M, B for big numbers';
  }
}
