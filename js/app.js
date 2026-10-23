// Main app: screens, drill sessions, progress, settings, backup.

import { db } from './db.js';
import { ProblemEngine, SEEN_WINDOW } from './engine.js';
import { MODES, TEMPLATE_BY_ID } from './generators.js';
import { parseAnswer, checkAnswer, displayAnswer, fmtValue, withCommas } from './format.js';
import * as stats from './stats.js';
import { lineChart } from './chart.js';

const APP_VERSION = '1.2.0';

const DEFAULTS = {
  tolerance: 2, // 0 = exact, 2 = ±2%, 5 = ±5%
  context: 'some', // consulting word problems: off | some | often
  theme: 'system',
  goalType: 'problems',
  goalTarget: 150,
  difficulty: 2,
  sessionType: 'count',
  sessionValue: 20,
  mode: 'mixed',
  notes: true, // notes field above the answer
  lastExport: null,
};

const ALLOWED = {
  tolerance: [0, 2, 5],
  context: ['off', 'some', 'often'],
  theme: ['system', 'light', 'dark'],
  goalType: ['problems', 'sessions'],
  difficulty: [1, 2, 3],
  sessionType: ['count', 'time'],
  mode: ['mult', 'pct', 'growth', 'div', 'mixed', 'review'],
  notes: [true, false],
};

const MODE_HELP = {
  mixed: 'All four modes, shuffled.',
  mult: 'e.g. 47 × 36 · 4,500 × 30 · 2.5M × 4,000',
  pct: 'e.g. 18% of 2.4M · % change · reverse %',
  growth: 'e.g. 8% for 3 years · CAGR · rule of 72',
  div: 'e.g. 4.2M ÷ 350 · how many times · payback',
};

const DIFF_HELP = {
  1: 'Warm-up: round numbers, friendly percentages.',
  2: 'Interview level. Jot values in Notes.',
  3: 'Harder than interviews, for speed training.',
};

const GOAL_PRESETS = { problems: [50, 100, 150, 250, 500], sessions: [3, 5, 7, 10, 14] };
const DIFF_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const MODE_NAMES = { ...Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.name])), mixed: 'Mixed', review: 'Review mistakes' };
const UNIT_SUFFIX = { percent: '%', years: ' yrs', times: '×', number: '' };

const state = {
  settings: { ...DEFAULTS },
  attempts: [],
  rotation: null,
  engine: null,
  session: null,
  current: null,
  view: 'home',
  progressMode: 'all',
  calMonth: null,
  storageOk: true,
  pendingUpdate: null,
};

// ---------- small DOM helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Builds elements with textContent only (never innerHTML), so data from an
// imported file can't inject code into the page.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const secs = (x) => (x == null ? '–' : `${x < 10 ? x.toFixed(1) : Math.round(x)} s`);

// ---------- start-up ----------
async function init() {
  bindStatic();
  try {
    const saved = await db.getKV('settings');
    state.settings = { ...DEFAULTS, ...sanitizeSettings(saved) };
    state.attempts = await db.allAttempts();
    state.rotation = (await db.getKV('rotation')) || null;
  } catch (err) {
    console.error(err);
    state.storageOk = false;
    toast("Storage isn't available, so progress won't be saved (private browsing?).");
  }
  applyTheme();
  rebuildEngine();
  history.replaceState({ view: 'home' }, '');
  showView('home', { push: false });
  registerServiceWorker();
  requestPersistentStorage();
}

function rebuildEngine() {
  state.engine = new ProblemEngine({
    recentFingerprints: state.attempts.slice(-SEEN_WINDOW).map((a) => a.fingerprint),
    rotation: state.rotation,
    context: state.settings.context,
  });
}

function saveSettings() {
  if (state.storageOk) db.setKV('settings', state.settings).catch(() => {});
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported: fine */
  }
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('meta[name="theme-color"]').setAttribute('content', bg || '#f4f5f7');
}

// ---------- navigation ----------
function showView(name, { push = true } = {}) {
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  state.view = name;
  document.body.dataset.view = name;
  for (const t of $$('.tab')) t.setAttribute('aria-current', t.dataset.view === name ? 'page' : 'false');
  if (push && history.state?.view !== name) history.pushState({ view: name }, '');
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderSettings();
  if (name !== 'drill' && state.pendingUpdate) $('#update-banner').hidden = false;
}

// Android back button
window.addEventListener('popstate', (e) => {
  if (state.view === 'drill' && state.session) {
    if (!confirm('End this session? Your answers so far are saved.')) {
      history.pushState({ view: 'drill' }, '');
      return;
    }
    endSession();
    return;
  }
  const target = e.state?.view;
  showView(target && target !== 'drill' && target !== 'summary' ? target : 'home', { push: false });
});

// ---------- static event wiring ----------
function bindStatic() {
  for (const t of $$('.tab')) t.addEventListener('click', () => showView(t.dataset.view));

  bindChoice('#mode-seg', (v) => {
    state.settings.mode = v;
    saveSettings();
    renderHome();
  });
  bindChoice('#difficulty-seg', (v) => {
    state.settings.difficulty = Number(v);
    saveSettings();
    renderHome();
  });
  bindChoice('#session-seg', (v) => {
    const [type, value] = v.split(':');
    state.settings.sessionType = type;
    state.settings.sessionValue = Number(value);
    saveSettings();
    renderHome();
  });
  $('#start-btn').addEventListener('click', () => startSession(state.settings.mode));

  // drill
  for (const k of $$('#keypad button')) k.addEventListener('click', () => press(k.dataset.key));
  $('#check-btn').addEventListener('click', () => submit(false));
  $('#skip-btn').addEventListener('click', () => submit(true));
  $('#next-btn').addEventListener('click', nextProblem);
  $('#drill-exit').addEventListener('click', exitDrill);
  $('#notes-field').addEventListener('click', () => setTarget('notes'));
  $('#answer-box').addEventListener('click', () => setTarget('answer'));
  $('#notes-clear').addEventListener('click', () => {
    if (!state.current || state.current.answered) return;
    state.current.notes = '';
    renderNotes();
    setTarget('notes');
  });
  document.addEventListener('keydown', onKey);

  // summary
  $('#done-btn').addEventListener('click', () => showView('home'));

  $('#update-btn').addEventListener('click', () => state.pendingUpdate?.());
  $('#import-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importFile(file);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

function bindChoice(sel, onPick) {
  for (const b of $$(`${sel} button`)) b.addEventListener('click', () => onPick(b.dataset.value));
}

function markChoice(sel, value) {
  for (const b of $$(`${sel} button`)) b.setAttribute('aria-checked', String(b.dataset.value === String(value)));
}

// ---------- Practice screen ----------
function renderHome() {
  const s = state.settings;
  const st = stats.streaks(state.attempts);
  $('#home-streak-count').textContent = st.current;
  $('#home-streak').title = st.practicedToday ? `${st.current}-day streak, practised today` : `${st.current}-day streak`;
  const goal = stats.goalProgress({ type: s.goalType, target: s.goalTarget }, state.attempts);
  $('#home-goal-text').textContent = `${goal.done} / ${goal.target} ${goal.unit}`;
  $('#home-goal-bar').style.width = `${goal.fraction * 100}%`;
  $('#home-goal-bar').parentElement.classList.toggle('done', goal.fraction >= 1);
  $('#home-goal-label').textContent = goal.fraction >= 1 ? 'Weekly goal reached ✓' : 'Weekly goal';

  const mistakes = stats.mistakeTypes(state.attempts);
  $('#mode-seg [data-value="review"]').disabled = mistakes.length === 0;
  if (s.mode === 'review' && !mistakes.length) s.mode = 'mixed';
  markChoice('#mode-seg', s.mode);
  $('#mode-help').textContent =
    s.mode === 'review'
      ? `Your ${mistakes.length} most-missed problem type${mistakes.length > 1 ? 's' : ''}, new numbers.`
      : MODE_HELP[s.mode];
  markChoice('#difficulty-seg', s.difficulty);
  $('#difficulty-help').textContent = s.mode === 'review' ? 'Review uses the level of each problem you missed.' : DIFF_HELP[s.difficulty];
  markChoice('#session-seg', `${s.sessionType}:${s.sessionValue}`);
  $('#session-help').textContent =
    s.sessionType === 'count' ? `${s.sessionValue} problems.` : `Timed: as many as you can in ${s.sessionValue} minutes.`;
  // review mode uses the difficulty of each missed problem type
  $('#difficulty-seg').style.opacity = s.mode === 'review' ? '0.5' : '';
  $('#start-btn').textContent = 'Start';
}

// ---------- Sessions ----------
function startSession(mode, poolOverride = null) {
  const s = state.settings;
  let spec;
  if (mode === 'review') {
    const pool = poolOverride || stats.mistakeTypes(state.attempts).map((m) => ({ templateId: m.templateId, difficulty: m.difficulty, weight: m.weight }));
    if (!pool.length) {
      toast('No mistakes to review yet. Nice!');
      return;
    }
    spec = { pool };
  } else {
    spec = { mode, difficulty: s.difficulty };
  }
  state.engine.context = s.context;
  state.session = {
    id: uid(),
    mode,
    spec,
    difficulty: mode === 'review' ? null : s.difficulty,
    type: s.sessionType,
    target: s.sessionValue,
    startedAt: Date.now(),
    endsAt: s.sessionType === 'time' ? Date.now() + s.sessionValue * 60000 : null,
    results: [],
    timer: null,
  };
  $('#update-banner').hidden = true;
  $('#notes').hidden = !s.notes;
  $('#keypad').classList.toggle('with-notes', s.notes);
  showView('drill');
  if (state.session.endsAt) state.session.timer = setInterval(tick, 250);
  nextProblem();
}

function tick() {
  const ses = state.session;
  if (!ses) return;
  if (Date.now() >= ses.endsAt) endSession();
  else renderDrillTop();
}

function sessionFinished(ses) {
  if (ses.type === 'count') return ses.results.length >= ses.target;
  return Date.now() >= ses.endsAt;
}

function nextProblem() {
  const ses = state.session;
  if (!ses) return;
  if (sessionFinished(ses)) {
    endSession();
    return;
  }
  const problem = state.engine.next(ses.spec);
  // target: which field the keypad types into ('answer' or 'notes')
  state.current = { problem, input: '', notes: '', target: 'answer', shownAt: performance.now(), answered: false };
  renderProblem();
}

function exitDrill() {
  const ses = state.session;
  if (!ses) return showView('home');
  if (ses.results.length === 0 || confirm('End this session? Your answers so far are saved.')) endSession();
}

function endSession() {
  const ses = state.session;
  if (!ses) return;
  clearInterval(ses.timer);
  state.session = null;
  state.current = null;
  state.rotation = state.engine.rotationState();
  if (state.storageOk) db.setKV('rotation', state.rotation).catch(() => {});
  if (!ses.results.length) {
    showView('home');
    return;
  }
  renderSummary(ses);
  showView('summary');
}

// ---------- Drill screen ----------
function renderDrillTop() {
  const ses = state.session;
  if (!ses) return;
  const done = ses.results.length;
  const correct = ses.results.filter((r) => r.attempt.correct).length;
  let fraction;
  if (ses.type === 'count') {
    const shown = state.current && !state.current.answered ? done + 1 : done;
    $('#drill-counter').textContent = `${Math.min(shown, ses.target)} / ${ses.target}`;
    fraction = done / ses.target;
  } else {
    const left = Math.max(0, ses.endsAt - Date.now());
    const m = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    $('#drill-counter').textContent = `${m}:${String(sec).padStart(2, '0')} left · ${done} done`;
    fraction = 1 - left / (ses.target * 60000);
  }
  $('#drill-bar').style.width = `${Math.min(1, fraction) * 100}%`;
  $('#drill-score').textContent = `${correct} ✓`;
}

function renderProblem() {
  const p = state.current.problem;
  const tag = `${MODES[p.mode].name} · ${DIFF_NAMES[p.difficulty]}`;
  $('#p-tag').textContent = state.session.mode === 'review' ? `Review · ${tag}` : tag;
  const text = $('#p-text');
  text.textContent = p.prompt;
  text.classList.toggle('long', p.prompt.length > 110);
  $('#p-hint').textContent = p.hint;
  $('#answer-unit').textContent = UNIT_SUFFIX[p.kind] || '';
  $('#answer-box').className = 'answer-box';
  $('#feedback').hidden = true;
  $('#keypad').hidden = false;
  $('#answer-actions').hidden = false;
  $('#next-actions').hidden = true;
  $('#p-hint').hidden = false;
  renderAnswer();
  renderNotes();
  renderTarget();
  renderDrillTop();
}

// ---------- Notes field ----------
// A place to jot working values ("240K + 19K") with the keypad. It never
// calculates anything, so the maths stays in your head.

function setTarget(target) {
  const cur = state.current;
  if (!cur || cur.answered || (target === 'notes' && !state.settings.notes)) return;
  cur.target = target;
  renderTarget();
}

function renderTarget() {
  const cur = state.current;
  if (!cur) return;
  const open = !cur.answered;
  const inNotes = open && state.settings.notes && cur.target === 'notes';
  $('#notes').classList.toggle('active', inNotes);
  $('#answer-box').classList.toggle('active', open && !inNotes);
  const key = $('#target-key');
  key.textContent = inNotes ? 'Answer' : 'Notes';
  key.setAttribute('aria-pressed', String(inNotes));
  key.setAttribute('aria-label', inNotes ? 'Switch to typing the answer' : 'Switch to typing notes');
  for (const k of $$('#keypad [data-key="+"], #keypad [data-key="-"], #keypad [data-key=" "]')) k.disabled = !inNotes;
  for (const k of $$('#keypad [data-key="K"], #keypad [data-key="M"], #keypad [data-key="B"]')) k.disabled = !inNotes && cur.problem.kind !== 'number';
  $('#keypad [data-key="neg"]').disabled = inNotes || !cur.problem.signed;
  $('#notes-clear').hidden = !open || cur.notes === '';
}

function formatNotes(s) {
  return s
    .split(/([+\-\s])/)
    .map((t) => (t === '+' ? ' + ' : t === '-' ? ' − ' : t === ' ' ? '  ·  ' : formatInput(t)))
    .join('')
    .trim();
}

function renderNotes() {
  const cur = state.current;
  $('#notes-text').textContent = formatNotes(cur.notes);
  $('#notes-clear').hidden = cur.answered || cur.notes === '';
}

function notesPress(key) {
  const cur = state.current;
  let s = cur.notes;
  const lastToken = s.split(/[+\-\s]/).pop();
  if (key === 'back') s = s.slice(0, -1);
  else if (key === '+' || key === '-') {
    if (/[+\-\s]$/.test(s)) s = s.slice(0, -1);
    if (s || key === '-') s += key;
  } else if (key === ' ') {
    if (s && !/[+\-\s]$/.test(s)) s += ' ';
  } else if ('KMB'.includes(key)) {
    if (/\d$/.test(s)) s += key;
    else if (/[KMB]$/.test(s)) s = s.slice(0, -1) + key;
  } else if (key === '.') {
    if (!lastToken.includes('.') && !/[KMB]$/.test(lastToken)) s += /\d$/.test(s) ? '.' : '0.';
  } else if (/^\d$/.test(key)) {
    if (/[KMB]$/.test(s)) s += ' '; // a new number after "240K"
    else if (lastToken.replace(/\D/g, '').length >= 12) return;
    s += key;
  } else return;
  if (s.length > 80) return;
  cur.notes = s;
  renderNotes();
}

function formatInput(s) {
  const m = /^(-?)(\d*)(\.?\d*)([KMB]?)$/.exec(s);
  if (!m) return s;
  const int = m[2] ? Number(m[2]).toLocaleString('en-US') : m[3] ? '0' : '';
  return (m[1] ? '−' : '') + int + m[3] + m[4];
}

function renderAnswer() {
  const input = state.current.input;
  $('#answer-text').textContent = formatInput(input);
  $('#answer-box').classList.toggle('empty', input === '');
}

function press(key) {
  const cur = state.current;
  if (!cur || cur.answered || state.view !== 'drill') return;
  if (key === 'target') return setTarget(cur.target === 'notes' ? 'answer' : 'notes');
  if (state.settings.notes && cur.target === 'notes') return notesPress(key);
  const kind = cur.problem.kind;
  let s = cur.input;
  if (key === 'back') s = s.slice(0, -1);
  else if (key === 'neg') {
    if (!cur.problem.signed) return;
    s = s.startsWith('-') ? s.slice(1) : '-' + s;
  } else if ('KMB'.includes(key)) {
    if (kind !== 'number') return;
    s = s.replace(/[KMB]$/, '');
    if (/\d/.test(s)) s += key;
  } else if (key === '.') {
    if (!/[.KMB]/.test(s)) s += /\d$/.test(s) ? '.' : '0.';
  } else if (/^\d$/.test(key)) {
    if (/[KMB]$/.test(s) || s.replace(/\D/g, '').length >= 12) return;
    if (s === '0' || s === '-0') s = s.slice(0, -1);
    s += key;
  } else return;
  cur.input = s;
  renderAnswer();
}

function shake() {
  const box = $('#answer-box');
  box.classList.remove('shake');
  void box.offsetWidth;
  box.classList.add('shake');
}

function submit(skip) {
  const cur = state.current;
  if (!cur || cur.answered) return;
  const p = cur.problem;
  let given = null;
  if (!skip) {
    given = parseAnswer(cur.input);
    if (!Number.isFinite(given)) {
      shake();
      return;
    }
  }
  const correct = !skip && checkAnswer(p, given, state.settings.tolerance);
  cur.answered = true;
  const attempt = {
    ts: Date.now(),
    sessionId: state.session.id,
    mode: p.mode,
    templateId: p.templateId,
    difficulty: p.difficulty,
    correct,
    skipped: skip,
    timeMs: Math.round(Math.min(performance.now() - cur.shownAt, 600000)),
    prompt: p.prompt,
    answer: p.answer,
    kind: p.kind,
    given,
    fingerprint: p.fingerprint,
    tolerance: state.settings.tolerance,
  };
  state.attempts.push(attempt);
  state.session.results.push({ attempt, problem: p });
  if (state.storageOk) db.addAttempt(attempt).catch(() => toast("Couldn't save that answer"));
  if (!correct) {
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
  }
  renderFeedback(attempt, p);
}

function renderFeedback(attempt, p) {
  const head = $('#fb-head');
  head.textContent = attempt.correct ? 'Correct ✓' : attempt.skipped ? 'Skipped' : 'Not quite ✗';
  head.className = `fb-head ${attempt.correct ? 'good' : 'bad'}`;
  $('#fb-correct').textContent = displayAnswer(p);
  $('#fb-yours').textContent = attempt.skipped ? '' : `You said ${fmtValue(attempt.given, p.kind)}`;
  $('#fb-yours').hidden = attempt.skipped;
  $('#fb-explain').textContent = p.explain;
  $('#fb-time').textContent = `${secs(attempt.timeMs / 1000)}`;
  $('#answer-box').classList.add(attempt.correct ? 'correct' : 'wrong');
  $('#feedback').hidden = false;
  $('#keypad').hidden = true;
  $('#p-hint').hidden = true;
  $('#answer-actions').hidden = true;
  $('#next-actions').hidden = false;
  $('#next-btn').textContent = sessionFinished(state.session) ? 'See summary' : 'Next';
  $('#next-btn').focus({ preventScroll: true });
  renderTarget();
  renderDrillTop();
}

function onKey(e) {
  if (state.view !== 'drill' || !state.current) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (state.current.answered) {
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      nextProblem();
    }
    return;
  }
  const inNotes = state.settings.notes && state.current.target === 'notes';
  if (/^[0-9]$/.test(k)) press(k);
  else if (k === '.' || k === ',') press('.');
  else if (/^[kmb]$/i.test(k)) press(k.toUpperCase());
  else if (k === 'Tab' && state.settings.notes) press('target');
  else if (k === '+' && state.settings.notes) {
    setTarget('notes');
    press('+');
  } else if (k === '-') press(inNotes ? '-' : 'neg');
  else if (k === ' ' && inNotes) press(' ');
  else if (k === 'Backspace') press('back');
  else if (k === 'Enter') submit(false);
  else if (k === 'Escape') exitDrill();
  else return;
  e.preventDefault();
}

// ---------- Summary ----------
function renderSummary(ses) {
  const attempts = ses.results.map((r) => r.attempt);
  const sum = stats.summarize(attempts);
  const label = ses.mode === 'review' ? 'Review mistakes' : `${MODE_NAMES[ses.mode]} · ${DIFF_NAMES[ses.difficulty]}`;
  const minutes = Math.max(1, Math.round((Date.now() - ses.startedAt) / 60000));
  $('#summary-title').textContent = sum.accuracy >= 0.9 ? 'Excellent session' : sum.accuracy >= 0.7 ? 'Good session' : 'Session done';
  $('#summary-sub').textContent = `${label} · ${minutes} min`;

  const tiles = $('#summary-tiles');
  tiles.replaceChildren(
    tile(`${sum.correct}/${sum.n}`, 'correct'),
    tile(pct(sum.accuracy), 'accuracy'),
    tile(secs(sum.avgTime), 'avg per problem')
  );

  const modesBox = $('#summary-modes');
  modesBox.replaceChildren();
  const modes = [...new Set(attempts.map((a) => a.mode))];
  if (modes.length > 1) {
    const rows = modes.map((m) => {
      const s = stats.summarize(attempts.filter((a) => a.mode === m));
      return h('div', {}, h('span', {}, MODES[m].name), h('span', {}, `${s.correct}/${s.n} · ${secs(s.avgTime)}`));
    });
    modesBox.append(h('div', { class: 'card mode-rows' }, rows));
  }

  const misses = ses.results.filter((r) => !r.attempt.correct);
  const list = $('#summary-misses');
  list.replaceChildren();
  $('#summary-miss-label').textContent = misses.length ? `To review (${misses.length})` : 'To review';
  if (!misses.length) {
    list.append(h('li', { class: 'empty-note' }, 'No mistakes this session.'));
  }
  for (const { attempt, problem } of misses) {
    list.append(
      h(
        'li',
        {},
        h('div', { class: 'miss-q' }, problem.prompt),
        h('div', { class: 'miss-a' }, `Answer ${displayAnswer(problem)}`, attempt.skipped ? ' · skipped' : ` · you said ${fmtValue(attempt.given, problem.kind)}`),
        h('div', { class: 'miss-x' }, problem.explain)
      )
    );
  }

  $('#again-btn').onclick = () => startSession(ses.mode, ses.mode === 'review' ? ses.spec.pool : null);
  const reviewThese = $('#review-these-btn');
  reviewThese.hidden = misses.length === 0;
  reviewThese.onclick = () => {
    const seen = new Map();
    for (const { problem } of misses) seen.set(`${problem.templateId}|${problem.difficulty}`, { templateId: problem.templateId, difficulty: problem.difficulty, weight: 1 });
    startSession('review', [...seen.values()]);
  };
}

function tile(value, label) {
  return h('div', { class: 'tile' }, h('div', { class: 'value' }, value), h('div', { class: 'label' }, label));
}

// ---------- Progress ----------
function renderProgress() {
  const root = $('#progress-content');
  root.replaceChildren();
  const all = state.attempts;
  if (!all.length) {
    root.append(
      h('div', { class: 'card' }, h('h2', {}, 'No practice yet'), h('p', { class: 'muted' }, 'Finish a few problems and your progress will appear here.'))
    );
    return;
  }
  const s = state.settings;
  const st = stats.streaks(all);
  const goal = stats.goalProgress({ type: s.goalType, target: s.goalTarget }, all);

  // streak + goal
  const bar = h('div', { class: `progress ${goal.fraction >= 1 ? 'done' : ''}` }, h('span', {}));
  bar.firstChild.style.width = `${goal.fraction * 100}%`;
  root.append(
    h(
      'div',
      { class: 'stat-row' },
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Daily streak'), h('div', { class: 'big-number' }, `${st.current} 🔥`), h('div', { class: 'muted small' }, `Best: ${st.best} day${st.best === 1 ? '' : 's'}`)),
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'muted small' }, 'Weekly goal'),
        h('div', { class: 'big-number' }, `${goal.done}`),
        h('div', { class: 'muted small' }, `of ${goal.target} ${goal.unit}`),
        bar
      )
    )
  );

  // backup reminder (local data can be lost)
  const since = s.lastExport ? (Date.now() - s.lastExport) / 86400000 : Infinity;
  if (since > 14 && all.length >= 20) {
    root.append(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Back up your history'),
        h('p', { class: 'muted' }, s.lastExport ? `Last backup ${Math.floor(since)} days ago.` : "You haven't backed up yet."),
        h('p', { class: 'muted small' }, 'Clearing browser data or uninstalling the app deletes your history.'),
        h('button', { type: 'button', class: 'btn primary', onclick: exportData }, 'Export backup')
      )
    );
  }

  // weakest mode
  const weak = stats.weakestMode(all);
  if (weak) {
    root.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'muted small' }, 'Weakest right now'),
        h('h2', {}, MODES[weak.mode].name),
        h('p', { class: 'muted' }, `${weak.reason}.`),
        h('button', { type: 'button', class: 'btn primary', onclick: () => startSession(weak.mode) }, `Practise ${MODES[weak.mode].name}`)
      )
    );
  }

  // review mistakes
  const mistakes = stats.mistakeTypes(all);
  if (mistakes.length) {
    root.append(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Your most-missed problem types'),
        h(
          'ul',
          { class: 'weak-list' },
          mistakes.slice(0, 4).map((m) => h('li', {}, `${TEMPLATE_BY_ID[m.templateId]?.name ?? m.templateId} (${DIFF_NAMES[m.difficulty]}): ${m.wrong} of ${m.total} wrong`))
        ),
        h('button', { type: 'button', class: 'btn primary', onclick: () => startSession('review') }, 'Review my mistakes')
      )
    );
  }

  root.append(weekTable(all));
  root.append(trendCard(all));
  root.append(calendarCard(all));
}

function delta(now, before, { kind, better }) {
  if (now == null || before == null) return h('span', { class: 'delta' }, before == null ? 'no data last wk' : '');
  let diff;
  let text;
  if (kind === 'count') {
    diff = now - before;
    text = `${diff >= 0 ? '+' : '−'}${Math.abs(diff)}`;
  } else if (kind === 'acc') {
    diff = Math.round((now - before) * 100);
    text = `${diff >= 0 ? '+' : '−'}${Math.abs(diff)} pts`;
  } else {
    diff = now - before;
    text = `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} s`;
  }
  if (Math.abs(diff) < 1e-9 || (kind === 'time' && Math.abs(diff) < 0.05)) return h('span', { class: 'delta' }, 'same');
  const good = better === 'up' ? diff > 0 : diff < 0;
  // arrow = direction of change, colour = good or bad (faster times are good)
  return h('span', { class: `delta ${good ? 'up' : 'down'}` }, `${diff > 0 ? '▲' : '▼'} ${text}`);
}

function weekTable(all) {
  const wc = stats.weekComparison(all);
  const rows = ['all', ...stats.MODE_IDS].map((m) => {
    const a = wc.thisWeek[m];
    const b = wc.lastWeek[m];
    return h(
      'tr',
      {},
      h('td', {}, m === 'all' ? h('strong', {}, 'All') : MODES[m].name),
      h('td', {}, h('span', { class: 'now' }, a.n), delta(a.n, b.n, { kind: 'count', better: 'up' })),
      h('td', {}, h('span', { class: 'now' }, pct(a.accuracy)), delta(a.accuracy, b.accuracy, { kind: 'acc', better: 'up' })),
      h('td', {}, h('span', { class: 'now' }, secs(a.avgTime)), delta(a.avgTime, b.avgTime, { kind: 'time', better: 'down' }))
    );
  });
  return h(
    'div',
    { class: 'card' },
    h('h2', {}, 'This week vs last week'),
    h('p', { class: 'muted small' }, `${wc.sessionsThisWeek} session${wc.sessionsThisWeek === 1 ? '' : 's'} this week, ${wc.sessionsLastWeek} last week`),
    h(
      'table',
      { class: 'cmp-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Mode'), h('th', {}, 'Problems'), h('th', {}, 'Accuracy'), h('th', {}, 'Avg time'))),
      h('tbody', {}, rows)
    )
  );
}

function weekLabel(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function trendCard(all) {
  const card = h('div', { class: 'card' }, h('h2', {}, 'Last 8 weeks'));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Mode' });
  for (const m of ['all', ...stats.MODE_IDS]) {
    chips.append(
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(state.progressMode === m),
          onclick: () => {
            state.progressMode = m;
            renderProgress();
          },
        },
        m === 'all' ? 'All' : MODES[m].name
      )
    );
  }
  card.append(chips);

  const series = stats.weeklySeries(all, state.progressMode, 8);
  const label = (p) => (p.start === series[series.length - 1].start ? 'This wk' : weekLabel(p.start));
  const accPoints = series.map((p) => ({ label: label(p), value: p.accuracy == null ? null : p.accuracy * 100, src: p }));
  const timePoints = series.map((p) => ({ label: label(p), value: p.avgTime, src: p }));
  const when = (p) => (p.label === 'This wk' ? 'This week' : `Week of ${p.label}`);
  card.append(
    lineChart({
      title: 'Accuracy',
      points: accPoints,
      yMin: 0,
      yMax: 100,
      format: (v) => `${Math.round(v)}%`,
      describe: (p) => (p.value == null ? `${when(p)}: no practice` : `${when(p)}: ${Math.round(p.value)}% of ${p.src.n} problems`),
    }),
    lineChart({
      title: 'Average time per problem',
      points: timePoints,
      yMin: 0,
      format: (v) => `${Math.round(v)}s`,
      describe: (p) => (p.value == null ? `${when(p)}: no practice` : `${when(p)}: ${secs(p.value)} per problem`),
    })
  );

  // the same numbers as a table
  card.append(
    h(
      'details',
      { class: 'table-view' },
      h('summary', {}, 'Show as table'),
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Week'), h('th', {}, 'Problems'), h('th', {}, 'Accuracy'), h('th', {}, 'Avg time'))),
        h(
          'tbody',
          {},
          series.map((p) => h('tr', {}, h('td', {}, weekLabel(p.start)), h('td', {}, p.n), h('td', {}, pct(p.accuracy)), h('td', {}, secs(p.avgTime))))
        )
      )
    )
  );
  return card;
}

function calendarCard(all) {
  const counts = stats.dayCounts(all);
  const now = new Date();
  if (!state.calMonth) state.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = state.calMonth;
  const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const shift = (n) => {
    state.calMonth = new Date(month.getFullYear(), month.getMonth() + n, 1);
    renderProgress();
  };
  const practisedDays = [...counts.keys()].filter((k) => k.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`)).length;

  const grid = h('div', { class: 'cal-grid' });
  for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) grid.append(h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, d));
  const offset = (month.getDay() + 6) % 7;
  for (let i = 0; i < offset; i++) grid.append(h('div', {}));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const todayKey = stats.dayKey(Date.now());
  for (let d = 1; d <= days; d++) {
    const date = new Date(month.getFullYear(), month.getMonth(), d);
    const key = stats.dayKey(date.getTime());
    const n = counts.get(key) || 0;
    const level = n === 0 ? '' : n < 10 ? 'l1' : n < 30 ? 'l2' : 'l3';
    const cls = ['cal-day', level, key === todayKey ? 'today' : '', date > now ? 'future' : ''].filter(Boolean).join(' ');
    const label = `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}: ${n ? `${n} problems` : 'no practice'}`;
    grid.append(h('div', { class: cls, title: label, 'aria-label': label }, d));
  }

  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'cal-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h(
        'div',
        {},
        h('h2', {}, month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
        h('div', { class: 'muted small' }, `${practisedDays} day${practisedDays === 1 ? '' : 's'} practised`)
      ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', disabled: isCurrent, onclick: () => shift(1) }, '›')
    ),
    grid,
    h(
      'div',
      { class: 'cal-legend' },
      'Fewer',
      h('span', { class: 'sw' }),
      h('span', { class: 'sw l1' }),
      h('span', { class: 'sw l2' }),
      h('span', { class: 'sw l3' }),
      'More'
    )
  );
}

// ---------- Settings ----------
function choiceRow(label, options, current, onPick, help) {
  const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  for (const [value, text] of options) {
    seg.append(
      h(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': String(value === current), onclick: () => onPick(value) },
        text
      )
    );
  }
  return h('div', { class: 'setting' }, h('div', { class: 'setting-label' }, label), seg, help ? h('div', { class: 'setting-help' }, help) : null);
}

async function renderSettings() {
  const s = state.settings;
  const root = $('#settings-content');
  const set = (key, value) => {
    s[key] = value;
    if (key === 'context') state.engine.context = value;
    if (key === 'theme') applyTheme();
    if (key === 'goalType') s.goalTarget = value === 'sessions' ? 5 : 150;
    saveSettings();
    renderSettings();
  };

  const practice = h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Practice'),
    choiceRow('Answer tolerance', [[0, 'Exact'], [2, '±2%'], [5, '±5%']], s.tolerance, (v) => set('tolerance', v),
      'Exact needs the precise value for clean problems and 3 significant figures for messy ones.'),
    choiceRow('Consulting word problems', [['off', 'Off'], ['some', 'Some'], ['often', 'Often']], s.context, (v) => set('context', v),
      'Wraps problems in a short business story, e.g. stores × units sold.'),
    choiceRow('Notes field', [[true, 'On'], [false, 'Off']], s.notes, (v) => set('notes', v),
      'A line above the answer to jot working values with the keypad (+, −, space). It never calculates. Clears for each problem.'),
    choiceRow('Theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => set('theme', v))
  );

  const goal = h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Weekly goal'),
    choiceRow('Count', [['problems', 'Problems'], ['sessions', 'Sessions']], s.goalType, (v) => set('goalType', v)),
    choiceRow('Target per week', GOAL_PRESETS[s.goalType].map((n) => [n, String(n)]), s.goalTarget, (v) => set('goalTarget', v))
  );

  let persisted = null;
  try {
    persisted = await navigator.storage?.persisted?.();
  } catch {
    /* ignore */
  }
  const data = h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Your data'),
    h('p', { class: 'muted' }, `${withCommas(state.attempts.length, 0)} problems stored on this device only. Nothing is sent anywhere.`),
    h('p', { class: 'muted small' }, s.lastExport ? `Last backup: ${new Date(s.lastExport).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No backup yet.'),
    persisted === false ? h('p', { class: 'small warn' }, 'Your browser may clear this data if the phone runs low on space, so export a backup now and then.') : null,
    !state.storageOk ? h('p', { class: 'small warn' }, "Storage isn't available, so nothing is being saved.") : null,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn primary', onclick: exportData, disabled: state.attempts.length === 0 }, 'Export'),
      h('button', { type: 'button', class: 'btn', onclick: () => $('#import-input').click() }, 'Import')
    ),
    h('div', { class: 'setting-help' }, 'Export saves a .json file to Downloads. Keep a copy in Google Drive or email it to yourself. Import merges a backup into this device.'),
    h('button', { type: 'button', class: 'btn danger', onclick: deleteAll }, 'Delete all data')
  );

  const about = h('div', { class: 'card' }, h('h2', {}, 'About'), h('p', { class: 'muted small' }, `Mental Math Drills v${APP_VERSION}. Works offline. Problems are generated fresh every time and never repeat within your last ${withCommas(SEEN_WINDOW, 0)}.`));

  root.replaceChildren(practice, goal, data, about);
}

// ---------- Backup ----------
function exportData() {
  const payload = {
    app: 'mental-math-drills',
    format: 1,
    exportedAt: new Date().toISOString(),
    attempts: state.attempts.map(({ id, ...rest }) => rest),
    settings: state.settings,
  };
  const name = `mental-math-backup-${stats.dayKey(Date.now())}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  state.settings.lastExport = Date.now();
  saveSettings();
  toast(`Saved ${name} to Downloads`);
  if (state.view === 'settings') renderSettings();
  if (state.view === 'progress') renderProgress();
}

function sanitizeSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, allowed] of Object.entries(ALLOWED)) if (allowed.includes(raw[key])) out[key] = raw[key];
  if (Number.isInteger(raw.goalTarget) && raw.goalTarget > 0 && raw.goalTarget <= 5000) out.goalTarget = raw.goalTarget;
  if (Number.isInteger(raw.sessionValue) && [2, 5, 10, 20, 50].includes(raw.sessionValue)) out.sessionValue = raw.sessionValue;
  if (Number.isFinite(raw.lastExport)) out.lastExport = raw.lastExport;
  return out;
}

function sanitizeAttempt(a) {
  if (!a || typeof a !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (num(a.ts) == null || !MODES[a.mode] || ![1, 2, 3].includes(a.difficulty)) return null;
  return {
    ts: a.ts,
    sessionId: str(a.sessionId, 64),
    mode: a.mode,
    templateId: str(a.templateId, 64),
    difficulty: a.difficulty,
    correct: a.correct === true,
    skipped: a.skipped === true,
    timeMs: Math.max(0, Math.min(num(a.timeMs) ?? 0, 600000)),
    prompt: str(a.prompt, 400),
    answer: num(a.answer) ?? 0,
    kind: ['number', 'percent', 'years', 'times'].includes(a.kind) ? a.kind : 'number',
    given: num(a.given),
    fingerprint: str(a.fingerprint, 200),
    tolerance: [0, 2, 5].includes(a.tolerance) ? a.tolerance : 2,
  };
}

async function importFile(file) {
  if (file.size > 50e6) return toast('That file is too large to be a backup');
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast("That file isn't a valid backup");
  }
  if (!data || data.app !== 'mental-math-drills' || !Array.isArray(data.attempts)) return toast("That file isn't a Mental Math backup");
  const incoming = data.attempts.map(sanitizeAttempt).filter(Boolean);
  const have = new Set(state.attempts.map((a) => `${a.ts}|${a.fingerprint}`));
  const fresh = incoming.filter((a) => !have.has(`${a.ts}|${a.fingerprint}`));
  if (!fresh.length) return toast('Everything in that backup is already on this device');
  if (!confirm(`Import ${fresh.length} problems from this backup? (${incoming.length - fresh.length} are already here.)`)) return;
  try {
    const wasEmpty = state.attempts.length === 0;
    await db.addAttempts(fresh);
    if (wasEmpty && data.settings) {
      state.settings = { ...DEFAULTS, ...sanitizeSettings(data.settings), lastExport: state.settings.lastExport };
      saveSettings();
      applyTheme();
    }
    state.attempts = await db.allAttempts();
    rebuildEngine();
    toast(`Imported ${fresh.length} problems`);
    renderSettings();
  } catch (err) {
    console.error(err);
    toast('Import failed, nothing was changed');
  }
}

async function deleteAll() {
  if (!confirm('Delete ALL your practice history and settings from this device? This cannot be undone.')) return;
  if (!confirm('Are you sure? Export a backup first if you might want it later.')) return;
  try {
    await db.clearAll();
  } catch {
    return toast('Could not delete data');
  }
  state.attempts = [];
  state.settings = { ...DEFAULTS };
  state.rotation = null;
  rebuildEngine();
  applyTheme();
  toast('All data deleted');
  renderSettings();
}

// ---------- Offline support + updates ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloadOnChange = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnChange) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const offer = (worker) => {
        state.pendingUpdate = () => {
          reloadOnChange = true;
          worker.postMessage('skipWaiting');
        };
        if (state.view !== 'drill') $('#update-banner').hidden = false;
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Service worker not registered', err));
}

init();
