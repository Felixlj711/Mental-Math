// Random number helpers. A seed makes results reproducible (used by tests);
// without one, the app seeds from the browser's secure random source.

export function randomSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

export function createRng(seed = randomSeed()) {
  let s = seed >>> 0;
  // mulberry32: small, fast, good enough for drills
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = {
    next,
    // integer in [min, max], inclusive
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // pick using weights: items = [[value, weight], ...]
    weighted(items) {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let x = next() * total;
      for (const [value, w] of items) {
        x -= w;
        if (x < 0) return value;
      }
      return items[items.length - 1][0];
    },
  };
  return rng;
}
