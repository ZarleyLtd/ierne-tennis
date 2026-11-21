// Fixture generation for ierne-tennis-api: league round robin, single
// knockout and double-eliminator brackets. Ported unchanged from the snooker
// app (ierne-api); "side" means an entrant id (one player or a pair).
// The double-eliminator scheme is described in docs/plans/double-eliminator.md.

export const KNOCKOUT_GROUP_ID = "ko";
export const WINNER_OF_PREFIX = "wo:";
export const LOSER_OF_PREFIX = "lo:";
export const BYE_ENTRANT_ID = "bye";
export const BYE_ENTRANT_NAME = "Bye";

export function winnerOfId(roundCode: string): string {
  return WINNER_OF_PREFIX + roundCode;
}

export function loserOfId(roundCode: string): string {
  return LOSER_OF_PREFIX + roundCode;
}

export function isByeEntrantId(id: string | null | undefined): boolean {
  return String(id || "").trim().toLowerCase() === BYE_ENTRANT_ID;
}

export type GeneratedFixture = {
  groupId: string | null;
  stage: "group" | "knockout";
  roundLabel: string;
  roundName: string | null;
  sideAId: string;
  sideBId: string;
  sortOrder: number;
};

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Standard single-elim seed order for a power-of-2 bracket (slot → seed number).
 * e.g. 8 → [1,8,4,5,2,7,3,6]. Byes occupy seeds N+1..n so they never cluster
 * on one side (avoids a player receiving byes in consecutive rounds).
 */
function bracketSeedOrder(n: number): number[] {
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error("bracketSeedOrder requires a power of 2");
  }
  let seeds = [1, 2];
  while (seeds.length < n) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

/** Shuffle players, pad to next power of 2, place byes on high seed slots. */
function placePlayersWithBalancedByes(playerIds: string[]): (string | null)[] {
  const real = playerIds.filter(Boolean);
  const n = nextPow2(Math.max(2, real.length));
  const shuffled = shuffleInPlace(real.slice());
  const order = bracketSeedOrder(n);
  return order.map((seed) => (seed <= shuffled.length ? shuffled[seed - 1]! : null));
}

/**
 * Real entrant vs Bye indicator fixture (bracket padding).
 * Left unscored so it does not appear in Results or contribute to set/W–L stats;
 * generate already advances the real player into the next round.
 */
function byeFixture(
  base: Omit<GeneratedFixture, "sideAId" | "sideBId">,
  realPlayerId: string,
): GeneratedFixture {
  return {
    ...base,
    sideAId: realPlayerId,
    sideBId: BYE_ENTRANT_ID,
  };
}

function koStagePlanForSize(n: number): { id: string; matchCount: number; codes: (m: number) => string }[] {
  // n is power of 2 >= 2
  const plan: { id: string; matchCount: number; codes: (m: number) => string }[] = [];
  if (n >= 32) {
    plan.push({ id: "L32", matchCount: 16, codes: (m) => `L32-${m}` });
  }
  if (n >= 16) {
    plan.push({ id: "L16", matchCount: 8, codes: (m) => `L16-${m}` });
  }
  if (n >= 8) {
    plan.push({ id: "QF", matchCount: 4, codes: (m) => `QF${m}` });
  }
  if (n >= 4) {
    plan.push({ id: "SF", matchCount: 2, codes: (m) => `SF${m}` });
  }
  plan.push({ id: "F", matchCount: 1, codes: () => "F" });
  // Trim leading rounds until first round matchCount == n/2
  const firstMatches = n / 2;
  while (plan.length > 1 && plan[0]!.matchCount > firstMatches) {
    plan.shift();
  }
  return plan;
}

export function generateKnockoutFixtures(playerIds: string[]): GeneratedFixture[] {
  const real = playerIds.filter(Boolean);
  if (real.length < 2) throw new Error("Need at least 2 entrants to generate knockout fixtures");
  const slots = placePlayersWithBalancedByes(real);
  const n = slots.length;
  const plan = koStagePlanForSize(n);
  const out: GeneratedFixture[] = [];
  let sortOrder = 1;
  let current: (string | null)[] = slots;

  for (let r = 0; r < plan.length; r++) {
    const stage = plan[r]!;
    const next: (string | null)[] = [];
    for (let m = 0; m < stage.matchCount; m++) {
      const a = current[m * 2] ?? null;
      const b = current[m * 2 + 1] ?? null;
      const code = stage.codes(m + 1);
      if (a && b) {
        out.push({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sideAId: a,
          sideBId: b,
          sortOrder: sortOrder++,
        });
        next.push(winnerOfId(code));
      } else if (a || b) {
        const real = (a || b)!;
        out.push(byeFixture({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sortOrder: sortOrder++,
        }, real));
        next.push(real);
      } else {
        next.push(null);
      }
    }
    current = next;
  }
  return out;
}

export function generateDoubleElimFixtures(playerIds: string[]): GeneratedFixture[] {
  const real = playerIds.filter(Boolean);
  if (real.length < 2) {
    throw new Error("Need at least 2 entrants to generate double-eliminator fixtures");
  }
  const slots = placePlayersWithBalancedByes(real);
  const n = slots.length;
  const roundsWb = Math.log2(n); // e.g. 8 → 3
  const out: GeneratedFixture[] = [];
  let sortOrder = 1;

  // Winners bracket: W1-*, W2-*, ... WF
  type WbMatch = { code: string; played: boolean };
  const wbByRound: WbMatch[][] = [];
  let current: (string | null)[] = slots;

  for (let r = 1; r <= roundsWb; r++) {
    const matchCount = current.length / 2;
    const isFinal = r === roundsWb;
    const roundMatches: WbMatch[] = [];
    const next: (string | null)[] = [];
    for (let m = 0; m < matchCount; m++) {
      const a = current[m * 2] ?? null;
      const b = current[m * 2 + 1] ?? null;
      const code = isFinal ? "WF" : `W${r}-${m + 1}`;
      if (a && b) {
        out.push({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sideAId: a,
          sideBId: b,
          sortOrder: sortOrder++,
        });
        roundMatches.push({ code, played: true });
        next.push(winnerOfId(code));
      } else if (a || b) {
        const real = (a || b)!;
        out.push(byeFixture({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sortOrder: sortOrder++,
        }, real));
        // Bye match is an indicator only; no loser drops to the losers bracket.
        roundMatches.push({ code, played: false });
        next.push(real);
      } else {
        roundMatches.push({ code, played: false });
        next.push(null);
      }
    }
    wbByRound.push(roundMatches);
    current = next;
  }

  // Losers bracket. For 2 players there is only WF — grand final is winner vs loser of WF.
  if (roundsWb === 1) {
    out.push({
      groupId: KNOCKOUT_GROUP_ID,
      stage: "knockout",
      roundLabel: "GF",
      roundName: null,
      sideAId: winnerOfId("WF"),
      sideBId: loserOfId("WF"),
      sortOrder: sortOrder++,
    });
    out.push({
      groupId: KNOCKOUT_GROUP_ID,
      stage: "knockout",
      roundLabel: "GF-R",
      roundName: null,
      sideAId: winnerOfId("GF"),
      sideBId: loserOfId("GF"),
      sortOrder: sortOrder++,
    });
    return out;
  }

  // L1: pair actual WB round-1 losers only (W1 byes do not drop anyone).
  // Later absorb rounds use full-slot DE shape: one LB match per WB dropper,
  // with LB survivors filling early slots and remaining droppers getting byes
  // (e.g. 18 players → L1×1, then L2×8 with 7 byes, then L3×4, …).
  let lbEntrants: (string | null)[] = [];
  const wbR1 = wbByRound[0] || [];
  for (const m of wbR1) {
    if (m.played) lbEntrants.push(loserOfId(m.code));
  }
  let lbRoundNum = 1;
  let lbCurrent: (string | null)[] = lbEntrants;

  function pairRound(
    entrants: (string | null)[],
    codeFor: (m: number) => string,
  ): { fixtures: GeneratedFixture[]; winners: (string | null)[] } {
    const fixtures: GeneratedFixture[] = [];
    const winners: (string | null)[] = [];
    // Ensure even length
    const list = entrants.slice();
    if (list.length % 2 === 1) list.push(null);
    for (let m = 0; m < list.length / 2; m++) {
      const a = list[m * 2] ?? null;
      const b = list[m * 2 + 1] ?? null;
      const code = codeFor(m + 1);
      if (a && b) {
        fixtures.push({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sideAId: a,
          sideBId: b,
          sortOrder: 0, // filled below
        });
        winners.push(winnerOfId(code));
      } else if (a || b) {
        const real = (a || b)!;
        fixtures.push(byeFixture({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sortOrder: 0,
        }, real));
        winners.push(real);
      } else {
        winners.push(null);
      }
    }
    return { fixtures, winners };
  }

  /** Full-slot absorb: one match per WB dropper; spare droppers get byes. */
  function absorbRound(
    lbWinners: (string | null)[],
    droppers: (string | null)[],
    codeFor: (m: number) => string,
  ): { fixtures: GeneratedFixture[]; winners: (string | null)[] } {
    const lbs = lbWinners.filter(Boolean) as string[];
    const drops = droppers.filter(Boolean) as string[];
    if (drops.length === 0) {
      return { fixtures: [], winners: lbs.slice() };
    }
    // Nobody waiting in LB yet — pair the droppers among themselves.
    if (lbs.length === 0) {
      return pairRound(drops, codeFor);
    }

    const fixtures: GeneratedFixture[] = [];
    const winners: (string | null)[] = [];
    for (let i = 0; i < drops.length; i++) {
      const dropper = drops[i]!;
      const lb = i < lbs.length ? lbs[i]! : null;
      const code = codeFor(i + 1);
      if (lb) {
        fixtures.push({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sideAId: lb,
          sideBId: dropper,
          sortOrder: 0,
        });
        winners.push(winnerOfId(code));
      } else {
        fixtures.push(byeFixture({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: code,
          roundName: null,
          sortOrder: 0,
        }, dropper));
        winners.push(dropper);
      }
    }

    // Excess LB survivors (should be rare after consolidation) keep playing.
    if (lbs.length > drops.length) {
      const excess = lbs.slice(drops.length);
      if (excess.length === 1) {
        winners.push(excess[0]!);
      } else if (excess.length > 1) {
        const extra = pairRound(excess, (m) => codeFor(drops.length + m));
        for (const f of extra.fixtures) fixtures.push(f);
        for (const w of extra.winners) winners.push(w);
      }
    }
    return { fixtures, winners };
  }

  if (lbCurrent.length >= 2) {
    const { fixtures, winners } = pairRound(lbCurrent, (m) => `L${lbRoundNum}-${m}`);
    for (const f of fixtures) {
      f.sortOrder = sortOrder++;
      out.push(f);
    }
    lbCurrent = winners;
    lbRoundNum++;
  }

  for (let wr = 1; wr < roundsWb; wr++) {
    const droppers: (string | null)[] = [];
    for (const m of wbByRound[wr] || []) {
      if (m.played) droppers.push(loserOfId(m.code));
    }
    const isLastWb = wr === roundsWb - 1;

    // Special-case losers final: when absorbing WF loser into last LB winner
    if (isLastWb) {
      const lbWinner = lbCurrent.find(Boolean) || null;
      const wfLoser = droppers.find(Boolean) || null;
      if (lbWinner && wfLoser) {
        out.push({
          groupId: KNOCKOUT_GROUP_ID,
          stage: "knockout",
          roundLabel: "LF",
          roundName: null,
          sideAId: lbWinner,
          sideBId: wfLoser,
          sortOrder: sortOrder++,
        });
        lbCurrent = [winnerOfId("LF")];
      } else if (lbWinner || wfLoser) {
        lbCurrent = [lbWinner || wfLoser];
      }
      break;
    }

    const { fixtures, winners } = absorbRound(lbCurrent, droppers, (m) => `L${lbRoundNum}-${m}`);
    for (const f of fixtures) {
      f.sortOrder = sortOrder++;
      out.push(f);
    }
    lbCurrent = winners;
    lbRoundNum++;

    // Consolidation when LB still has more survivors than the next WB drop.
    if (lbCurrent.filter(Boolean).length > 1 && wr < roundsWb - 1) {
      const nextDropCount = (wbByRound[wr + 1] || []).filter((m) => m.played).length;
      if (lbCurrent.filter(Boolean).length > nextDropCount) {
        const cons = pairRound(lbCurrent, (m) => `L${lbRoundNum}-${m}`);
        for (const f of cons.fixtures) {
          f.sortOrder = sortOrder++;
          out.push(f);
        }
        lbCurrent = cons.winners;
        lbRoundNum++;
      }
    }
  }

  // Grand final + reset
  out.push({
    groupId: KNOCKOUT_GROUP_ID,
    stage: "knockout",
    roundLabel: "GF",
    roundName: null,
    sideAId: winnerOfId("WF"),
    sideBId: winnerOfId("LF"),
    sortOrder: sortOrder++,
  });
  out.push({
    groupId: KNOCKOUT_GROUP_ID,
    stage: "knockout",
    roundLabel: "GF-R",
    roundName: null,
    sideAId: winnerOfId("GF"),
    sideBId: loserOfId("GF"),
    sortOrder: sortOrder++,
  });

  return out;
}

/** Circle method single round-robin. Returns fixtures with week numbers as roundLabel. */
export function generateLeagueRoundRobin(
  groupId: string,
  playerIds: string[],
  sortOrderStart: number,
): GeneratedFixture[] {
  const players = playerIds.filter(Boolean).slice();
  if (players.length < 2) return [];
  const bye = "__BYE__";
  if (players.length % 2 === 1) players.push(bye);
  const n = players.length;
  const rounds = n - 1;
  const half = n / 2;
  const out: GeneratedFixture[] = [];
  let sortOrder = sortOrderStart;
  // Copy rotating list (fix player 0)
  const arr = players.slice();
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i]!;
      const b = arr[n - 1 - i]!;
      if (a === bye || b === bye) {
        const real = a === bye ? b : a;
        if (real === bye) continue;
        out.push(byeFixture({
          groupId,
          stage: "group",
          roundLabel: String(round + 1),
          roundName: null,
          sortOrder: sortOrder++,
        }, real));
        continue;
      }
      out.push({
        groupId,
        stage: "group",
        roundLabel: String(round + 1),
        roundName: null,
        sideAId: a,
        sideBId: b,
        sortOrder: sortOrder++,
      });
    }
    // Rotate all but first
    const fixed = arr[0]!;
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return out;
}

/**
 * Where a bracket round sits in play order: a higher rank is played later.
 * Only the round matters (an entrant never plays twice in one round). Returns null
 * for rounds with no fixed place, such as custom play-offs, which are then never
 * treated as earlier or later than anything. Mirrors KnockoutRounds.bracketRank.
 */
export function bracketRoundRank(code: string | null | undefined): number | null {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) return null;
  // Single knockout (L16/L32 are checked before the losers-round pattern below).
  if (/^L32-\d+$/.test(c)) return 1;
  if (/^L16-\d+$/.test(c)) return 2;
  if (/^QF\d+$/.test(c)) return 3;
  if (/^SF\d+$/.test(c)) return 4;
  if (c === "F") return 5;
  // Double-eliminator: winners rounds, then losers rounds, then the grand final.
  let m = c.match(/^W(\d+)-\d+$/);
  if (m) return 100 + Number(m[1]);
  if (c === "WF") return 199;
  m = c.match(/^L(\d+)-\d+$/);
  if (m) return 200 + Number(m[1]);
  if (c === "LF") return 299;
  if (c === "GF") return 300;
  if (c === "GF-R") return 301;
  // Older snooker-style codes.
  if (/^KO PRE-/.test(c)) return 0;
  m = c.match(/^KO LAST (\d+)$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 2) return 6 - Math.log2(n);
  }
  return null;
}

/** "the Final", "Semi-final 2", "Losers Round 1": for messages about a round. */
export function bracketRoundTitle(code: string | null | undefined, roundName?: string | null): string {
  const named = String(roundName ?? "").trim();
  if (named) return named;
  const c = String(code ?? "").trim().toUpperCase();
  let m: RegExpMatchArray | null;
  if (c === "F") return "the Final";
  if ((m = c.match(/^SF(\d+)$/))) return `Semi-final ${m[1]}`;
  if ((m = c.match(/^QF(\d+)$/))) return `Quarter-final ${m[1]}`;
  if ((m = c.match(/^L(16|32)-(\d+)$/))) return `the round of ${m[1]}`;
  if ((m = c.match(/^W(\d+)-\d+$/))) return `Round ${m[1]}`;
  if ((m = c.match(/^L(\d+)-\d+$/))) return `Losers Round ${m[1]}`;
  if (c === "WF") return "the Winners Final";
  if (c === "LF") return "the Losers Final";
  if (c === "GF") return "the Grand Final";
  if (c === "GF-R") return "the Grand Final reset";
  return c || "a later round";
}
