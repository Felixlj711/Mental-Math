// Small DOM helpers shared by the app screens.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Builds elements with textContent only (never innerHTML), so data from an
// imported file can't inject code into the page.
export function h(tag, attrs = {}, ...children) {
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

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let toastTimer = null;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

export const secs = (x) => (x == null ? '–' : `${x < 10 ? x.toFixed(1) : Math.round(x)} s`);

// Same keypad rules everywhere: digits, one decimal point, a K/M/B suffix.
export function editNumber(s, key, { allowSuffix = true, allowNegative = false } = {}) {
  if (key === 'back') return s.slice(0, -1);
  if (key === 'neg') return allowNegative ? (s.startsWith('-') ? s.slice(1) : '-' + s) : s;
  if ('KMB'.includes(key)) {
    if (!allowSuffix) return s;
    const base = s.replace(/[KMB]$/, '');
    return /\d/.test(base) ? base + key : base;
  }
  if (key === '.') return /[.KMB]/.test(s) ? s : s + (/\d$/.test(s) ? '.' : '0.');
  if (/^\d$/.test(key)) {
    if (/[KMB]$/.test(s) || s.replace(/\D/g, '').length >= 12) return s;
    return (s === '0' || s === '-0' ? s.slice(0, -1) : s) + key;
  }
  return s;
}

// "1234.5K" -> "1,234.5K"
export function formatInput(s) {
  const m = /^(-?)(\d*)(\.?\d*)([KMB]?)$/.exec(s);
  if (!m) return s;
  const int = m[2] ? Number(m[2]).toLocaleString('en-US') : m[3] ? '0' : '';
  return (m[1] ? '−' : '') + int + m[3] + m[4];
}
