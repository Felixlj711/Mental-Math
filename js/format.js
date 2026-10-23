// Number formatting, parsing and answer checking.
// Pure functions only (no browser APIs), so they can be tested with Node.

const SUFFIXES = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

const MULTIPLIERS = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// Remove floating point noise, e.g. 0.1 + 0.2 -> 0.3
export function clean(n) {
  return Number.parseFloat(Number(n).toPrecision(12));
}

export function roundSig(n, sig) {
  if (n === 0 || !Number.isFinite(n)) return n;
  return Number(Number(n).toPrecision(sig));
}

// Number of significant digits, e.g. 1,757,500 -> 5, 0.25 -> 2
export function sigDigits(n) {
  n = Math.abs(clean(n));
  if (n === 0) return 1;
  const mantissa = n.toExponential().split('e')[0].replace('.', '');
  return mantissa.replace(/0+$/, '').length || 1;
}

const commaFormatters = new Map();
export function withCommas(n, maxDecimals = 2) {
  if (!commaFormatters.has(maxDecimals)) {
    commaFormatters.set(
      maxDecimals,
      new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals })
    );
  }
  return commaFormatters.get(maxDecimals).format(n);
}

// Business-style number: 2,400,000 -> "2.4M", 45,000 -> "45K", 4,500 -> "4,500".
// compact: false keeps everything below one million as a plain comma number.
export function fmtNum(n, { compact = true } = {}) {
  n = clean(n);
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const minForSuffix = compact ? 1e4 : 1e6;
  if (a >= minForSuffix) {
    for (const [value, suffix] of SUFFIXES) {
      if (a >= value) {
        const scaled = clean(a / value);
        // Only use K for round thousands; otherwise show full number.
        if (suffix === 'K' && !Number.isInteger(scaled)) break;
        // keep every digit so the number shown is exactly the number used
        return sign + withCommas(scaled, 6) + suffix;
      }
    }
  }
  return sign + withCommas(a, a < 10 ? 3 : 2);
}

export function fmtPct(n) {
  n = clean(n);
  return (n < 0 ? '−' : '') + withCommas(Math.abs(n), 4) + '%';
}

// Format a value according to the kind of answer it is.
export function fmtValue(n, kind) {
  switch (kind) {
    case 'percent':
      return fmtPct(n);
    case 'years':
      return withCommas(clean(n), 2) + (Math.abs(n) === 1 ? ' year' : ' years');
    case 'times':
      return withCommas(clean(n), 2) + '×';
    default:
      return fmtNum(n);
  }
}

// Shown answer: exact if short, otherwise rounded with "≈".
export function displayAnswer(problem) {
  const { answer, kind, exact, sig = 3 } = problem;
  if (exact || sigDigits(answer) <= Math.max(sig, 4)) return fmtValue(answer, kind);
  return '≈ ' + fmtValue(roundSig(answer, sig), kind);
}

// Parse what the user typed: "2.4M", "432,000", "-12.5", "40x", "25%"
export function parseAnswer(input) {
  if (input == null) return NaN;
  const s = String(input)
    .trim()
    .toUpperCase()
    .replace(/[\s,]/g, '')
    .replace(/[−–]/g, '-')
    .replace(/%|×|X$|YEARS?$|YRS?$/g, '');
  const m = /^([+-]?)(\d*\.?\d*)([KMBT]?)$/.exec(s);
  if (!m || m[2] === '' || m[2] === '.') return NaN;
  const value = Number.parseFloat(m[2]) * MULTIPLIERS[m[3]];
  return clean(m[1] === '-' ? -value : value);
}

// Is `given` correct for `problem` with the user's tolerance (0, 2 or 5 percent)?
export function checkAnswer(problem, given, tolerancePct) {
  if (!Number.isFinite(given)) return false;
  const a = problem.answer;
  const diff = Math.abs(given - a);
  const rel = Math.max((tolerancePct || 0) / 100, problem.minTol || 0);
  if (rel > 0 && diff <= rel * Math.abs(a) * (1 + 1e-9)) return true;
  return diff <= exactWindow(problem);
}

// How far off an answer may be in "exact" mode.
// Exact problems (e.g. 47 × 36) need the exact value; others need to match
// the answer rounded to `sig` significant figures.
export function exactWindow(problem) {
  const a = Math.abs(problem.answer);
  if (problem.exact || a === 0) return Math.max(a * 1e-15, 1e-6);
  const sig = problem.sig ?? 3;
  const unit = Math.pow(10, Math.floor(Math.log10(a)) - sig + 1);
  return unit / 2 + a * 1e-9;
}

// "10⁴" style superscripts for explanations
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
export function sup(n) {
  return String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('');
}
