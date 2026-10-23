// Picks the next problem: chooses a template, generates numbers, rejects
// anything seen recently, and rotates the wording so it never feels samey.

import { TEMPLATES, TEMPLATE_BY_ID, templatesForMode, MODES, answerHint } from './generators.js';
import { createRng } from './rng.js';

// No problem repeats within this many problems.
export const SEEN_WINDOW = 10000;

const CONTEXT_RATE = { off: 0, some: 0.35, often: 0.7 };
const MODE_IDS = Object.keys(MODES);

export function fingerprintOf(templateId, key) {
  return `${templateId}|${key}`;
}

export class ProblemEngine {
  constructor({ rng = createRng(), recentFingerprints = [], rotation = null, context = 'some' } = {}) {
    this.rng = rng;
    this.context = context;
    this.seen = new Set();
    this.seenQueue = [];
    this.seenHead = 0;
    for (const fp of recentFingerprints.slice(-SEEN_WINDOW)) this.remember(fp);
    // "tick" counts problems; frames/phrasings/templates store the tick they were last used
    this.rotation = { tick: 0, frames: {}, phrasings: {}, templates: {}, ...(rotation || {}) };
    this.lastTemplate = null;
    this.lastMode = null;
    this.lastBucket = {};
  }

  remember(fp) {
    if (this.seen.has(fp)) return;
    this.seen.add(fp);
    this.seenQueue.push(fp);
    while (this.seenQueue.length - this.seenHead > SEEN_WINDOW) {
      this.seen.delete(this.seenQueue[this.seenHead++]);
    }
    if (this.seenHead > 5000) {
      this.seenQueue = this.seenQueue.slice(this.seenHead);
      this.seenHead = 0;
    }
  }

  hasSeen(fp) {
    return this.seen.has(fp);
  }

  rotationState() {
    return this.rotation;
  }

  // spec: { mode: 'mult' | 'pct' | 'growth' | 'div' | 'mixed', difficulty: 1-3 }
  //   or: { pool: [{ templateId, difficulty, weight }] }   (review mode)
  next(spec) {
    let options = this.options(spec);
    for (let round = 0; round < 8 && options.length; round++) {
      const choice = this.choose(options, spec);
      const generated = this.generate(choice.template, choice.difficulty);
      if (generated) return this.finish(generated, choice);
      // That template is exhausted (every variant seen recently): try another.
      options = options.filter((o) => o !== choice);
    }
    // Practically unreachable: allow a repeat rather than failing.
    const fallback = this.options(spec)[0];
    return this.finish(this.generate(fallback.template, fallback.difficulty, true), fallback);
  }

  options(spec) {
    if (spec.pool && spec.pool.length) {
      return spec.pool
        .filter((p) => TEMPLATE_BY_ID[p.templateId])
        .map((p) => ({ template: TEMPLATE_BY_ID[p.templateId], difficulty: p.difficulty, weight: p.weight ?? 1 }));
    }
    const list = spec.mode === 'mixed' ? TEMPLATES : templatesForMode(spec.mode);
    return list.map((template) => ({ template, difficulty: spec.difficulty, weight: 1 }));
  }

  choose(options, spec) {
    const tick = this.rotation.tick;
    let pool = options;
    // never the same template twice in a row
    const others = pool.filter((o) => o.template.id !== this.lastTemplate);
    if (others.length) pool = others;
    // mixed mode: also change the mode each time
    if (spec.mode === 'mixed') {
      const modes = MODE_IDS.filter((m) => m !== this.lastMode && pool.some((o) => o.template.mode === m));
      if (modes.length) {
        const mode = this.rng.pick(modes);
        pool = pool.filter((o) => o.template.mode === mode);
      }
    }
    // favour templates that haven't been used for a while
    return this.rng.weighted(
      pool.map((o) => {
        const last = this.rotation.templates[o.template.id];
        const since = last == null ? 12 : Math.min(12, tick - last);
        return [o, o.weight * (1 + since)];
      })
    );
  }

  generate(template, difficulty, allowRepeat = false) {
    let fallback = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const g = template.gen(this.rng, difficulty);
      const fp = fingerprintOf(template.id, g.key);
      if (!allowRepeat && this.seen.has(fp)) continue;
      g.fingerprint = fp;
      // vary magnitudes: avoid an answer of the same size as last time for this template
      const bucket = Math.floor(Math.log10(Math.abs(g.answer) || 1));
      if (attempt < 12 && bucket === this.lastBucket[template.id]) {
        fallback = fallback || g;
        continue;
      }
      return g;
    }
    return fallback;
  }

  finish(g, choice) {
    const { template, difficulty } = choice;
    const rot = this.rotation;
    const tick = ++rot.tick;
    const rate = CONTEXT_RATE[this.context] ?? CONTEXT_RATE.some;
    const useFrame = g.frames.length > 0 && (g.plain.length === 0 || this.rng.chance(rate));
    let prompt;
    if (useFrame) {
      const frame = this.leastRecent(g.frames, (f) => rot.frames[f.id]);
      rot.frames[frame.id] = tick;
      prompt = frame.text;
    } else {
      const indexed = g.plain.map((text, i) => ({ text, key: `${template.id}#${i}` }));
      const phr = this.leastRecent(indexed, (p) => rot.phrasings[p.key]);
      rot.phrasings[phr.key] = tick;
      prompt = phr.text;
    }
    rot.templates[template.id] = tick;
    this.lastTemplate = template.id;
    this.lastMode = template.mode;
    this.lastBucket[template.id] = Math.floor(Math.log10(Math.abs(g.answer) || 1));
    this.remember(g.fingerprint);

    const problem = {
      templateId: template.id,
      typeName: template.name,
      mode: template.mode,
      difficulty,
      prompt,
      isContext: useFrame,
      answer: g.answer,
      kind: g.kind,
      exact: !!g.exact,
      sig: g.sig ?? 3,
      minTol: g.minTol || 0,
      signed: !!g.signed,
      explain: g.explain,
      fingerprint: g.fingerprint,
      params: g.params,
      shown: g.shown,
    };
    problem.hint = answerHint(problem);
    return problem;
  }

  // Least recently used item; ties broken randomly.
  leastRecent(items, lastUsed) {
    let best = [];
    let bestTick = Infinity;
    for (const item of items) {
      const t = lastUsed(item) ?? -1;
      if (t < bestTick) {
        bestTick = t;
        best = [item];
      } else if (t === bestTick) best.push(item);
    }
    return this.rng.pick(best);
  }
}
