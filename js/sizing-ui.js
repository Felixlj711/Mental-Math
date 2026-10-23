// The guided market sizing screen:
//   1 Clarify → 2 Plan → 3 Estimate stage by stage → 4 Sense check → result

import { $, $$, h, uid, editNumber, formatInput } from './dom.js';
import { parseAnswer } from './format.js';
import { SizingPicker, fmtStage, SIZING_TOLERANCE, CALC_TOLERANCE } from './sizing.js';

let app = null; // { getAttempts, saveAttempt, showView, onFinish }
let ses = null; // current session

const within = (given, target, tol) => Math.abs(given - target) <= tol * Math.abs(target);
// 2.4 -> "2.4×", 840000 -> "840,000×"
const timesText = (r) => `${r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US')}×`;

export function initSizing(hooks) {
  app = hooks;
  for (const k of $$('#sz-keypad button')) k.addEventListener('click', () => press(k.dataset.key));
  $('#sz-check').addEventListener('click', () => checkStage(false));
  $('#sz-reveal').addEventListener('click', () => checkStage(true));
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

export function startSizing(count) {
  const recent = app.getAttempts().filter((a) => a.mode === 'sizing').map((a) => a.fingerprint);
  ses = { id: uid(), target: count, results: [], picker: new SizingPicker({ recentFingerprints: recent }), startedAt: Date.now() };
  app.showView('sizing');
  nextCase();
}

export function exitSizing(ask = true) {
  if (!ses) return;
  if (ask && ses.results.length && !confirm('End this session? Finished cases are saved.')) return;
  if (ask && !ses.results.length && ses.caseState && !confirm('End this case?')) return;
  const done = ses;
  ses = null;
  app.onFinish(done);
}

// ---------- one case ----------
function nextCase() {
  if (ses.results.length >= ses.target) return exitSizing(false);
  const c = ses.picker.next();
  ses.caseState = { c, inputs: {}, userVals: {}, verdicts: {}, stage: -1, started: performance.now() };
  $('#sz-tag').textContent = `Market sizing · ${c.region.label}`;
  $('#sz-question').textContent = c.question;
  $('#sz-facts-list').replaceChildren(...c.facts.map((f) => h('li', {}, f)));
  $('#sz-facts').hidden = true;
  $('#sz-facts-btn').textContent = 'Key facts';
  $('#sz-facts-btn').setAttribute('aria-expanded', 'false');
  $('#sz-log').replaceChildren();
  renderTop();
  clarifyBeat();
  $('#sz-scroll').scrollTo(0, 0);
}

function renderTop() {
  const n = ses.results.length + (ses.caseState && !ses.caseState.done ? 1 : 0);
  $('#sz-counter').textContent = `Case ${Math.min(Math.max(n, 1), ses.target)} / ${ses.target}`;
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

function showContinue(label, onContinue) {
  $('#sz-input').hidden = true;
  $('#sz-continue-wrap').hidden = false;
  $('#sz-continue').textContent = label;
  ses.onContinue = onContinue;
  ses.inputMode = false;
}

function clarifyBeat() {
  const { c } = ses.caseState;
  const el = card('1 · Clarify', h('p', { class: 'muted' }, 'Market sizing questions are ambiguous. What would you ask the interviewer before you start?'));
  showContinue('Reveal clarifying questions', () => {
    el.append(
      h('ul', { class: 'sz-list' }, c.clarify.questions.map((q) => h('li', {}, `“${q}”`))),
      h('p', { class: 'sz-interviewer' }, h('strong', {}, 'Interviewer: '), c.clarify.answer)
    );
    showContinue('Next: plan your approach', planBeat);
  });
}

function planBeat() {
  const { c } = ses.caseState;
  const el = card('2 · Plan your approach', h('p', { class: 'muted' }, 'Before calculating, how would you break this down? Say the steps out loud.'));
  showContinue('Reveal approach', () => {
    el.append(h('ol', { class: 'sz-list' }, c.steps.map((s) => h('li', {}, s.plan))));
    showContinue('Start estimating', () => {
      card('3 · Estimate', h('p', { class: 'muted' }, 'One stage at a time. Facts can be wrong; assumptions are never wrong, you just see mine; calculations are checked against your own numbers.'));
      nextStage();
    });
  });
}

function nextStage() {
  const cs = ses.caseState;
  cs.stage++;
  if (cs.stage >= cs.c.steps.length) return senseBeat();
  const step = cs.c.steps[cs.stage];
  ses.input = '';
  ses.inputMode = true;
  $('#sz-continue-wrap').hidden = true;
  $('#sz-input').hidden = false;
  $('#sz-context').textContent = `${cs.c.name} · ${cs.c.region.label}`;
  $('#sz-ask').textContent = step.ask;
  const unitText = step.unit === '%' ? '%' : step.money ? '' : step.unit;
  $('#sz-answer-unit').textContent = unitText;
  $('#sz-hint').textContent =
    step.kind === 'fact' ? 'A fact: within ±20% counts.' : step.kind === 'assume' ? "Your assumption: there's no wrong answer." : 'Calculate it from your numbers above.';
  for (const k of $$('#sz-keypad [data-key="K"], #sz-keypad [data-key="M"], #sz-keypad [data-key="B"]')) k.disabled = step.unit === '%';
  renderInput();
}

function renderInput() {
  const step = ses.caseState.c.steps[ses.caseState.stage];
  const cur = step.money ? ses.caseState.c.region.cur : '';
  $('#sz-answer-text').textContent = ses.input ? cur + formatInput(ses.input) : '';
  $('#sz-answer').classList.toggle('empty', ses.input === '');
}

function press(key) {
  if (!ses?.inputMode) return;
  const step = ses.caseState.c.steps[ses.caseState.stage];
  ses.input = editNumber(ses.input, key, { allowSuffix: step.unit !== '%' });
  renderInput();
}

function checkStage(reveal = false) {
  if (!ses?.inputMode) return;
  const cs = ses.caseState;
  const step = cs.c.steps[cs.stage];
  const cur = cs.c.region.cur;
  const mine = cs.c.ref[step.key];
  // what your own numbers give for a calculation stage
  const expected = step.kind === 'calc' ? step.f(cs.userVals) : null;
  let given;
  if (reveal) given = step.kind === 'calc' ? expected : mine;
  else {
    given = parseAnswer(ses.input);
    if (!Number.isFinite(given) || given <= 0) {
      const box = $('#sz-answer');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      return;
    }
  }
  const fmt = (x) => fmtStage(step, x, cur);
  let verdict;
  let message;
  if (reveal) {
    verdict = 'revealed';
    message = step.kind === 'calc' ? `With your numbers: ${step.formula(cs.userVals)} = ${fmt(expected)}.` : `I'd go with ${fmt(mine)}. ${step.note}`;
  } else if (step.kind === 'fact') {
    verdict = within(given, mine, SIZING_TOLERANCE) ? 'good' : 'bad';
    message = verdict === 'good' ? `Right. ${step.note}` : `Not quite. ${step.note}`;
  } else if (step.kind === 'assume') {
    verdict = 'neutral';
    const ratio = given / mine;
    const flag =
      ratio >= 2 ? ' Yours is quite a bit higher, which is fine if you can justify it.' : ratio <= 0.5 ? ' Yours is quite a bit lower, which is fine if you can justify it.' : '';
    message = `I'd have gone with ${fmt(mine)}. ${step.note}${flag}`;
  } else {
    verdict = within(given, expected, CALC_TOLERANCE) ? 'good' : 'bad';
    message =
      verdict === 'good'
        ? `Correct: ${step.formula(cs.userVals)} = ${fmt(expected)}.`
        : `With your numbers: ${step.formula(cs.userVals)} = ${fmt(expected)}. I'll carry on with that.`;
  }
  // facts and assumptions use what you said; calculations continue with the right maths on your numbers
  cs.inputs[step.key] = given;
  cs.userVals[step.key] = step.kind === 'calc' ? expected : given;
  cs.verdicts[step.key] = { verdict, given };
  if (step.kind === 'calc' && step === cs.c.finalStep) cs.finalGiven = given;

  const badge = { good: '✓', bad: '✗', neutral: '≈', revealed: '–' }[verdict];
  $('#sz-log').lastElementChild.append(
    h(
      'div',
      { class: `sz-stage ${verdict}` },
      h('div', { class: 'sz-stage-q' }, step.ask),
      h('div', { class: 'sz-stage-a' }, h('span', { class: 'sz-badge', 'aria-hidden': 'true' }, badge), reveal ? 'Revealed' : `You: ${fmt(given)}`),
      h('div', { class: 'sz-stage-note' }, message)
    )
  );
  scrollTo($('#sz-log').lastElementChild.lastElementChild, 'end');
  const last = cs.stage === cs.c.steps.length - 1;
  showContinue(last ? 'Next: sense check' : 'Next stage', nextStage);
}

function senseBeat() {
  const cs = ses.caseState;
  const el = card('4 · Sense check', h('p', { class: 'muted' }, 'Does your answer make sense? Try a per-person or per-household check.'));
  showContinue('Reveal sense check', () => {
    el.append(h('p', {}, cs.c.sense(cs.c.ref)));
    resultBeat();
  });
}

function resultBeat() {
  const cs = ses.caseState;
  const { c } = cs;
  const cur = c.region.cur;
  const final = c.finalStep;
  const yours = cs.finalGiven ?? cs.userVals[final.key];
  const ok = within(yours, c.answer, SIZING_TOLERANCE);
  const factSteps = c.steps.filter((s) => s.kind === 'fact');
  const factsRight = factSteps.filter((s) => cs.verdicts[s.key]?.verdict === 'good').length;
  const ratio = yours / c.answer;
  const verdictText = ok
    ? 'Within ±20% of my estimate ✓'
    : ratio <= 2 && ratio >= 0.5
      ? 'Right ballpark (within 2×) but outside ±20%'
      : `Outside ±20%: yours is ${timesText(ratio > 1 ? ratio : 1 / ratio)} ${ratio > 1 ? 'higher' : 'lower'}`;

  const rows = c.steps.map((s) =>
    h(
      'tr',
      { class: cs.verdicts[s.key]?.verdict || '' },
      h('td', {}, s.plan),
      h('td', {}, fmtStage(s, cs.inputs[s.key], cur)),
      h('td', {}, fmtStage(s, c.ref[s.key], cur))
    )
  );
  const resultCard = card(
    'Result',
    h('div', { class: `sz-result ${ok ? 'good' : 'bad'}` }, verdictText),
    h('div', { class: 'sz-final' }, h('div', {}, h('span', { class: 'muted small' }, 'You'), h('strong', {}, fmtStage(final, yours, cur))), h('div', {}, h('span', { class: 'muted small' }, 'Me'), h('strong', {}, fmtStage(final, c.answer, cur)))),
    h('p', { class: 'muted small' }, `Facts right: ${factsRight} of ${factSteps.length}`),
    h('table', { class: 'sz-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Step'), h('th', {}, 'You'), h('th', {}, 'Me'))), h('tbody', {}, rows))
  );

  scrollTo(resultCard, 'start');
  cs.done = true;
  const attempt = {
    ts: Date.now(),
    sessionId: ses.id,
    mode: 'sizing',
    templateId: c.templateId,
    difficulty: 1,
    correct: ok,
    skipped: false,
    timeMs: Math.round(Math.min(performance.now() - cs.started, 3600000)),
    prompt: c.question,
    answer: c.answer,
    kind: 'number',
    given: yours,
    fingerprint: c.fingerprint,
    tolerance: 20,
    factsRight,
    factsTotal: factSteps.length,
  };
  ses.results.push({ attempt, c, yours });
  app.saveAttempt(attempt);
  renderTop();
  const more = ses.results.length < ses.target;
  showContinue(more ? 'Next case' : 'See summary', more ? nextCase : () => exitSizing(false));
}

function onKey(e) {
  if (!ses || document.body.dataset.view !== 'sizing' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (!ses.inputMode) {
    if (k === 'Enter') {
      e.preventDefault();
      ses.onContinue?.();
    }
    return;
  }
  if (/^[0-9]$/.test(k)) press(k);
  else if (k === '.' || k === ',') press('.');
  else if (/^[kmb]$/i.test(k)) press(k.toUpperCase());
  else if (k === 'Backspace') press('back');
  else if (k === 'Enter') checkStage(false);
  else if (k === 'Escape') exitSizing();
  else return;
  e.preventDefault();
}
