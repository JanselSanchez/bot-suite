// worker/utils/scoring.ts
import type { Keyword } from "./keywordsCache";

export type MatchKind = "exact" | "contains" | "fuzzy";
export type ScoreResult = {
  byIntent: Record<string, number>;
  matches: Array<{ intent: string; frase: string; kind: MatchKind; weight: number }>;
};

export function scoreIntent(text: string, keywords: Keyword[]): ScoreResult {
  const byIntent: Record<string, number> = {};
  const matches: ScoreResult["matches"] = [];

  for (const kw of keywords) {
    const f = kw.frase.toLowerCase().trim();
    if (!f) continue;

    let kind: MatchKind | null = null;
    let add = 0;

    if (text === f) {
      kind = "exact";
      add = kw.peso * 1.0;
    } else if (text.includes(f) && f.length >= 2) {
      kind = "contains";
      add = kw.peso * 0.7;
    } else if (f.length >= 4 && levenshtein(text, f) <= 1) {
      kind = "fuzzy";
      add = kw.peso * 0.5;
    }

    if (kind) {
      byIntent[kw.intent] = (byIntent[kw.intent] || 0) + add;
      matches.push({ intent: kw.intent, frase: f, kind, weight: add });
    }
  }

  return { byIntent, matches };
}

export function pickIntent(byIntent: Record<string, number>): { intent: string | null; score: number } {
  let bestScore = 0;
  let bestIntents: string[] = [];

  for (const [intent, score] of Object.entries(byIntent)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntents = [intent];
    } else if (score === bestScore) {
      bestIntents.push(intent);
    }
  }
  if (bestScore === 0 || bestIntents.length === 0) return { intent: null, score: 0 };

  const priority = ["cancelar", "reprogramar", "reservar", "disponibilidad", "estado", "saludo"];
  bestIntents.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));

  return { intent: bestIntents[0] || null, score: bestScore };
}

// Levenshtein simple
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
