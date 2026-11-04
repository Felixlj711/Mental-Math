// Run with:  node tests/run-tests.mjs
// Checks that generated answers are correct, questions show the right numbers,
// answer checking works, and problems don't repeat.

import { TEMPLATES } from '../js/generators.js';
import { ProblemEngine, SEEN_WINDOW } from '../js/engine.js';
import { createRng } from '../js/rng.js';
import { parseAnswer, checkAnswer, displayAnswer, fmtNum } from '../js/format.js';
import { streaks, weekComparison, mistakeTypes, goalProgress, startOfWeek, addDays } from '../js/stats.js';
import { SIZING_COMBOS, SIZING_TEMPLATES, SizingPicker, makeCase, chainValue, chainText, treeText, gradeTree, approaches, bandLabel, fmtAnswer, ratioOff, COUNTRIES, CITIES } from '../js/sizing.js';

let failures = 0;
let checks = 0;
const failureKinds = new Map();
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    const kind = msg.replace(/^[^:]*: /, '').replace(/[\d.,]+/g, '#').slice(0, 60);
    failureKinds.set(kind, (failureKinds.get(kind) || 0) + 1);
    if (failures <= 15) console.log('  FAIL:', msg);
  }
}
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// ---------- 1. Answers recomputed independently from the raw numbers ----------
const RULE_K = { 2: 72, 3: 110, 4: 144, 8: 216 };
const ORACLE = {
  'mult.digits': (p) => p.a * p.b,
  'mult.3x1': (p) => p.a * p.b,
  'mult.zeros': (p) => p.a * p.b,
  'mult.units': (p) => p.a * p.b,
  'mult.near': (p) => p.a * p.b,
  'pct.of': (p) => (p.B * p.p) / 100,
  'pct.whatpct': (p) => (p.P / p.W) * 100,
  'pct.change': (p) => ((p.Y - p.X) / p.X) * 100,
  'pct.reverse': (p) => p.V / (1 + p.c / 100),
  'growth.compound': (p) => p.V * Math.pow(1 + (p.s * p.rate) / 100, p.n),
  'growth.cagr': (p) => (Math.pow(p.E / p.S, 1 / p.n) - 1) * 100,
  'growth.rule72': (p) => (p.variant === 'rate' ? 72 / p.x : RULE_K[p.M] / p.x),
  'growth.stacked': (p) => {
    const f = p.cs.reduce((acc, c) => acc * (1 + c / 100), 1);
    return p.V ? p.V * f : (f - 1) * 100;
  },
  'div.clean': (p) => p.D / p.d,
  'div.approx': (p) => p.D / p.d,
  'div.ratio': (p) => p.X / p.Y,
  'div.payback': (p) => p.I / p.S,
};

// Pull every number (with K/M/B/T suffix) out of a question.
function numbersIn(text) {
  const out = [];
  const re = /(\d[\d,]*(?:\.\d+)?)([KMBT])?/g;
  let m;
  while ((m = re.exec(text))) out.push(parseAnswer(m[1] + (m[2] || '')));
  return out;
}

console.log('1. Generator correctness');
const engineForText = new ProblemEngine({ rng: createRng(7), context: 'some' });
const PER_LEVEL = 3000;
for (const t of TEMPLATES) {
  assert(ORACLE[t.id], `no oracle for ${t.id}`);
  for (const L of [1, 2, 3]) {
    const rng = createRng(1000 + L);
    for (let i = 0; i < PER_LEVEL; i++) {
      const g = t.gen(rng, L);
      const where = `${t.id} L${L} key=${g.key}`;
      const expected = ORACLE[t.id](g.params);
      assert(Number.isFinite(g.answer) && g.answer !== 0, `${where}: bad answer ${g.answer}`);
      assert(close(g.answer, expected, 1e-9), `${where}: answer ${g.answer} != ${expected}`);
      if (g.exact) assert(Number.isInteger(g.answer) || g.kind !== 'number' || t.id === 'mult.units', `${where}: exact answer not an integer: ${g.answer}`);
      if (t.id === 'growth.rule72') {
        const truth = g.params.variant === 'rate' ? (2 ** (1 / g.params.x) - 1) * 100 : Math.log(g.params.M) / Math.log(1 + g.params.x / 100);
        assert(Math.abs(truth - g.answer) <= g.minTol * g.answer, `${where}: true value ${truth} not accepted`);
      }
      // every wording must show the numbers the answer depends on
      const texts = [...g.plain, ...g.frames.map((f) => f.text)];
      assert(texts.length > 0, `${where}: no wording`);
      for (const text of texts) {
        assert(!/undefined|NaN|Infinity|\[object/.test(text), `${where}: broken text "${text}"`);
        const nums = numbersIn(text);
        for (const s of g.shown) {
          assert(nums.some((n) => close(n, s, 1e-9)), `${where}: ${fmtNum(s)} missing from "${text}"`);
        }
      }
      assert(!/undefined|NaN|Infinity/.test(g.explain), `${where}: broken explanation "${g.explain}"`);
      // answer checking: the correct value and the shown answer are accepted
      const problem = engineForText.finish({ ...g, fingerprint: `test|${i}` }, { template: t, difficulty: L });
      const shownAnswer = displayAnswer(problem).replace(/^≈\s*/, '');
      for (const tol of [0, 2, 5]) {
        assert(checkAnswer(problem, g.answer, tol), `${where}: exact answer rejected at ±${tol}%`);
        assert(checkAnswer(problem, parseAnswer(shownAnswer), tol), `${where}: shown answer "${shownAnswer}" rejected at ±${tol}%`);
        assert(!checkAnswer(problem, g.answer * 1.3, tol), `${where}: +30% wrongly accepted at ±${tol}%`);
      }
      if (problem.minTol < 0.05) assert(!checkAnswer(problem, g.answer * 1.06, 5), `${where}: +6% accepted at ±5%`);
      if (problem.exact && problem.kind === 'number' && Math.abs(g.answer) > 100)
        assert(!checkAnswer(problem, g.answer + 1, 0), `${where}: off-by-one accepted in exact mode`);
    }
  }
}
console.log(`   ${TEMPLATES.length} templates × 3 levels × ${PER_LEVEL} problems checked`);

// ---------- 2. Answer parsing ----------
console.log('2. Answer parsing and tolerance');
const PARSE = [['2.4M', 2.4e6], ['432,000', 432000], ['432K', 432000], ['-12.5', -12.5], ['−3%', -3], ['40x', 40], ['1.2b', 1.2e9], ['.5', 0.5], ['12 years', 12], ['', NaN], ['abc', NaN], ['1.2.3', NaN], ['K', NaN]];
for (const [input, want] of PARSE) {
  const got = parseAnswer(input);
  assert(Number.isNaN(want) ? Number.isNaN(got) : close(got, want), `parse "${input}" -> ${got}, want ${want}`);
}
const p = { answer: 1000, exact: false, sig: 3, minTol: 0 };
assert(checkAnswer(p, 1019, 2) && !checkAnswer(p, 1021, 2), '±2% boundary');
assert(checkAnswer(p, 1049, 5) && !checkAnswer(p, 1051, 5), '±5% boundary');
assert(checkAnswer(p, 1004, 0) && !checkAnswer(p, 1006, 0), 'exact mode = 3 significant figures');
assert(checkAnswer({ answer: 1692, exact: true }, 1692, 0) && !checkAnswer({ answer: 1692, exact: true }, 1690, 0), 'exact integer');

// ---------- 3. No repeats ----------
console.log('3. Repeats');
function simulate(spec, count, seed) {
  const engine = new ProblemEngine({ rng: createRng(seed), context: 'often' });
  const lastSeenAt = new Map();
  let repeats = 0;
  let sameTemplateInARow = 0;
  let sameModeInARow = 0;
  let prev = null;
  const prompts = new Map();
  for (let i = 0; i < count; i++) {
    const pr = engine.next(spec);
    const at = lastSeenAt.get(pr.fingerprint);
    if (at != null && i - at <= SEEN_WINDOW) repeats++;
    lastSeenAt.set(pr.fingerprint, i);
    if (prev && prev.templateId === pr.templateId) sameTemplateInARow++;
    if (prev && spec.mode === 'mixed' && prev.mode === pr.mode) sameModeInARow++;
    prompts.set(pr.prompt, (prompts.get(pr.prompt) || 0) + 1);
    prev = pr;
  }
  return { repeats, sameTemplateInARow, sameModeInARow, distinctPrompts: prompts.size };
}
for (const mode of ['mult', 'pct', 'growth', 'div']) {
  for (const difficulty of [1, 2, 3]) {
    const r = simulate({ mode, difficulty }, 3000, difficulty * 31);
    assert(r.repeats === 0, `${mode} L${difficulty}: ${r.repeats} repeats in 3000`);
    assert(r.sameTemplateInARow === 0, `${mode} L${difficulty}: same template twice in a row ${r.sameTemplateInARow}×`);
  }
}
const big = simulate({ mode: 'mixed', difficulty: 2 }, 20000, 99);
assert(big.repeats === 0, `mixed: ${big.repeats} repeats within ${SEEN_WINDOW}`);
assert(big.sameTemplateInARow === 0 && big.sameModeInARow === 0, 'mixed: back-to-back template or mode');
console.log(`   mixed mode, 20,000 problems: ${big.repeats} repeats, ${big.distinctPrompts} distinct question texts`);
// Restarting the app: history from storage must keep blocking repeats
{
  const first = new ProblemEngine({ rng: createRng(5) });
  const fps = Array.from({ length: 4000 }, () => first.next({ mode: 'mult', difficulty: 1 }).fingerprint);
  const second = new ProblemEngine({ rng: createRng(5), recentFingerprints: fps });
  const again = Array.from({ length: 2000 }, () => second.next({ mode: 'mult', difficulty: 1 }).fingerprint);
  const set = new Set(fps);
  assert(again.every((fp) => !set.has(fp)), 'repeats after reloading history');
}

// ---------- 4. Size of the problem space ----------
console.log('4. Estimated number of distinct problems (capture–recapture, 20k + 20k samples)');
const rows = [];
let smallest = Infinity;
for (const t of TEMPLATES) {
  const row = [t.id.padEnd(16)];
  for (const L of [1, 2, 3]) {
    const n = 20000;
    const a = new Set();
    const rngA = createRng(11 * L);
    for (let i = 0; i < n; i++) a.add(t.gen(rngA, L).key);
    const rngB = createRng(77 * L + 3);
    let overlap = 0;
    const b = new Set();
    for (let i = 0; i < n; i++) b.add(t.gen(rngB, L).key);
    for (const k of b) if (a.has(k)) overlap++;
    const est = overlap === 0 ? Infinity : Math.round((a.size * b.size) / overlap);
    smallest = Math.min(smallest, est);
    row.push((est === Infinity ? '> 10 million' : est.toLocaleString('en-US')).padStart(14));
  }
  rows.push(row.join(''));
}
console.log('   ' + 'template'.padEnd(16) + 'easy'.padStart(14) + 'medium'.padStart(14) + 'hard'.padStart(14));
for (const r of rows) console.log('   ' + r);

// ---------- 5. Progress statistics ----------
console.log('5. Progress statistics');
{
  const now = new Date(2026, 9, 23, 12).getTime(); // Fri 23 Oct 2026
  const mk = (daysAgo, correct, mode = 'mult', sessionId = 's' + daysAgo) => ({
    ts: addDays(now, -daysAgo), correct, mode, sessionId, timeMs: 8000, templateId: 'mult.digits', difficulty: 2,
  });
  const list = [mk(0, true), mk(1, true), mk(2, false), mk(4, true), mk(5, true), mk(5, true)];
  const s = streaks(list, now);
  assert(s.current === 3 && s.best === 3 && s.practicedToday, `streak ${JSON.stringify(s)}`);
  assert(streaks([mk(1, true), mk(2, true)], now).current === 2, 'streak continues if today not yet practised');
  const wc = weekComparison(list, now);
  // Week starts Monday 19 Oct: days 0..4 ago are this week
  assert(wc.thisWeek.all.n === 4 && wc.lastWeek.all.n === 2, `week split ${wc.thisWeek.all.n}/${wc.lastWeek.all.n}`);
  assert(new Date(startOfWeek(now)).getDay() === 1, 'week starts on Monday');
  const mt = mistakeTypes(list, now);
  assert(mt.length === 1 && mt[0].wrong === 1, 'mistake types');
  const gp = goalProgress({ type: 'sessions', target: 5 }, list, now);
  assert(gp.done === 4, `goal sessions ${gp.done}`);
}

if (failures) {
  console.log('\nFailure kinds:');
  for (const [k, n] of failureKinds) console.log(`   ${n}× ${k}`);
}
// ---------- 6. Market sizing ----------
console.log('6. Market sizing cases');
{
  const regions = new Map([...COUNTRIES, ...CITIES].map((r) => [r.id, r]));
  const rng = createRng(11);
  const verdicts = new Set();
  for (const combo of SIZING_COMBOS) {
    const c = makeCase(combo, rng);
    const where = combo.fingerprint;
    const cur = c.region.cur;
    assert(Number.isFinite(c.answer) && c.answer > 0, `${where}: bad answer ${c.answer}`);
    assert(c.clarify.questions.length >= 2 && c.clarify.answer, `${where}: clarify content missing`);
    assert(c.facts.length >= 1 && c.archetype, `${where}: no key facts or archetype`);
    // angles: exactly one is mine, and it is a valid one
    const mine = c.angles.filter((x) => x.mine);
    assert(c.angles.length >= 2 && mine.length === 1 && mine[0].ok, `${where}: needs exactly one valid angle of mine`);
    assert(c.angles.every((x) => x.label && x.why), `${where}: angle text missing`);
    // tree: unique keys, joined by × or ÷, every driver explained
    const keys = new Set();
    c.tree.forEach((d, i) => {
      assert(!keys.has(d.key), `${where}: duplicate block key ${d.key}`);
      keys.add(d.key);
      assert(i === 0 ? d.op === '' : ['×', '÷'].includes(d.op), `${where}: bad op on ${d.key}`);
      assert(d.block && d.note && Number.isFinite(d.value) && d.value > 0, `${where}: driver ${d.key} needs text and a value`);
      if (d.kind !== 'const') {
        assert(d.ask, `${where}: driver ${d.key} needs a question`);
        // ranges: four of them, at least one holding my number, no gaps in the labels
        const bands = c.bands[d.key];
        assert(bands.length === 4 && bands.some((b) => b.mine), `${where}: ${d.key} ranges must hold my number`);
        assert(bands.every((b, j) => b.lo <= b.hi && b.use > 0 && (j === 0 || bands[j - 1].hi <= b.lo)), `${where}: ${d.key} ranges out of order`);
        assert(bands.every((b) => b.use >= b.lo && b.use <= b.hi), `${where}: ${d.key} value used must sit in its range`);
        assert(!/undefined|NaN/.test(bands.map((b) => bandLabel(d, b, cur)).join()), `${where}: ${d.key} bad range label`);
      }
    });
    // extras: none collide with the tree, at least one double-count trap, 6+ blocks to choose from
    for (const x of c.extras) {
      assert(!keys.has(x.key), `${where}: extra ${x.key} collides with the tree`);
      assert(['off', 'trap', 'unit'].includes(x.kind) && x.block && x.why, `${where}: extra ${x.key} incomplete`);
      keys.add(x.key);
    }
    assert(c.extras.some((x) => x.kind === 'trap'), `${where}: needs a double-count trap`);
    assert(c.blocks.length >= 6 && c.blocks.length <= 11, `${where}: ${c.blocks.length} blocks`);
    // text renders
    const text = [c.question, treeText(c.tree), chainText(c.tree, c.ref, cur), fmtAnswer(c, c.answer), c.per(c.answer), c.unit].join(' ');
    assert(!/undefined|NaN|Infinity/.test(text), `${where}: broken text: ${text}`);
    // facts match the region's known figures
    const R = regions.get(c.region.id);
    const pop = c.tree.find((d) => d.key === 'pop');
    if (pop) assert(pop.value === R.pop, `${where}: population fact mismatch`);
    const hh = c.tree.find((d) => d.key === 'hh');
    if (hh) assert(hh.value === R.hh, `${where}: household fact mismatch`);
    // grading: my tree is right in any order; an extra or a missing driver isn't
    assert(gradeTree(c, c.tree).ok && gradeTree(c, c.tree).inOrder, `${where}: my own tree must pass`);
    assert(gradeTree(c, [...c.tree].reverse()).ok, `${where}: order must not fail the tree`);
    assert(!gradeTree(c, [...c.tree, c.extras[0]]).ok && !gradeTree(c, c.tree.slice(1)).ok, `${where}: wrong trees must fail`);
    // approaches: four distinct options, exactly one right
    const opts = approaches(c, rng);
    assert(opts.length === 4 && opts.filter((o) => o.ok).length === 1, `${where}: approaches need 4 options, one right`);
    assert(new Set(opts.map((o) => treeText(o.blocks))).size === 4, `${where}: approaches must differ`);
    // the colleague's sense-check answer sits where its verdict says
    const r = c.colleague.value / c.answer;
    const { verdict } = c.colleague;
    verdicts.add(verdict);
    assert(verdict === 'ok' ? ratioOff(c.colleague.value, c.answer) < 1.5 : verdict === 'high' ? r > 5 : r < 0.2, `${where}: colleague ${verdict} at ${r}×`);
    // ranges: picking mine everywhere reproduces my answer; any other pick still lands in a sane place
    const mineVals = {};
    const lowVals = {};
    for (const d of c.tree) {
      mineVals[d.key] = d.kind === 'const' ? d.value : c.bands[d.key].find((b) => b.mine).use;
      lowVals[d.key] = d.kind === 'const' ? d.value : c.bands[d.key][0].use;
    }
    assert(Math.abs(chainValue(c.tree, mineVals) / c.answer - 1) < 1e-9, `${where}: my ranges must give my answer`);
    assert(Number.isFinite(chainValue(c.tree, lowVals)) && chainValue(c.tree, lowVals) > 0, `${where}: low ranges break the maths`);
  }
  assert(verdicts.size === 3, 'colleague answers should be plausible, too high and too low');
  const archetypes = new Set(SIZING_TEMPLATES.map((t) => t.archetype));
  assert(archetypes.size >= 12, `only ${archetypes.size} different archetypes`);
  console.log(`   ${archetypes.size} archetypes`);
  // picker: every case once before any repeat, never the same case type twice in a row
  const picker = new SizingPicker({ rng: createRng(3) });
  const seenFp = new Set();
  let prev = null;
  let backToBack = 0;
  for (let i = 0; i < SIZING_COMBOS.length; i++) {
    const c = picker.next();
    seenFp.add(c.fingerprint);
    if (prev === c.templateId) backToBack++;
    prev = c.templateId;
  }
  assert(seenFp.size >= SIZING_COMBOS.length - 2, `sizing picker repeated too early: ${seenFp.size} distinct of ${SIZING_COMBOS.length}`);
  assert(backToBack === 0, `sizing picker gave the same case type twice in a row ${backToBack}×`);
  console.log(`   ${SIZING_TEMPLATES.length} case types, ${SIZING_COMBOS.length} case/region combinations, ${seenFp.size} distinct in the first ${SIZING_COMBOS.length} picks`);
}

console.log(`\n${checks.toLocaleString('en-US')} checks, ${failures} failures`);
if (Number.isFinite(smallest)) console.log(`Smallest problem space for a single template/level: ~${smallest.toLocaleString('en-US')}`);
process.exit(failures ? 1 : 0);
