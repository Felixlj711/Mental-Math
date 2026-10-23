// Progress statistics. Pure functions over the list of attempts,
// so they can be tested without a browser. Weeks start on Monday.

import { MODES } from './generators.js';

export const MODE_IDS = Object.keys(MODES);
const DAY = 86400000;
// Times above this are treated as "left the app" and capped in averages.
const TIME_CAP_MS = 120000;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar-safe (handles daylight saving changes)
export function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfWeek(ts) {
  const d = new Date(startOfDay(ts));
  const mondayOffset = (d.getDay() + 6) % 7;
  return addDays(d.getTime(), -mondayOffset);
}

export function summarize(list) {
  const n = list.length;
  let correct = 0;
  let timeSum = 0;
  let timed = 0;
  for (const a of list) {
    if (a.correct) correct++;
    if (!a.skipped) {
      timeSum += Math.min(a.timeMs, TIME_CAP_MS);
      timed++;
    }
  }
  return {
    n,
    correct,
    accuracy: n ? correct / n : null,
    avgTime: timed ? timeSum / timed / 1000 : null,
  };
}

export function byMode(list) {
  const out = { all: summarize(list) };
  for (const m of MODE_IDS) out[m] = summarize(list.filter((a) => a.mode === m));
  return out;
}

export function inRange(attempts, from, to) {
  return attempts.filter((a) => a.ts >= from && a.ts < to);
}

export function weekComparison(attempts, now = Date.now()) {
  const thisStart = startOfWeek(now);
  const lastStart = addDays(thisStart, -7);
  const thisWeek = inRange(attempts, thisStart, addDays(thisStart, 7));
  const lastWeek = inRange(attempts, lastStart, thisStart);
  return {
    thisWeek: byMode(thisWeek),
    lastWeek: byMode(lastWeek),
    sessionsThisWeek: countSessions(thisWeek),
    sessionsLastWeek: countSessions(lastWeek),
  };
}

export function countSessions(list) {
  return new Set(list.map((a) => a.sessionId)).size;
}

// One entry per week (oldest first) for the trend charts.
export function weeklySeries(attempts, mode = 'all', weeks = 8, now = Date.now()) {
  const thisStart = startOfWeek(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisStart, -7 * i);
    let list = inRange(attempts, start, addDays(start, 7));
    if (mode !== 'all') list = list.filter((a) => a.mode === mode);
    out.push({ start, ...summarize(list) });
  }
  return out;
}

export function dayCounts(attempts) {
  const map = new Map();
  for (const a of attempts) {
    const k = dayKey(a.ts);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

export function streaks(attempts, now = Date.now()) {
  const days = dayCounts(attempts);
  const today = startOfDay(now);
  const practicedToday = days.has(dayKey(today));
  let current = 0;
  let cursor = practicedToday ? today : addDays(today, -1);
  while (days.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of [...days.keys()].sort()) {
    const t = new Date(key + 'T00:00:00').getTime();
    run = prev != null && dayKey(addDays(prev, 1)) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { current, best, practicedToday };
}

// The mode most worth practising now, with a short reason.
export function weakestMode(attempts, now = Date.now()) {
  const since = now - 14 * DAY;
  const recent = attempts.filter((a) => a.ts >= since);
  if (recent.length < 10) return null;
  const stats = MODE_IDS.map((mode) => ({ mode, ...summarize(recent.filter((a) => a.mode === mode)) }));
  const practised = stats.filter((s) => s.n >= 8);
  const neglected = stats.filter((s) => s.n === 0);
  if (practised.length === 0) return null;
  practised.sort((a, b) => a.accuracy - b.accuracy || b.avgTime - a.avgTime);
  const worst = practised[0];
  if (neglected.length && worst.accuracy >= 0.85) {
    return { mode: neglected[0].mode, reason: 'not practised in the last 2 weeks' };
  }
  return {
    mode: worst.mode,
    accuracy: worst.accuracy,
    avgTime: worst.avgTime,
    reason: `${Math.round(worst.accuracy * 100)}% accuracy over the last 2 weeks`,
  };
}

// Problem types (template + difficulty) you get wrong most, for review mode.
export function mistakeTypes(attempts, now = Date.now(), { days = 60, limit = 6 } = {}) {
  const since = now - days * DAY;
  const groups = new Map();
  for (const a of attempts) {
    if (a.ts < since) continue;
    const key = `${a.templateId}|${a.difficulty}`;
    if (!groups.has(key)) groups.set(key, { templateId: a.templateId, difficulty: a.difficulty, mode: a.mode, list: [] });
    groups.get(key).list.push(a);
  }
  const out = [];
  for (const g of groups.values()) {
    const wrong = g.list.filter((a) => !a.correct);
    if (wrong.length === 0) continue;
    const total = g.list.length;
    const rate = wrong.length / total;
    const recentWrong = wrong.filter((a) => a.ts >= now - 7 * DAY).length;
    let weight = (wrong.length + recentWrong) * (0.5 + rate);
    // recently mastered: last 5 tries all correct
    const last5 = g.list.slice(-5);
    if (last5.length === 5 && last5.every((a) => a.correct)) weight *= 0.2;
    out.push({ templateId: g.templateId, difficulty: g.difficulty, mode: g.mode, wrong: wrong.length, total, rate, weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, limit);
}

export function goalProgress(goal, attempts, now = Date.now()) {
  const start = startOfWeek(now);
  const week = inRange(attempts, start, addDays(start, 7));
  const done = goal.type === 'sessions' ? countSessions(week) : week.length;
  const target = Math.max(1, goal.target);
  return { done, target, fraction: Math.min(1, done / target), unit: goal.type === 'sessions' ? 'sessions' : 'problems' };
}
