// The market sizing screen, in two formats:
//   Full case: 1 Clarify → 2 Angle → 3 Build the tree → 4 Tap your numbers
//              → 5 Calculate → 6 Sense check → result (scored out of 5)
//   Structure sprint: quick rounds of "build the tree" or "pick the
//              approach", with no numbers at all

import { $, $$, h, uid, editNumber, formatInput } from './dom.js';
import { parseAnswer } from './format.js';
import {
  SizingPicker, CALC_TOLERANCE, BALLPARK, CASE_POINTS, EXTRA_LABELS,
  approaches, bandLabel, chainText, chainValue, fmtAnswer, fmtDriver, gradeTree, ratioOff, treeText,
} from './sizing.js';

let app = null; // { getAttempts, saveAttempt, showView, onFinish }
let ses = null; // current session

const within = (given, target, tol) => Math.abs(given - target) <= tol * Math.abs(target);
// 2.4 -> "2.4×", 840000 -> "840,000×"
const timesText = (r) => `${r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US')}×`;
// "Demand side: people × …" -> "demand side"
const angleName = (a) => a.label.split(':')[0].toLowerCase();

const POINT_LABELS = { angle: 'Angle', tree: 'Tree', maths: 'Maths', sense: 'Sense check', ballpark: `Within ${BALLPARK}× of mine` };
const VERDICTS = [['ok', 'Plausible'], ['high', 'Too high'], ['low', 'Too low']];
const VERDICT_TEXT = { ok: "it's plausible", high: "it's about 10× too high", low: "it's about 10× too low" };

export function initSizing(hooks) {
  app = hooks;
  for (const k of $$('#sz-keypad button')) k.addEventListener('click', () => press(k.dataset.key));
  $('#sz-check').addEventListener('click', () => checkCalc(false));
  $('#sz-reveal').addEventListener('click', () => checkCalc(true));
  $('#sz-continue').addEventListener('click', () => ses?.onContinue?.());
  $('#sz-exit').addEventListener('click', exitSizing);
  $('#sz-facts-btn').addEventListener('click', () => {
    const box = $('#sz-facts');
    box.hidden = !box.hidden;
    $('#sz-facts-btn').setAttribute('aria-expanded', String(!box.hidden));
    $('#sz-facts-btn').textContent = box.hidden ? 'Key facts' : 'Hide facts';
  });
  document.addEventListener('keydown', onKey);
}

export function sizingActive() {
  return ses != null;
}

// type: 'case' (full case) or 'sprint' (structure sprint)
export function startSizing(type, count) {
  const recent = app.getAttempts().filter((a) => a.mode === 'sizing').map((a) => a.fingerprint);
  const picker = new SizingPicker({ recentFingerprints: recent });
  ses = { id: uid(), type, target: count, results: [], picker, flip: picker.rng.chance(0.5), startedAt: Date.now() };
  app.showView('sizing');
  nextItem();
}

export function exitSizing(ask = true) {
  if (!ses) return;
  const what = ses.type === 'sprint' ? 'round' : 'case';
  if (ask && ses.results.length && !confirm(`End this session? Finished ${what}s are saved.`)) return;
  if (ask && !ses.results.length && ses.caseState && !confirm(`End this ${what}?`)) return;
  const done = ses;
  ses = null;
  app.onFinish(done);
}

// ---------- shared ----------
function nextItem() {
  if (ses.results.length >= ses.target) return exitSizing(false);
  const c = ses.picker.next();
  ses.caseState = { c, started: performance.now(), points: {}, vals: {}, picks: {} };
  for (const d of c.tree) if (d.kind === 'const') ses.caseState.vals[d.key] = d.value;
  const sprint = ses.type === 'sprint';
  $('#sz-tag').textContent = `${sprint ? 'Structure sprint' : 'Market sizing'} · ${c.region.label} · ${c.archetype}`;
  $('#sz-question').textContent = c.question;
  $('#sz-facts-list').replaceChildren(...c.facts.map((f) => h('li', {}, f)));
  $('#sz-facts').hidden = true;
  $('#sz-facts-btn').hidden = sprint;
  $('#sz-facts-btn').textContent = 'Key facts';
  $('#sz-facts-btn').setAttribute('aria-expanded', 'false');
  $('#sz-log').replaceChildren();
  renderTop();
  if (sprint) sprintRound();
  else clarifyBeat();
  $('#sz-scroll').scrollTo(0, 0);
}

function renderTop() {
  const n = ses.results.length + (ses.caseState && !ses.caseState.done ? 1 : 0);
  $('#sz-counter').textContent = `${ses.type === 'sprint' ? 'Round' : 'Case'} ${Math.min(Math.max(n, 1), ses.target)} / ${ses.target}`;
  $('#sz-bar').style.width = `${(ses.results.length / ses.target) * 100}%`;
}

function card(title, ...body) {
  const el = h('div', { class: 'card sz-card' }, h('div', { class: 'sz-card-title' }, title), ...body);
  $('#sz-log').append(el);
  scrollTo(el, 'end');
  return el;
}

// Keep the newest content in view (the result card is shown from its top).
function scrollTo(el, block) {
  requestAnimationFrame(() => el.scrollIntoView({ block, behavior: 'smooth' }));
}

function showContinue(label, onContinue, disabled = false) {
  $('#sz-input').hidden = true;
  $('#sz-continue-wrap').hidden = false;
  $('#sz-continue').textContent = label;
  $('#sz-continue').disabled = disabled;
  ses.onContinue = onContinue;
  ses.inputMode = false;
}

// While the answer is a tap in the case card, the dock stays empty.
function hideDock() {
  $('#sz-input').hidden = true;
  $('#sz-continue-wrap').hidden = true;
  ses.onContinue = null;
  ses.inputMode = false;
}

// A group of answer buttons; the first tap locks them all.
function choices(labels, onPick, layout = 'stack') {
  const btns = labels.map((label, i) =>
    h('button', {
      type: 'button',
      class: 'sz-choice',
      onclick: () => {
        for (const b of btns) b.disabled = true;
        btns[i].classList.add('picked');
        onPick(i, btns);
      },
    }, label)
  );
  return h('div', { class: `sz-choices ${layout}` }, btns);
}

// Tap blocks into your tree in order; tap again to take one out.
function treeBuilder(el, c, onChecked) {
  const picked = [];
  let done = false;
  const yours = h('div', { class: 'sz-tree' });
  const chips = new Map();
  const toggle = (b) => {
    if (done) return;
    const i = picked.indexOf(b);
    if (i >= 0) picked.splice(i, 1);
    else picked.push(b);
    render();
  };
  for (const b of c.blocks) chips.set(b.key, h('button', { type: 'button', class: 'sz-chip', onclick: () => toggle(b) }, b.block));
  const render = () => {
    yours.replaceChildren(
      ...(picked.length
        ? picked.map((b, i) => h('button', { type: 'button', class: 'sz-chip in', onclick: () => toggle(b) }, h('span', { class: 'sz-step' }, String(i + 1)), b.block))
        : [h('span', { class: 'muted small' }, "Tap blocks below in the order you'd use them.")])
    );
    for (const [key, chip] of chips) chip.classList.toggle('used', picked.some((b) => b.key === key));
    $('#sz-continue').disabled = !picked.length;
  };
  el.append(h('div', { class: 'sz-label' }, 'Your tree'), yours, h('div', { class: 'sz-label' }, 'Building blocks'), h('div', { class: 'sz-pool' }, [...chips.values()]));
  showContinue('Check tree', () => {
    done = true;
    const g = gradeTree(c, picked);
    for (const [key, chip] of chips) {
      chip.disabled = true;
      const inTree = c.tree.some((d) => d.key === key);
      const chosen = picked.some((b) => b.key === key);
      chip.classList.add(inTree ? (chosen ? 'good' : 'missed') : chosen ? 'bad' : 'idle');
    }
    for (const chip of yours.children) chip.disabled = true;
    const lines = [
      ...g.wrong.map((b) => h('li', { class: 'bad' }, h('strong', {}, `${EXTRA_LABELS[b.kind]}: `), `${b.block}. ${b.why}`)),
      ...g.missed.map((d) => h('li', { class: 'bad' }, h('strong', {}, 'Missed: '), d.block)),
    ];
    if (g.found > 1 && !g.inOrder) lines.push(h('li', {}, h('strong', {}, 'Order: '), "fine for the maths, but I'd walk through it as below, from the base outwards."));
    const others = c.extras.filter((x) => !picked.includes(x));
    el.append(
      h('div', { class: `sz-result ${g.ok ? 'good' : 'bad'}` }, g.ok ? 'Right tree ✓' : `${g.found} of ${g.total} drivers${g.wrong.length ? `, ${g.wrong.length} that don't belong` : ''}`),
      lines.length ? h('ul', { class: 'sz-why' }, lines) : null,
      h('p', { class: 'sz-formula' }, treeText(c.tree)),
      others.length
        ? h('details', { class: 'sz-more' }, h('summary', {}, "Why the other blocks don't belong"),
          h('ul', { class: 'sz-why' }, others.map((x) => h('li', {}, h('strong', {}, `${x.block}: `), x.why))))
        : null
    );
    scrollTo(el.lastElementChild, 'end');
    onChecked(g);
  }, true);
  render();
}

// ---------- full case ----------
function clarifyBeat() {
  const { c } = ses.caseState;
  const el = card('1 · Clarify', h('p', { class: 'muted' }, 'Market sizing questions are ambiguous. What would you ask the interviewer before you start?'));
  showContinue('Reveal clarifying questions', () => {
    el.append(
      h('ul', { class: 'sz-list' }, c.clarify.questions.map((q) => h('li', {}, `“${q}”`))),
      h('p', { class: 'sz-interviewer' }, h('strong', {}, 'Interviewer: '), c.clarify.answer)
    );
    showContinue('Next: choose the angle', angleBeat);
  });
}

function angleBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  const el = card('2 · Choose the angle', h('p', { class: 'muted' }, 'How would you come at this question?'));
  hideDock();
  el.append(
    choices(c.angles.map((a) => a.label), (i, btns) => {
      const a = c.angles[i];
      const mine = c.angles.find((x) => x.mine);
      cs.points.angle = a.ok;
      btns.forEach((b, j) => b.classList.add(c.angles[j].ok ? 'good' : 'bad'));
      el.append(
        h('ul', { class: 'sz-why' }, c.angles.map((x) => h('li', { class: x.ok ? 'good' : 'bad' }, h('strong', {}, `${x.label.split(':')[0]}: `), x.why))),
        h('p', {}, a.mine ? "Good call. That's the tree we'll build." : a.ok ? `That works too. I'd go ${angleName(mine)} here, so that's the tree we'll build.` : `Not the best fit here. I'd go ${angleName(mine)}.`)
      );
      scrollTo(el.lastElementChild, 'end');
      showContinue('Next: build the tree', treeBeat);
    })
  );
}

function treeBeat() {
  const cs = ses.caseState;
  const el = card('3 · Build the tree', h('p', { class: 'muted' }, 'Pick the drivers you need, in order. Some blocks are distractors and some double count.'));
  treeBuilder(el, cs.c, (g) => {
    cs.points.tree = g.ok;
    cs.tree = g;
    showContinue('Next: your numbers', numbersBeat);
  });
}

function numbersBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  const cur = c.region.cur;
  const el = card('4 · Your numbers', h('p', { class: 'muted' }, "Tap a range for each driver. Facts should hold mine; assumptions are never wrong, you just see where mine sits."));
  hideDock();
  const drivers = c.tree.filter((d) => d.kind !== 'const');
  let i = 0;
  const step = () => {
    if (i >= drivers.length) {
      showContinue('Next: calculate', calcBeat);
      return;
    }
    const d = drivers[i++];
    const bands = c.bands[d.key];
    const row = h('div', { class: 'sz-stage' }, h('div', { class: 'sz-stage-q' }, d.ask));
    row.append(
      choices(bands.map((b) => bandLabel(d, b, cur)), (j, btns) => {
        const b = bands[j];
        cs.vals[d.key] = b.use;
        cs.picks[d.key] = b.mine;
        btns.forEach((x, k) => bands[k].mine && x.classList.add('good'));
        if (!b.mine) btns[j].classList.add(d.kind === 'fact' ? 'bad' : 'off');
        const mineText = fmtDriver(d, d.value, cur);
        const note = b.mine
          ? `${d.kind === 'fact' ? 'Right' : 'Same range as me'}: I'd use ${mineText}. ${d.note}`
          : `I'd go with ${mineText}. ${d.note}${d.kind === 'assume' ? ' Fine if you can justify yours.' : ''} You'll carry on with ${fmtDriver(d, b.use, cur)}.`;
        row.append(h('div', { class: 'sz-stage-note' }, note));
        step();
      }, 'grid')
    );
    el.append(row);
    scrollTo(row, 'end');
  };
  step();
}

function calcBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  cs.expected = chainValue(c.tree, cs.vals);
  card('5 · Calculate', h('p', { class: 'muted' }, 'Run your numbers through your tree.'), h('p', { class: 'sz-formula' }, chainText(c.tree, cs.vals, c.region.cur)));
  ses.input = '';
  ses.inputMode = true;
  $('#sz-continue-wrap').hidden = true;
  $('#sz-input').hidden = false;
  $('#sz-context').textContent = `${c.name} · ${c.region.label}`;
  $('#sz-ask').textContent = c.money ? `So what's the answer, in ${c.region.cur}?` : `So how many ${c.unit}?`;
  $('#sz-answer-unit').textContent = '';
  $('#sz-hint').textContent = `Checked against your own numbers (±${CALC_TOLERANCE * 100}%).`;
  renderInput();
}

function renderInput() {
  const { c } = ses.caseState;
  $('#sz-answer-text').textContent = ses.input ? (c.money ? c.region.cur : '') + formatInput(ses.input) : '';
  $('#sz-answer').classList.toggle('empty', ses.input === '');
}

function press(key) {
  if (!ses?.inputMode) return;
  ses.input = editNumber(ses.input, key);
  renderInput();
}

function checkCalc(reveal = false) {
  if (!ses?.inputMode) return;
  const cs = ses.caseState;
  const { c } = cs;
  const expected = cs.expected;
  const given = reveal ? expected : parseAnswer(ses.input);
  if (!Number.isFinite(given) || given <= 0) {
    const box = $('#sz-answer');
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    return;
  }
  const formula = chainText(c.tree, cs.vals, c.region.cur);
  const ok = !reveal && within(given, expected, CALC_TOLERANCE);
  const verdict = reveal ? 'revealed' : ok ? 'good' : 'bad';
  const message = reveal
    ? `${formula} = ${fmtAnswer(c, expected)}.`
    : ok
      ? `Correct: ${formula} = ${fmtAnswer(c, expected)}.`
      : `With your numbers it's ${fmtAnswer(c, expected)}. I'll carry on with that.`;
  cs.points.maths = ok;
  // the ballpark check judges your assumptions, so a slip in the maths isn't punished twice
  cs.final = ok ? given : expected;
  const badge = { good: '✓', bad: '✗', revealed: '–' }[verdict];
  $('#sz-log').lastElementChild.append(
    h(
      'div',
      { class: `sz-stage ${verdict}` },
      h('div', { class: 'sz-stage-a' }, h('span', { class: 'sz-badge', 'aria-hidden': 'true' }, badge), reveal ? 'Revealed' : `You: ${fmtAnswer(c, given)}`),
      h('div', { class: 'sz-stage-note' }, message)
    )
  );
  scrollTo($('#sz-log').lastElementChild.lastElementChild, 'end');
  showContinue('Next: sense check', senseBeat);
}

function senseBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  const col = c.colleague;
  const el = card('6 · Sense check', h('p', {}, `A colleague says ${fmtAnswer(c, col.value)} ${c.unit}. Plausible?`), h('p', { class: 'muted small' }, 'Try a per-person or per-household check.'));
  hideDock();
  el.append(
    choices(VERDICTS.map(([, label]) => label), (i, btns) => {
      const right = VERDICTS[i][0] === col.verdict;
      cs.points.sense = right;
      btns[VERDICTS.findIndex(([v]) => v === col.verdict)].classList.add('good');
      if (!right) btns[i].classList.add('bad');
      el.append(
        h('p', {}, h('strong', {}, right ? 'Right: ' : 'Not quite: '), `${VERDICT_TEXT[col.verdict]}. That's ${c.per(col.value)}.`),
        h('p', { class: 'muted' }, `Yours works out at ${c.per(cs.final)}; mine at ${c.per(c.answer)}.`)
      );
      scrollTo(el.lastElementChild, 'end');
      showContinue('See result', resultBeat);
    }, 'row')
  );
}

function resultBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  const cur = c.region.cur;
  const ratio = cs.final / c.answer;
  cs.points.ballpark = ratioOff(cs.final, c.answer) <= BALLPARK;
  const score = CASE_POINTS.filter((k) => cs.points[k]).length;
  const factDrivers = c.tree.filter((d) => d.kind === 'fact');
  const factsRight = factDrivers.filter((d) => cs.picks[d.key]).length;
  const headline = score >= 4 ? 'Strong case' : score === 3 ? 'Decent, with room to tighten' : 'Work on the structure';
  const offText = cs.points.ballpark ? `within ${timesText(ratioOff(cs.final, c.answer))}` : `${timesText(ratio > 1 ? ratio : 1 / ratio)} ${ratio > 1 ? 'higher' : 'lower'}`;

  const rows = c.tree
    .filter((d) => d.kind !== 'const')
    .map((d) => h('tr', { class: cs.picks[d.key] ? 'good' : d.kind === 'fact' ? 'bad' : '' }, h('td', {}, d.block), h('td', {}, fmtDriver(d, cs.vals[d.key], cur)), h('td', {}, fmtDriver(d, d.value, cur))));
  const resultCard = card(
    'Result',
    h('div', { class: `sz-result ${score >= 4 ? 'good' : 'bad'}` }, `${score} / ${CASE_POINTS.length} · ${headline}`),
    h('ul', { class: 'sz-checklist' }, CASE_POINTS.map((k) => h('li', { class: cs.points[k] ? 'good' : 'bad' }, h('span', { class: 'sz-badge', 'aria-hidden': 'true' }, cs.points[k] ? '✓' : '✗'), POINT_LABELS[k], k === 'ballpark' ? h('span', { class: 'muted small' }, ` (${offText})`) : null))),
    h('div', { class: 'sz-final' }, h('div', {}, h('span', { class: 'muted small' }, 'You'), h('strong', {}, fmtAnswer(c, cs.final))), h('div', {}, h('span', { class: 'muted small' }, 'Me'), h('strong', {}, fmtAnswer(c, c.answer)))),
    h('table', { class: 'sz-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Driver'), h('th', {}, 'You'), h('th', {}, 'Me'))), h('tbody', {}, rows))
  );

  scrollTo(resultCard, 'start');
  cs.done = true;
  const attempt = {
    ts: Date.now(),
    sessionId: ses.id,
    mode: 'sizing',
    sizingType: 'case',
    templateId: c.templateId,
    difficulty: 1,
    correct: score >= 4,
    skipped: false,
    timeMs: Math.round(Math.min(performance.now() - cs.started, 3600000)),
    prompt: c.question,
    answer: c.answer,
    kind: 'number',
    given: cs.final,
    fingerprint: c.fingerprint,
    score,
    scoreMax: CASE_POINTS.length,
    treeOk: cs.points.tree === true,
    factsRight,
    factsTotal: factDrivers.length,
  };
  ses.results.push({ attempt, c });
  app.saveAttempt(attempt);
  renderTop();
  const more = ses.results.length < ses.target;
  showContinue(more ? 'Next case' : 'See summary', more ? nextItem : () => exitSizing(false));
}

// ---------- structure sprint ----------
function sprintRound() {
  const { c } = ses.caseState;
  ses.flip = !ses.flip;
  const scope = h('p', { class: 'sz-interviewer' }, h('strong', {}, 'Interviewer: '), c.clarify.answer);
  if (ses.flip) {
    const el = card('Build the tree', scope, h('p', { class: 'muted' }, 'Pick the drivers you need, in order. Some blocks are distractors and some double count.'));
    treeBuilder(el, c, (g) => finishRound('tree', g.ok));
    return;
  }
  const opts = approaches(c, ses.picker.rng);
  const letters = 'ABCD';
  const el = card('Pick the approach', scope, h('p', { class: 'muted' }, 'One tree is right. The others each have one flaw.'));
  hideDock();
  el.append(
    choices(opts.map((o, i) => `${letters[i]} · ${treeText(o.blocks)}`), (i, btns) => {
      opts.forEach((o, j) => o.ok && btns[j].classList.add('good'));
      if (!opts[i].ok) btns[i].classList.add('bad');
      el.append(h('ul', { class: 'sz-why' }, opts.map((o, j) => h('li', { class: o.ok ? 'good' : 'bad' }, h('strong', {}, `${letters[j]}: `), o.flaw))));
      scrollTo(el.lastElementChild, 'end');
      finishRound('pick', opts[i].ok);
    })
  );
}

function finishRound(round, ok) {
  const cs = ses.caseState;
  const { c } = cs;
  cs.done = true;
  const attempt = {
    ts: Date.now(),
    sessionId: ses.id,
    mode: 'sizing',
    sizingType: 'sprint',
    round,
    templateId: c.templateId,
    difficulty: 1,
    correct: ok,
    skipped: false,
    timeMs: Math.round(Math.min(performance.now() - cs.started, 3600000)),
    prompt: c.question,
    answer: c.answer,
    kind: 'number',
    given: null,
    fingerprint: c.fingerprint,
  };
  ses.results.push({ attempt, c });
  app.saveAttempt(attempt);
  renderTop();
  const more = ses.results.length < ses.target;
  showContinue(more ? 'Next round' : 'See summary', more ? nextItem : () => exitSizing(false));
}

function onKey(e) {
  if (!ses || document.body.dataset.view !== 'sizing' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (!ses.inputMode) {
    if (k === 'Enter' && ses.onContinue && !$('#sz-continue').disabled) {
      e.preventDefault();
      ses.onContinue();
    } else if (/^[1-9]$/.test(k)) {
      // number keys pick an answer in the newest group of choices
      const btn = $$('.sz-choice', $$('#sz-log .sz-choices').at(-1) ?? document.createElement('div'))[Number(k) - 1];
      if (btn && !btn.disabled) {
        e.preventDefault();
        btn.click();
      }
    } else if (k === 'Escape') exitSizing();
    return;
  }
  if (/^[0-9]$/.test(k)) press(k);
  else if (k === '.' || k === ',') press('.');
  else if (/^[kmb]$/i.test(k)) press(k.toUpperCase());
  else if (k === 'Backspace') press('back');
  else if (k === 'Enter') checkCalc(false);
  else if (k === 'Escape') exitSizing();
  else return;
  e.preventDefault();
}
