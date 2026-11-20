// Ladder positions for ierne-tennis-api.
//
// Positions are never stored. They are computed by replaying, in time order:
//   - the admin-set start order (entrants with ladder_start_position),
//   - later joiners (no start position), who go to the bottom when they join,
//   - completed ladder results. Side A is always the challenger. If the
//     challenger wins from below, they take the defender's place and everyone
//     in between moves down one. If the defender wins, nothing moves.
// Editing or clearing a result therefore always yields the right ladder.

export type LadderEntrant = {
  entrantId: string;
  startPosition: number | null;
  joinedAt: number; // epoch ms
  name: string;
};

export type LadderResult = {
  fixtureId: string;
  challengerId: string; // side A
  defenderId: string; // side B
  setsA: number;
  setsB: number;
  at: number; // epoch ms the result was first posted
};

export type LadderMove = {
  fixtureId: string;
  challengerWon: boolean;
  moved: boolean;
};

export function replayLadder(
  entrants: LadderEntrant[],
  results: LadderResult[],
): { order: string[]; moves: LadderMove[] } {
  const seeded = entrants
    .filter((e) => e.startPosition != null)
    .sort((a, b) =>
      (a.startPosition! - b.startPosition!) ||
      (a.joinedAt - b.joinedAt) ||
      a.name.localeCompare(b.name)
    );
  const order: string[] = seeded.map((e) => e.entrantId);

  type Ev =
    | { kind: "join"; at: number; entrantId: string; name: string }
    | { kind: "result"; at: number; r: LadderResult };
  const events: Ev[] = [];
  for (const e of entrants) {
    if (e.startPosition == null) {
      events.push({ kind: "join", at: e.joinedAt, entrantId: e.entrantId, name: e.name });
    }
  }
  for (const r of results) events.push({ kind: "result", at: r.at, r });
  events.sort((x, y) => {
    if (x.at !== y.at) return x.at - y.at;
    if (x.kind !== y.kind) return x.kind === "join" ? -1 : 1;
    if (x.kind === "join" && y.kind === "join") return x.name.localeCompare(y.name);
    return 0;
  });

  const moves: LadderMove[] = [];
  for (const ev of events) {
    if (ev.kind === "join") {
      if (!order.includes(ev.entrantId)) order.push(ev.entrantId);
      continue;
    }
    const r = ev.r;
    const ia = order.indexOf(r.challengerId);
    const ib = order.indexOf(r.defenderId);
    const challengerWon = r.setsA > r.setsB;
    if (ia < 0 || ib < 0) {
      moves.push({ fixtureId: r.fixtureId, challengerWon, moved: false });
      continue;
    }
    if (challengerWon && ia > ib) {
      order.splice(ia, 1);
      order.splice(ib, 0, r.challengerId);
      moves.push({ fixtureId: r.fixtureId, challengerWon, moved: true });
    } else {
      moves.push({ fixtureId: r.fixtureId, challengerWon, moved: false });
    }
  }
  return { order, moves };
}

/** Why `challengerId` may not challenge `defenderId`, or null when allowed. */
export function challengeBlockReason(
  order: string[],
  challengerId: string,
  defenderId: string,
  range: number,
): string | null {
  const ic = order.indexOf(challengerId);
  const id = order.indexOf(defenderId);
  if (ic < 0) return "The challenger is not on this ladder.";
  if (id < 0) return "That opponent is not on this ladder.";
  if (challengerId === defenderId) return "You cannot challenge yourself.";
  if (id >= ic) return "You can only challenge someone above you on the ladder.";
  if (ic - id > range) {
    return `You can only challenge up to ${range} place${range === 1 ? "" : "s"} above you.`;
  }
  return null;
}
