// Geteilte Fuzzy-Suche (API + Frontend). Umlaute/Sonderzeichen werden gefaltet.

export function fuzzyNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Score: null = kein Treffer, größer = besser. */
export function fuzzyScore(name: string, query: string): number | null {
  const n = fuzzyNorm(name);
  const q = fuzzyNorm(query);
  if (!q) return 0;
  let score = 0;
  for (const token of q.split(" ")) {
    if (!token) continue;
    if (n.startsWith(token)) score += 100;
    else if (n.split(" ").some((w) => w.startsWith(token))) score += 80;
    else if (n.includes(token)) score += 60;
    else {
      let i = 0;
      for (const ch of n) if (ch === token[i]) i++;
      if (i < token.length) return null;
      score += 30;
    }
  }
  return score;
}

/** Bester Treffer über Schwelle oder null. */
export function besterTreffer<T>(
  kandidaten: T[],
  query: string,
  nameVon: (t: T) => string,
  schwelle = 80,
): { treffer: T; score: number } | null {
  let best: { treffer: T; score: number } | null = null;
  for (const k of kandidaten) {
    const s = fuzzyScore(nameVon(k), query);
    if (s !== null && s >= schwelle && (!best || s > best.score)) {
      best = { treffer: k, score: s };
    }
  }
  return best;
}
