// Tennis score validation for ierne-tennis-api.
// The browser mirrors these rules in assets/js/utils/tennis-score.js; this
// file is the authority.

export type FinalSetMode = "full" | "match_tiebreak";

export type MatchFormat = {
  setsToWin: number; // 1..3
  gamesPerSet: number; // 4, 6 or 8
  finalSet: FinalSetMode;
};

export type SetScore = {
  a: number;
  b: number;
  tbA?: number | null;
  tbB?: number | null;
  mtb?: boolean;
};

export type MatchTotals = {
  sets: SetScore[];
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
};

export function parseMatchFormat(raw: {
  sets_to_win?: unknown;
  games_per_set?: unknown;
  final_set?: unknown;
}): MatchFormat {
  const stw = Math.trunc(Number(raw.sets_to_win));
  const gps = Math.trunc(Number(raw.games_per_set));
  return {
    setsToWin: stw >= 1 && stw <= 3 ? stw : 2,
    gamesPerSet: gps === 4 || gps === 8 ? gps : 6,
    finalSet: raw.final_set === "full" ? "full" : "match_tiebreak",
  };
}

/** Normalises user input into a format setting, or null when invalid. */
export function readFormatInput(
  data: Record<string, unknown>,
  fallback: MatchFormat,
): MatchFormat | null {
  const stwRaw = data.setsToWin;
  const gpsRaw = data.gamesPerSet;
  const fsRaw = data.finalSet;
  const stw = stwRaw === undefined || stwRaw === null || stwRaw === ""
    ? fallback.setsToWin
    : Math.trunc(Number(stwRaw));
  const gps = gpsRaw === undefined || gpsRaw === null || gpsRaw === ""
    ? fallback.gamesPerSet
    : Math.trunc(Number(gpsRaw));
  const fs = fsRaw === undefined || fsRaw === null || fsRaw === ""
    ? fallback.finalSet
    : String(fsRaw);
  if (!(stw >= 1 && stw <= 3)) return null;
  if (gps !== 4 && gps !== 6 && gps !== 8) return null;
  if (fs !== "full" && fs !== "match_tiebreak") return null;
  return { setsToWin: stw, gamesPerSet: gps, finalSet: fs };
}

function int(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.trunc(n) !== n || n < 0) return NaN;
  return n;
}

/** Winner of a tiebreak played to `target`, win by two. Null if not finished. */
function tiebreakWinner(x: number, y: number, target: number): "a" | "b" | null {
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  if (hi < target) return null;
  if (hi - lo < 2) return null;
  if (hi > target && hi - lo !== 2) return null; // extended tiebreaks end on a 2-point margin
  return x > y ? "a" : "b";
}

/** Returns the winner of a normal set, or an error string. */
function normalSetWinner(s: SetScore, gps: number): "a" | "b" | string {
  const { a, b } = s;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const side: "a" | "b" = a > b ? "a" : "b";
  if (a === b) return `A set cannot finish level (${a}-${b}).`;
  if (hi === gps && lo <= gps - 2) return side;
  if (hi === gps + 1 && lo === gps - 1) return side;
  if (hi === gps + 1 && lo === gps) {
    const tbA = s.tbA;
    const tbB = s.tbB;
    if (tbA == null && tbB == null) return side; // tiebreak points are optional
    if (tbA == null || tbB == null) return "Enter both tiebreak scores, or neither.";
    const tbw = tiebreakWinner(tbA, tbB, 7);
    if (!tbw) return `Tiebreak ${tbA}-${tbB} is not a finished tiebreak.`;
    if (tbw !== side) return "The tiebreak winner must also win the set.";
    return side;
  }
  return `${a}-${b} is not a finished set when sets are played to ${gps} games.`;
}

/**
 * Validates set-by-set input. Returns totals, or an error message.
 * An empty list means "clear the result".
 */
export function validateSets(rawSets: unknown, format: MatchFormat): MatchTotals | string {
  if (rawSets === undefined || rawSets === null) return { sets: [], setsA: 0, setsB: 0, gamesA: 0, gamesB: 0 };
  if (!Array.isArray(rawSets)) return "sets must be a list";
  if (rawSets.length === 0) return { sets: [], setsA: 0, setsB: 0, gamesA: 0, gamesB: 0 };
  const maxSets = format.setsToWin * 2 - 1;
  if (rawSets.length > maxSets) return `A best-of-${maxSets} match has at most ${maxSets} sets.`;

  const out: SetScore[] = [];
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;

  for (let i = 0; i < rawSets.length; i++) {
    if (setsA === format.setsToWin || setsB === format.setsToWin) {
      return "The match was already decided before the last set entered.";
    }
    const r = rawSets[i] as Record<string, unknown>;
    const isDecider = i === maxSets - 1 && maxSets > 1;
    const mtb = isDecider && format.finalSet === "match_tiebreak";
    const label = `Set ${i + 1}`;

    if (mtb) {
      // Match tiebreak: points to 10, win by 2. Accept points in tbA/tbB, or in a/b.
      let pa = int(r?.tbA);
      let pb = int(r?.tbB);
      if (pa == null && pb == null) {
        pa = int(r?.a);
        pb = int(r?.b);
      }
      if (pa == null || pb == null || Number.isNaN(pa) || Number.isNaN(pb)) {
        return `${label}: enter the match tiebreak points.`;
      }
      const w = tiebreakWinner(pa, pb, 10);
      if (!w) return `${label}: ${pa}-${pb} is not a finished match tiebreak (first to 10, win by 2).`;
      const set: SetScore = { a: w === "a" ? 1 : 0, b: w === "b" ? 1 : 0, tbA: pa, tbB: pb, mtb: true };
      out.push(set);
      if (w === "a") { setsA++; gamesA++; } else { setsB++; gamesB++; }
      continue;
    }

    const a = int(r?.a);
    const b = int(r?.b);
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) {
      return `${label}: enter games for both sides.`;
    }
    const tbA = int(r?.tbA);
    const tbB = int(r?.tbB);
    if (Number.isNaN(tbA) || Number.isNaN(tbB)) return `${label}: tiebreak points must be whole numbers.`;
    const set: SetScore = { a, b };
    const isTiebreakSet = Math.max(a, b) === format.gamesPerSet + 1 && Math.min(a, b) === format.gamesPerSet;
    if (isTiebreakSet && tbA != null && tbB != null) {
      set.tbA = tbA;
      set.tbB = tbB;
    }
    const w = normalSetWinner({ ...set, tbA: isTiebreakSet ? tbA : null, tbB: isTiebreakSet ? tbB : null }, format.gamesPerSet);
    if (w !== "a" && w !== "b") return `${label}: ${w}`;
    out.push(set);
    gamesA += a;
    gamesB += b;
    if (w === "a") setsA++; else setsB++;
  }

  if (setsA !== format.setsToWin && setsB !== format.setsToWin) {
    return `The match is not finished: one side must win ${format.setsToWin} set${format.setsToWin === 1 ? "" : "s"}.`;
  }
  return { sets: out, setsA, setsB, gamesA, gamesB };
}

/** "6-4 3-6 [10-7]" from side A's point of view. */
export function formatSetLine(sets: SetScore[] | null | undefined): string {
  if (!Array.isArray(sets) || !sets.length) return "";
  return sets.map((s) => {
    if (s.mtb) return `[${s.tbA}-${s.tbB}]`;
    const tb = s.tbA != null && s.tbB != null ? `(${Math.min(s.tbA, s.tbB)})` : "";
    return `${s.a}-${s.b}${tb}`;
  }).join(" ");
}
