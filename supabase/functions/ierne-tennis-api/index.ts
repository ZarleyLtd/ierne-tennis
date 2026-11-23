// Ierne Tennis API
// Single Edge Function exposing JSON read endpoints backed by the
// `ierne_tennis` schema, plus authenticated POST writes.
//
// We connect directly to Postgres (not PostgREST / supabase-js .schema)
// because the `ierne_tennis` schema is not on the project's Exposed Schemas
// list, so it stays private to this app.
//
// Vocabulary: a *player* is a person. An *entrant* is what plays a match: one
// player (singles; entrant id = player id) or a fixed pair (doubles; entrant
// id `pr:<a>+<b>`). For compatibility with the snooker-derived frontend,
// fixture and roster payloads keep the keys `playerAId`, `playerBId`,
// `"Player A"`, `"Player B"` and `playerId` / `playerName`; in those payloads
// they carry the ENTRANT id and display name.
//
// Read actions (GET):
//   ?action=getCompetitions
//   ?action=getCompetitionGroups  &compId=<id>
//   ?action=getFixtures           [&comp=<id>] [&competitionType=<type>]
//   ?action=getStandings          [&comp=<id>] [&competitionType=<type>]
//   ?action=getPlayers            [&comp=<id>] [&group=<id>]
//   ?action=getPlayerComps        &playerId=<id>
//   ?action=getEntrants           [&kind=pair|single]
//   ?action=getLadder             [&comp=<id>]
//
// Authenticated POST (Content-Type: application/x-www-form-urlencoded,
// body field `data` JSON):
//   { "action": "...", "data": { ... }, "adminToken": "<HMAC token>", "sessionToken": "..." }
// Env IERNE_TENNIS_ADMIN_SECRET is required for the admin PIN.
//
// Scores: score_a / score_b store SETS won; set_scores stores the set detail.
// Standings ordering: points, set difference, game difference, head-to-head
// mini-league among the tied entrants, then name.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  ApiError,
  connectAccount,
  disableAccount,
  issueInvite,
  listAccounts,
  listInvites,
  setAccountAdmin,
  setAccountApprover,
  readPlayerSession,
  registerAccount,
  resetAccountPassword,
  revokeInvite,
  signOutAccount,
  whoAmIAccount,
  withinResultWindow,
} from "./accounts.ts";
import {
  BYE_ENTRANT_ID,
  BYE_ENTRANT_NAME,
  GeneratedFixture,
  KNOCKOUT_GROUP_ID,
  LOSER_OF_PREFIX,
  WINNER_OF_PREFIX,
  bracketRoundRank,
  bracketRoundTitle,
  generateDoubleElimFixtures,
  generateKnockoutFixtures,
  generateLeagueRoundRobin,
  isByeEntrantId,
  loserOfId,
  winnerOfId,
} from "./brackets.ts";
import {
  MatchFormat,
  SetScore,
  formatSetLine,
  parseMatchFormat,
  readFormatInput,
  validateSets,
} from "./scoring.ts";
import { challengeBlockReason, LadderEntrant, LadderResult, replayLadder } from "./ladder.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

function unauthorizedResponse(message = "Unauthorized"): Response {
  return jsonResponse({ success: false, error: message }, 401);
}

type Sql = ReturnType<typeof postgres>;

let _sql: Sql | null = null;
function db(): Sql {
  if (_sql) return _sql;
  const dbUrl = Deno.env.get("SUPABASE_DB_URL")
    || Deno.env.get("DB_URL")
    || Deno.env.get("POSTGRES_URL");
  if (!dbUrl) throw new Error("Missing required env: SUPABASE_DB_URL");
  _sql = postgres(dbUrl, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return _sql;
}

function isoOrNull(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v as string | Date);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function truthy(v: unknown): boolean {
  return v === true || v === "t" || v === "true" || v === 1;
}

// ---------- Result slips (private Storage bucket) ----------------------------

const RESULT_SLIP_BUCKET = "ierne-tennis-result-slips";
const RESULT_SLIP_SIGNED_URL_TTL = 3600;
const RESULT_SLIP_MAX_BYTES = 1_500_000;

let _sb: ReturnType<typeof createClient> | null = null;
function storageClient() {
  if (_sb) return _sb;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  _sb = createClient(supabaseUrl, serviceRoleKey);
  return _sb;
}

function resultSlipPendingPath(fixtureId: string): string {
  return `fixtures/${fixtureId}/pending.jpg`;
}

function resultSlipCommittedPath(fixtureId: string): string {
  return `fixtures/${fixtureId}/slip.jpg`;
}

function decodeImagePayload(
  base64: unknown,
  mimeType: unknown,
): { bytes: Uint8Array; mime: string } | null {
  const raw = String(base64 || "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
  if (!raw) return null;
  const mime = String(mimeType || "image/jpeg");
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return null;
  let bin: string;
  try {
    bin = atob(raw);
  } catch {
    return null;
  }
  if (bin.length > RESULT_SLIP_MAX_BYTES) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

async function getSignedSlipUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await storageClient().storage
    .from(RESULT_SLIP_BUCKET)
    .createSignedUrl(path, RESULT_SLIP_SIGNED_URL_TTL);
  if (error) {
    console.warn("Failed to sign result-slip URL:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

async function uploadSlipBytes(path: string, bytes: Uint8Array, mime: string): Promise<void> {
  const { error } = await storageClient().storage.from(RESULT_SLIP_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

async function deleteSlipPaths(paths: string[]): Promise<void> {
  const clean = paths.map((p) => String(p || "").trim()).filter(Boolean);
  if (!clean.length) return;
  const { error } = await storageClient().storage.from(RESULT_SLIP_BUCKET).remove(clean);
  if (error) console.warn("Failed to delete result-slip object(s):", error.message);
}

async function clearFixtureResultSlip(fixtureId: string): Promise<void> {
  const pending = resultSlipPendingPath(fixtureId);
  const committed = resultSlipCommittedPath(fixtureId);
  const sql = db();
  const rows = await sql<{ result_slip_path: string | null }[]>`
    select result_slip_path from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  const dbPath = rows[0]?.result_slip_path || null;
  const toRemove = [pending, committed];
  if (dbPath && dbPath !== pending && dbPath !== committed) toRemove.push(dbPath);
  await deleteSlipPaths(toRemove);
  await sql`
    update ierne_tennis.fixtures
       set result_slip_path = null, result_slip_mime = null, updated_at = now()
     where fixture_id = ${fixtureId}::uuid
  `;
}

// ---------- Types -------------------------------------------------------------

type CompetitionType = "league" | "knockout" | "double-eliminator" | "ladder";
type CompetitionFormat = "singles" | "doubles" | "mixed";

type CompetitionRow = {
  competition_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean;
  competition_type: CompetitionType;
  format: CompetitionFormat;
  parent_competition_id: string | null;
  sets_to_win: number;
  games_per_set: number;
  final_set: "full" | "match_tiebreak";
  win_points: number;
  loss_points: number;
  set_points: number;
  loss_with_set_bonus: number;
  ladder_challenge_range: number;
  ladder_challenge_days: number;
};

type GroupRow = {
  competition_id: string;
  group_id: string;
  name: string;
  display_order: number;
};

type EntrantRow = {
  entrant_id: string;
  kind: "single" | "pair" | "placeholder" | "bye";
  player1_id: string | null;
  player2_id: string | null;
  entrant_name: string;
  active: boolean;
};

type CompetitionEntrantRow = {
  competition_id: string;
  group_id: string;
  entrant_id: string;
  seed: number | null;
  ladder_start_position: number | null;
  joined_at: string | Date;
};

type FixtureRow = {
  fixture_id: string;
  competition_id: string;
  group_id: string | null;
  stage: "group" | "knockout" | "ladder";
  round_label: string;
  round_name: string | null;
  side_a_id: string;
  side_b_id: string;
  match_date: string | null;
  sort_order: number;
  sets_to_win: number;
  games_per_set: number;
  final_set: "full" | "match_tiebreak";
  score_a: number | null;
  score_b: number | null;
  games_a: number | null;
  games_b: number | null;
  set_scores: SetScore[] | null;
  result_type: string;
  result_entered_by: string | null;
  result_approved: boolean;
  result_approved_by: string | null;
  result_approved_at: string | Date | null;
  result_posted_at: string | Date | null;
  challenged_at: string | Date | null;
  play_by: string | null;
};

type StandingRow = {
  group_id: string;
  entrant_id: string;
  played: number;
  won: number;
  lost: number;
  set_diff: number;
  game_diff: number;
  points: number;
};

type HeadToHeadRow = {
  group_id: string;
  entrant_id: string;
  opponent_id: string;
  h2h_set_diff: number;
  h2h_game_diff: number;
  h2h_points: number;
};

const COMPETITION_COLUMNS = `
  competition_id, name,
  to_char(starts_on, 'YYYY-MM-DD') as starts_on,
  to_char(ends_on, 'YYYY-MM-DD') as ends_on,
  is_current, competition_type, format, parent_competition_id,
  sets_to_win, games_per_set, final_set,
  win_points, loss_points, set_points, loss_with_set_bonus,
  ladder_challenge_range, ladder_challenge_days
`;

// ---------- Helpers -----------------------------------------------------------

function normalizeCompetitionType(raw: string | null | undefined): CompetitionType {
  const t = String(raw ?? "league").trim().toLowerCase();
  if (t === "knockout") return "knockout";
  if (t === "double-eliminator" || t === "double_eliminator" || t === "doubleelim") {
    return "double-eliminator";
  }
  if (t === "ladder") return "ladder";
  return "league";
}

function normalizeFormat(raw: unknown): CompetitionFormat {
  const t = String(raw ?? "singles").trim().toLowerCase();
  if (t === "doubles") return "doubles";
  if (t === "mixed" || t === "mixed-doubles" || t === "mixed_doubles") return "mixed";
  return "singles";
}

function isBracketCompetitionType(t: string | null | undefined): boolean {
  const n = normalizeCompetitionType(t);
  return n === "knockout" || n === "double-eliminator";
}

/** Bracket and ladder comps keep their whole roster in one internal group. */
function usesPoolGroup(t: string | null | undefined): boolean {
  const n = normalizeCompetitionType(t);
  return n === "knockout" || n === "double-eliminator" || n === "ladder";
}

function shapeCompetition(r: CompetitionRow) {
  return {
    compId: r.competition_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    isCurrent: r.is_current,
    competitionType: r.competition_type,
    format: r.format,
    parentCompId: r.parent_competition_id,
    setsToWin: Number(r.sets_to_win),
    gamesPerSet: Number(r.games_per_set),
    finalSet: r.final_set,
    winPoints: Number(r.win_points),
    lossPoints: Number(r.loss_points),
    setPoints: Number(r.set_points),
    lossWithSetBonus: Number(r.loss_with_set_bonus),
    ladderChallengeRange: Number(r.ladder_challenge_range),
    ladderChallengeDays: Number(r.ladder_challenge_days),
  };
}

async function loadCompetition(compId: string): Promise<CompetitionRow | null> {
  const sql = db();
  const rows = await sql.unsafe(
    `select ${COMPETITION_COLUMNS} from ierne_tennis.competitions where competition_id = $1`,
    [compId],
  );
  return (rows[0] as unknown as CompetitionRow) || null;
}

async function resolveCompId(
  requested: string | null,
  competitionTypeParam: string | null,
): Promise<string> {
  const sql = db();
  if (requested) {
    const found = await sql<{ competition_id: string }[]>`
      select competition_id from ierne_tennis.competitions where competition_id = ${requested}
    `;
    if (!found.length) throw new ApiError(`Unknown competition: ${requested}`, 404);
    return found[0].competition_id;
  }
  const competitionType = normalizeCompetitionType(competitionTypeParam);
  const current = await sql<{ competition_id: string }[]>`
    select competition_id
      from ierne_tennis.competitions
     where is_current = true and competition_type = ${competitionType}
     order by starts_on desc nulls last, competition_id asc
     limit 1
  `;
  if (!current.length) throw new ApiError(`No current ${competitionType} competition is set`, 404);
  return current[0].competition_id;
}

async function loadCompetitionGroups(compId: string): Promise<GroupRow[]> {
  const sql = db();
  const rows = await sql<GroupRow[]>`
    select competition_id, group_id, name, display_order
      from ierne_tennis.competition_groups
     where competition_id = ${compId}
     order by display_order asc, group_id asc
  `;
  return rows as unknown as GroupRow[];
}

async function loadEntrantMap(ids?: string[]): Promise<Map<string, EntrantRow>> {
  const sql = db();
  const rows = ids && ids.length
    ? await sql<EntrantRow[]>`
        select entrant_id, kind, player1_id, player2_id, entrant_name, active
          from ierne_tennis.entrants_v
         where entrant_id = any(${ids}::text[])
      `
    : await sql<EntrantRow[]>`
        select entrant_id, kind, player1_id, player2_id, entrant_name, active
          from ierne_tennis.entrants_v
      `;
  const map = new Map<string, EntrantRow>();
  for (const r of rows as unknown as EntrantRow[]) map.set(r.entrant_id, r);
  return map;
}

function entrantMemberIds(e: EntrantRow | undefined | null): string[] {
  if (!e) return [];
  return [e.player1_id, e.player2_id].filter((x): x is string => !!x);
}

// ---------- Internal entrants: bracket placeholders and the bye ---------------

function isWinnerOfId(id: string): boolean {
  return id.startsWith(WINNER_OF_PREFIX);
}

function isLoserOfId(id: string): boolean {
  return id.startsWith(LOSER_OF_PREFIX);
}

function isBracketPlaceholderId(id: string): boolean {
  return isWinnerOfId(id) || isLoserOfId(id);
}

function isInternalEntrantId(id: string | null | undefined): boolean {
  const s = String(id || "").trim();
  return isBracketPlaceholderId(s) || isByeEntrantId(s);
}

/** Unique per round code; the UI resolves friendly names via KnockoutRounds. */
function placeholderLabel(id: string): string {
  if (isWinnerOfId(id)) {
    const code = id.slice(WINNER_OF_PREFIX.length).trim();
    return code ? `Winner of ${code}` : "Winner";
  }
  if (isLoserOfId(id)) {
    const code = id.slice(LOSER_OF_PREFIX.length).trim();
    return code ? `Loser of ${code}` : "Loser";
  }
  return "";
}

async function ensureInternalEntrants(sql: Sql, ...ids: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isByeEntrantId(id)) {
      await sql`
        insert into ierne_tennis.entrants (entrant_id, kind, label)
        values (${BYE_ENTRANT_ID}, 'bye', ${BYE_ENTRANT_NAME})
        on conflict (entrant_id) do nothing
      `;
    } else if (isBracketPlaceholderId(id)) {
      await sql`
        insert into ierne_tennis.entrants (entrant_id, kind, label)
        values (${id}, 'placeholder', ${placeholderLabel(id)})
        on conflict (entrant_id) do nothing
      `;
    }
  }
}

/** Delete wo:/lo:/bye entrants that nothing references anymore. */
async function pruneUnusedInternalEntrants(sql: Sql): Promise<void> {
  await sql`
    delete from ierne_tennis.entrants e
     where e.kind in ('placeholder', 'bye')
       and not exists (
         select 1 from ierne_tennis.fixtures f
          where f.side_a_id = e.entrant_id or f.side_b_id = e.entrant_id
       )
       and not exists (
         select 1 from ierne_tennis.competition_entrants ce where ce.entrant_id = e.entrant_id
       )
  `;
}

// ---------- Bracket advancement -----------------------------------------------

function matchWinnerLoser(
  sideAId: string,
  sideBId: string,
  scoreA: number,
  scoreB: number,
): { winnerId: string; loserId: string } | null {
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB) || scoreA === scoreB) return null;
  if (isInternalEntrantId(sideAId) || isInternalEntrantId(sideBId)) return null;
  if (scoreA > scoreB) return { winnerId: sideAId, loserId: sideBId };
  return { winnerId: sideBId, loserId: sideAId };
}

/** After a knockout result, replace wo:/lo: slots in later fixtures with the real entrants. */
async function materializeBracketOutcome(
  sql: Sql,
  opts: { competitionId: string; sourceFixtureId: string; roundLabel: string; winnerId: string; loserId: string },
): Promise<void> {
  const code = String(opts.roundLabel || "").trim();
  if (!code || !opts.competitionId || !opts.sourceFixtureId) return;
  if (isInternalEntrantId(opts.winnerId) || isInternalEntrantId(opts.loserId)) return;
  const wo = winnerOfId(code);
  const lo = loserOfId(code);
  for (const [from, to] of [[wo, opts.winnerId], [lo, opts.loserId]] as const) {
    await sql`
      update ierne_tennis.fixtures set side_a_id = ${to}, updated_at = now()
       where competition_id = ${opts.competitionId}
         and fixture_id <> ${opts.sourceFixtureId}::uuid
         and side_a_id = ${from}
    `;
    await sql`
      update ierne_tennis.fixtures set side_b_id = ${to}, updated_at = now()
       where competition_id = ${opts.competitionId}
         and fixture_id <> ${opts.sourceFixtureId}::uuid
         and side_b_id = ${from}
    `;
  }
  await pruneUnusedInternalEntrants(sql);
}

/**
 * When a result is cleared or changed, put wo:/lo: back into unplayed later
 * fixtures (skipped if that entrant has already played a later match).
 */
async function restoreBracketPlaceholders(
  sql: Sql,
  opts: { competitionId: string; sourceFixtureId: string; roundLabel: string; winnerId: string; loserId: string },
): Promise<void> {
  const code = String(opts.roundLabel || "").trim();
  if (!code || !opts.competitionId || !opts.sourceFixtureId) return;
  if (isInternalEntrantId(opts.winnerId) || isInternalEntrantId(opts.loserId)) return;
  const wo = winnerOfId(code);
  const lo = loserOfId(code);
  await ensureInternalEntrants(sql, wo, lo);

  for (const [entrantId, placeholder] of [[opts.winnerId, wo], [opts.loserId, lo]] as const) {
    const advanced = await sql<{ ok: boolean }[]>`
      select exists(
        select 1 from ierne_tennis.fixtures f
         where f.competition_id = ${opts.competitionId}
           and f.fixture_id <> ${opts.sourceFixtureId}::uuid
           and (f.side_a_id = ${entrantId} or f.side_b_id = ${entrantId})
           and f.score_a is not null and f.score_b is not null
      ) as ok
    `;
    if (truthy(advanced[0]?.ok)) continue;
    await sql`
      update ierne_tennis.fixtures set side_a_id = ${placeholder}, updated_at = now()
       where competition_id = ${opts.competitionId}
         and fixture_id <> ${opts.sourceFixtureId}::uuid
         and side_a_id = ${entrantId}
         and score_a is null and score_b is null
    `;
    await sql`
      update ierne_tennis.fixtures set side_b_id = ${placeholder}, updated_at = now()
       where competition_id = ${opts.competitionId}
         and fixture_id <> ${opts.sourceFixtureId}::uuid
         and side_b_id = ${entrantId}
         and score_a is null and score_b is null
    `;
  }
}

type BracketFixture = {
  fixture_id: string;
  competition_id: string;
  stage: string;
  round_label: string;
  side_a_id: string;
  side_b_id: string;
  score_a: number | null;
  score_b: number | null;
};

async function syncBracketPlaceholdersForResult(
  sql: Sql,
  fixture: BracketFixture,
  nextScoreA: number | null,
  nextScoreB: number | null,
): Promise<void> {
  if (fixture.stage !== "knockout") return;
  const code = String(fixture.round_label || "").trim();
  if (!code) return;
  const prev = fixture.score_a != null && fixture.score_b != null
    ? matchWinnerLoser(fixture.side_a_id, fixture.side_b_id, Number(fixture.score_a), Number(fixture.score_b))
    : null;
  const next = nextScoreA != null && nextScoreB != null
    ? matchWinnerLoser(fixture.side_a_id, fixture.side_b_id, nextScoreA, nextScoreB)
    : null;
  if (prev && (!next || prev.winnerId !== next.winnerId || prev.loserId !== next.loserId)) {
    await restoreBracketPlaceholders(sql, {
      competitionId: fixture.competition_id,
      sourceFixtureId: fixture.fixture_id,
      roundLabel: code,
      winnerId: prev.winnerId,
      loserId: prev.loserId,
    });
  }
  if (next) {
    await materializeBracketOutcome(sql, {
      competitionId: fixture.competition_id,
      sourceFixtureId: fixture.fixture_id,
      roundLabel: code,
      winnerId: next.winnerId,
      loserId: next.loserId,
    });
  }
}

async function ensurePoolGroup(compId: string, competitionType: string): Promise<void> {
  const name = normalizeCompetitionType(competitionType) === "ladder" ? "Ladder" : "Knockout pool";
  await db()`
    insert into ierne_tennis.competition_groups (competition_id, group_id, name, display_order)
    values (${compId}, ${KNOCKOUT_GROUP_ID}, ${name}, 0)
    on conflict (competition_id, group_id) do update set name = excluded.name
  `;
}

async function removePoolGroupIfSafe(compId: string): Promise<void> {
  const sql = db();
  const rows = await sql<{ ok: boolean }[]>`
    select exists(
             select 1 from ierne_tennis.fixtures
              where competition_id = ${compId} and group_id = ${KNOCKOUT_GROUP_ID}
           )
        or exists(
             select 1 from ierne_tennis.competition_entrants
              where competition_id = ${compId} and group_id = ${KNOCKOUT_GROUP_ID}
           ) as ok
  `;
  if (truthy(rows[0]?.ok)) return;
  await sql`
    delete from ierne_tennis.competition_groups
     where competition_id = ${compId} and group_id = ${KNOCKOUT_GROUP_ID}
  `;
}

// ---------- Standings tiebreak --------------------------------------------------

type ShapedRow = {
  entrantId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  setDiff: number;
  gameDiff: number;
  points: number;
};

function applyTiebreaks(rows: ShapedRow[], h2h: HeadToHeadRow[]): ShapedRow[] {
  const sorted = [...rows].sort((a, b) =>
    (b.points - a.points) || (b.setDiff - a.setDiff) || (b.gameDiff - a.gameDiff) ||
    a.name.localeCompare(b.name)
  );
  if (sorted.length < 2) return sorted;
  const h2hMap = new Map<string, HeadToHeadRow>();
  for (const r of h2h) h2hMap.set(`${r.entrant_id}|${r.opponent_id}`, r);

  const result: ShapedRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (
      j < sorted.length &&
      sorted[j].points === sorted[i].points &&
      sorted[j].setDiff === sorted[i].setDiff &&
      sorted[j].gameDiff === sorted[i].gameDiff
    ) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      const ids = group.map((g) => g.entrantId);
      const mini = new Map<string, { pts: number; sets: number; games: number }>();
      for (const a of ids) {
        const s = { pts: 0, sets: 0, games: 0 };
        for (const b of ids) {
          if (a === b) continue;
          const row = h2hMap.get(`${a}|${b}`);
          if (!row) continue;
          s.pts += Number(row.h2h_points) || 0;
          s.sets += Number(row.h2h_set_diff) || 0;
          s.games += Number(row.h2h_game_diff) || 0;
        }
        mini.set(a, s);
      }
      group.sort((a, b) => {
        const sa = mini.get(a.entrantId)!;
        const sb = mini.get(b.entrantId)!;
        return (sb.pts - sa.pts) || (sb.sets - sa.sets) || (sb.games - sa.games) ||
          a.name.localeCompare(b.name);
      });
    }
    result.push(...group);
    i = j;
  }
  return result;
}

// ---------- GET handlers --------------------------------------------------------

async function handleGetCompetitions(): Promise<Response> {
  const rows = await db().unsafe(
    `select ${COMPETITION_COLUMNS} from ierne_tennis.competitions
      order by starts_on desc nulls last, competition_id desc`,
  );
  return jsonResponse({
    success: true,
    competitions: (rows as unknown as CompetitionRow[]).map(shapeCompetition),
  });
}

async function handleGetCompetitionGroups(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const compId = String(url.searchParams.get("compId") ?? "").trim();
  if (!compId) return errorResponse("compId required");
  const comp = await loadCompetition(compId);
  if (!comp) return errorResponse("Competition not found", 404);
  if (usesPoolGroup(comp.competition_type)) await ensurePoolGroup(compId, comp.competition_type);

  const pool = usesPoolGroup(comp.competition_type);
  const rows = await db()<{ group_id: string; name: string; display_order: number; player_count: number }[]>`
    select cg.group_id, cg.name, cg.display_order,
           (select count(*)::int from ierne_tennis.competition_entrants ce
             where ce.competition_id = cg.competition_id and ce.group_id = cg.group_id) as player_count
      from ierne_tennis.competition_groups cg
     where cg.competition_id = ${compId}
       and (${pool} or cg.group_id <> ${KNOCKOUT_GROUP_ID})
     order by cg.display_order asc, cg.group_id asc
  `;
  return jsonResponse({
    success: true,
    competition: shapeCompetition(comp),
    groups: rows.map((r) => ({
      groupId: r.group_id,
      name: r.name,
      displayOrder: r.display_order,
      playerCount: r.player_count,
    })),
  });
}

/** People list (no comp), or a comp's roster of entrants. */
async function handleGetPlayers(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const compParam = url.searchParams.get("comp");
  const groupParam = url.searchParams.get("group");
  const sql = db();

  if (!compParam && !groupParam) {
    const rows = await sql<{
      player_id: string;
      player_name: string;
      gender: string | null;
      active: boolean;
      comp_count: number;
      match_count: number;
      claimed: boolean;
    }[]>`
      with mine as (
        select p.player_id, e.entrant_id
          from ierne_tennis.players p
          join ierne_tennis.entrants e on e.player1_id = p.player_id or e.player2_id = p.player_id
      )
      select p.player_id, p.player_name, p.gender, p.active,
             (select count(distinct x.competition_id)::int from (
                select ce.competition_id from ierne_tennis.competition_entrants ce
                  join mine m on m.entrant_id = ce.entrant_id where m.player_id = p.player_id
                union
                select f.competition_id from ierne_tennis.fixtures f
                  join mine m on m.entrant_id in (f.side_a_id, f.side_b_id) where m.player_id = p.player_id
             ) x) as comp_count,
             (select count(*)::int from ierne_tennis.fixtures f
                join mine m on m.entrant_id in (f.side_a_id, f.side_b_id)
               where m.player_id = p.player_id and f.score_a is not null and f.score_b is not null
             ) as match_count,
             exists(select 1 from ierne_tennis.accounts a where a.player_id = p.player_id) as claimed
        from ierne_tennis.players p
       order by p.player_name asc
    `;
    return jsonResponse({
      success: true,
      players: rows.map((p) => ({
        playerId: p.player_id,
        playerName: p.player_name,
        gender: p.gender,
        active: p.active,
        compCount: p.comp_count,
        matchCount: p.match_count,
        claimed: truthy(p.claimed),
      })),
    });
  }

  const compId = await resolveCompId(compParam, url.searchParams.get("competitionType"));
  const rows = await sql<(CompetitionEntrantRow & EntrantRow)[]>`
    select ce.competition_id, ce.group_id, ce.entrant_id, ce.seed, ce.ladder_start_position, ce.joined_at,
           e.kind, e.player1_id, e.player2_id, e.entrant_name, e.active
      from ierne_tennis.competition_entrants ce
      join ierne_tennis.entrants_v e on e.entrant_id = ce.entrant_id
     where ce.competition_id = ${compId}
       and (${groupParam}::text is null or ce.group_id = ${groupParam})
       and e.kind in ('single', 'pair')
     order by e.entrant_name asc
  `;
  return jsonResponse({
    success: true,
    compId,
    players: (rows as unknown as Array<CompetitionEntrantRow & EntrantRow>).map((r) => ({
      playerId: r.entrant_id,
      entrantId: r.entrant_id,
      playerName: r.entrant_name,
      kind: r.kind,
      memberIds: entrantMemberIds(r),
      groupId: r.group_id,
      seed: r.seed,
      ladderStartPosition: r.ladder_start_position,
      active: r.active,
    })),
  });
}

async function handleGetEntrants(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kind = String(url.searchParams.get("kind") ?? "").trim();
  const rows = await db()<(EntrantRow & { comp_count: number; match_count: number })[]>`
    select e.entrant_id, e.kind, e.player1_id, e.player2_id, e.entrant_name, e.active,
           (select count(*)::int from ierne_tennis.competition_entrants ce where ce.entrant_id = e.entrant_id) as comp_count,
           (select count(*)::int from ierne_tennis.fixtures f
             where (f.side_a_id = e.entrant_id or f.side_b_id = e.entrant_id)
               and f.score_a is not null) as match_count
      from ierne_tennis.entrants_v e
     where e.kind in ('single', 'pair')
       and (${kind || null}::text is null or e.kind = ${kind || null})
     order by e.entrant_name asc
  `;
  return jsonResponse({
    success: true,
    entrants: rows.map((r) => ({
      entrantId: r.entrant_id,
      kind: r.kind,
      name: r.entrant_name,
      memberIds: entrantMemberIds(r),
      active: r.active,
      compCount: r.comp_count,
      matchCount: r.match_count,
    })),
  });
}

async function handleGetPlayerComps(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const playerId = String(url.searchParams.get("playerId") ?? "").trim();
  if (!playerId) return errorResponse("playerId required");
  const rows = await db()<{
    competition_id: string;
    name: string;
    is_current: boolean;
    competition_type: string;
    format: string;
    parent_competition_id: string | null;
    entrant_name: string;
    kind: string;
  }[]>`
    with mine as (
      select entrant_id, entrant_name, kind from ierne_tennis.entrants_v
       where player1_id = ${playerId} or player2_id = ${playerId}
    )
    select distinct c.competition_id, c.name, c.is_current, c.competition_type, c.format,
           c.parent_competition_id, c.starts_on, m.entrant_name, m.kind
      from mine m
      join ierne_tennis.competition_entrants ce on ce.entrant_id = m.entrant_id
      join ierne_tennis.competitions c on c.competition_id = ce.competition_id
     order by c.starts_on desc nulls last, c.competition_id desc
  `;
  return jsonResponse({
    success: true,
    playerId,
    competitions: rows.map((r) => ({
      compId: r.competition_id,
      name: r.name,
      isCurrent: r.is_current,
      competitionType: r.competition_type,
      format: r.format,
      parentCompId: r.parent_competition_id,
      entrantName: r.entrant_name,
      entrantKind: r.kind,
    })),
  });
}

function sideName(id: string, map: Map<string, EntrantRow>): string {
  if (isBracketPlaceholderId(id)) return placeholderLabel(id);
  return map.get(id)?.entrant_name ?? "";
}

async function handleGetFixtures(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const compId = await resolveCompId(url.searchParams.get("comp"), url.searchParams.get("competitionType"));
  const sql = db();
  const [entrants, fixtureRows] = await Promise.all([
    loadEntrantMap(),
    sql<FixtureRow[]>`
      select fixture_id, competition_id, group_id, stage, round_label, round_name,
             side_a_id, side_b_id,
             to_char(match_date, 'YYYY-MM-DD') as match_date,
             sort_order, sets_to_win, games_per_set, final_set,
             score_a, score_b, games_a, games_b, set_scores, result_type,
             result_entered_by, result_approved, result_approved_by, result_approved_at,
             result_posted_at, challenged_at, to_char(play_by, 'YYYY-MM-DD') as play_by
        from ierne_tennis.fixtures
       where competition_id = ${compId}
       order by sort_order asc, round_label asc
    `,
  ]);

  const fixtures = (fixtureRows as unknown as FixtureRow[]).map((r) => {
    const hasResult = r.score_a != null && r.score_b != null;
    const sets = Array.isArray(r.set_scores) ? r.set_scores : [];
    return {
      fixtureId: r.fixture_id,
      "Game Week": r.round_label,
      "Group": r.group_id,
      "Stage": r.stage,
      "Player A": sideName(r.side_a_id, entrants),
      "Player B": sideName(r.side_b_id, entrants),
      "Match Date": r.match_date ?? "",
      "Result": hasResult ? formatSetLine(sets) || `${r.score_a}-${r.score_b}` : "",
      scoreA: r.score_a,
      scoreB: r.score_b,
      gamesA: r.games_a,
      gamesB: r.games_b,
      sets,
      setLine: formatSetLine(sets),
      sortOrder: r.sort_order,
      setsToWin: Number(r.sets_to_win),
      gamesPerSet: Number(r.games_per_set),
      finalSet: r.final_set,
      roundName: r.round_name ?? "",
      resultType: r.result_type,
      resultEnteredBy: r.result_entered_by ?? "",
      resultApproved: hasResult ? r.result_approved !== false : true,
      resultApprovedBy: r.result_approved && r.result_approved_by ? r.result_approved_by : "",
      resultApprovedAt: r.result_approved ? isoOrNull(r.result_approved_at) : null,
      playerAId: r.side_a_id,
      playerBId: r.side_b_id,
      sideAPlayerIds: entrantMemberIds(entrants.get(r.side_a_id)),
      sideBPlayerIds: entrantMemberIds(entrants.get(r.side_b_id)),
      resultPostedAt: isoOrNull(r.result_posted_at),
      challengedAt: isoOrNull(r.challenged_at),
      playBy: r.play_by ?? "",
    };
  });
  return jsonResponse({ success: true, compId, fixtures });
}

async function handleGetStandings(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const compId = await resolveCompId(url.searchParams.get("comp"), url.searchParams.get("competitionType"));
  const sql = db();
  const [comp, entrants, groups, members, standings, h2h, unapproved] = await Promise.all([
    loadCompetition(compId),
    loadEntrantMap(),
    loadCompetitionGroups(compId),
    sql<{ group_id: string; entrant_id: string }[]>`
      select group_id, entrant_id from ierne_tennis.competition_entrants where competition_id = ${compId}
    `,
    sql<StandingRow[]>`
      select group_id, entrant_id, played, won, lost, set_diff, game_diff, points
        from ierne_tennis.league_standings_v where competition_id = ${compId}
    `,
    sql<HeadToHeadRow[]>`
      select group_id, entrant_id, opponent_id, h2h_set_diff, h2h_game_diff, h2h_points
        from ierne_tennis.head_to_head_v where competition_id = ${compId}
    `,
    sql<{ group_id: string; side_a_id: string; side_b_id: string }[]>`
      select group_id, side_a_id, side_b_id from ierne_tennis.fixtures
       where competition_id = ${compId} and stage = 'group' and result_approved = false
         and score_a is not null and score_b is not null
    `,
  ]);

  const standingsMap = new Map<string, StandingRow>();
  for (const s of standings as unknown as StandingRow[]) standingsMap.set(`${s.group_id}|${s.entrant_id}`, s);
  const unapprovedKeys = new Set<string>();
  for (const fx of unapproved) {
    unapprovedKeys.add(`${fx.group_id}|${fx.side_a_id}`);
    unapprovedKeys.add(`${fx.group_id}|${fx.side_b_id}`);
  }
  const h2hAll = h2h as unknown as HeadToHeadRow[];

  const groupsOut = groups
    .filter((g) => g.group_id !== KNOCKOUT_GROUP_ID)
    .map((grp) => {
      const shaped: ShapedRow[] = members
        .filter((m) => m.group_id === grp.group_id)
        .map((m) => {
          const s = standingsMap.get(`${grp.group_id}|${m.entrant_id}`);
          return {
            entrantId: m.entrant_id,
            name: entrants.get(m.entrant_id)?.entrant_name ?? m.entrant_id,
            played: Number(s?.played ?? 0),
            won: Number(s?.won ?? 0),
            lost: Number(s?.lost ?? 0),
            setDiff: Number(s?.set_diff ?? 0),
            gameDiff: Number(s?.game_diff ?? 0),
            points: Number(s?.points ?? 0),
          };
        });
      const ordered = applyTiebreaks(shaped, h2hAll.filter((r) => r.group_id === grp.group_id));
      return {
        groupId: grp.group_id,
        name: grp.name,
        rows: ordered.map((r) => ({
          entrantId: r.entrantId,
          "Player Name": r.name,
          P: r.played,
          W: r.won,
          L: r.lost,
          "Sets +/-": r.setDiff,
          "Games +/-": r.gameDiff,
          Pts: r.points,
          unapproved: unapprovedKeys.has(`${grp.group_id}|${r.entrantId}`),
        })),
      };
    });

  return jsonResponse({
    success: true,
    compId,
    competition: comp ? shapeCompetition(comp) : null,
    groups: groupsOut,
  });
}

// ---------- Ladder ----------------------------------------------------------------

type LadderState = {
  comp: CompetitionRow;
  order: string[];
  entrants: Map<string, EntrantRow>;
  roster: CompetitionEntrantRow[];
  fixtures: FixtureRow[];
};

async function computeLadder(compId: string): Promise<LadderState> {
  const comp = await loadCompetition(compId);
  if (!comp) throw new ApiError("Competition not found", 404);
  if (comp.competition_type !== "ladder") throw new ApiError("That competition is not a ladder.");
  const sql = db();
  const [roster, fixtures] = await Promise.all([
    sql<CompetitionEntrantRow[]>`
      select competition_id, group_id, entrant_id, seed, ladder_start_position, joined_at
        from ierne_tennis.competition_entrants where competition_id = ${compId}
    `,
    sql<FixtureRow[]>`
      select fixture_id, competition_id, group_id, stage, round_label, round_name,
             side_a_id, side_b_id, to_char(match_date, 'YYYY-MM-DD') as match_date,
             sort_order, sets_to_win, games_per_set, final_set,
             score_a, score_b, games_a, games_b, set_scores, result_type,
             result_entered_by, result_approved, result_approved_by, result_approved_at,
             result_posted_at, challenged_at, to_char(play_by, 'YYYY-MM-DD') as play_by
        from ierne_tennis.fixtures
       where competition_id = ${compId} and stage = 'ladder'
       order by sort_order asc
    `,
  ]);
  const rosterRows = roster as unknown as CompetitionEntrantRow[];
  const entrants = await loadEntrantMap(rosterRows.map((r) => r.entrant_id));
  const ladderEntrants: LadderEntrant[] = rosterRows.map((r) => ({
    entrantId: r.entrant_id,
    startPosition: r.ladder_start_position,
    joinedAt: new Date(r.joined_at).getTime(),
    name: entrants.get(r.entrant_id)?.entrant_name ?? r.entrant_id,
  }));
  const results: LadderResult[] = (fixtures as unknown as FixtureRow[])
    .filter((f) => f.score_a != null && f.score_b != null)
    .map((f) => ({
      fixtureId: f.fixture_id,
      challengerId: f.side_a_id,
      defenderId: f.side_b_id,
      setsA: Number(f.score_a),
      setsB: Number(f.score_b),
      at: new Date((f.result_posted_at || f.challenged_at || 0) as string | Date).getTime(),
    }));
  const { order } = replayLadder(ladderEntrants, results);
  return { comp, order, entrants, roster: rosterRows, fixtures: fixtures as unknown as FixtureRow[] };
}

async function handleGetLadder(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const compId = await resolveCompId(url.searchParams.get("comp"), "ladder");
  let state: LadderState;
  try {
    state = await computeLadder(compId);
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }
  const record = new Map<string, { won: number; lost: number }>();
  const open = new Map<string, FixtureRow>();
  for (const f of state.fixtures) {
    if (f.score_a == null || f.score_b == null) {
      open.set(f.side_a_id, f);
      open.set(f.side_b_id, f);
      continue;
    }
    const aWon = Number(f.score_a) > Number(f.score_b);
    for (const [id, won] of [[f.side_a_id, aWon], [f.side_b_id, !aWon]] as const) {
      const r = record.get(id) ?? { won: 0, lost: 0 };
      if (won) r.won++; else r.lost++;
      record.set(id, r);
    }
  }
  const rows = state.order.map((id, idx) => {
    const e = state.entrants.get(id);
    const f = open.get(id);
    const rec = record.get(id) ?? { won: 0, lost: 0 };
    return {
      position: idx + 1,
      entrantId: id,
      name: e?.entrant_name ?? id,
      memberIds: entrantMemberIds(e),
      won: rec.won,
      lost: rec.lost,
      openChallenge: f
        ? {
          fixtureId: f.fixture_id,
          role: f.side_a_id === id ? "challenger" : "defender",
          opponentId: f.side_a_id === id ? f.side_b_id : f.side_a_id,
          opponentName: state.entrants.get(f.side_a_id === id ? f.side_b_id : f.side_a_id)?.entrant_name ?? "",
          playBy: f.play_by ?? "",
          challengedAt: isoOrNull(f.challenged_at),
        }
        : null,
    };
  });
  return jsonResponse({
    success: true,
    compId,
    competition: shapeCompetition(state.comp),
    rows,
  });
}

// ---------- Admin auth & POST envelope ------------------------------------------

type PostEnvelope = {
  action: string;
  data: Record<string, unknown>;
  adminToken?: string;
  sessionToken?: string;
};

const ADMIN_TOKEN_TTL_SEC = 24 * 60 * 60;

const ADMIN_POST_ACTIONS = new Set([
  "adminLogin",
  "upsertCompetition",
  "deleteCompetition",
  "upsertCompetitionGroup",
  "deleteCompetitionGroup",
  "upsertCompetitionEntrant",
  "upsertCompetitionPlayer",
  "upsertPlayer",
  "deletePlayer",
  "upsertPair",
  "deletePair",
  "upsertFixture",
  "generateFixtures",
  "deleteFixture",
  "approveFixtureResult",
  "cancelChallenge",
  "setLadderStartPositions",
  "issueInvite",
  "listInvites",
  "revokeInvite",
  "listAccounts",
  "disableAccount",
  "setAccountAdmin",
  "setAccountApprover",
]);

const ACCOUNT_ADMIN_ACTIONS = new Set([
  "issueInvite",
  "listInvites",
  "revokeInvite",
  "listAccounts",
  "disableAccount",
  "setAccountAdmin",
  "setAccountApprover",
]);

const PUBLIC_POST_ACTIONS = new Set(["register", "connect", "resetPassword", "signOut", "whoAmI"]);

const PLAYER_RESULT_ACTIONS = new Set([
  "updateFixtureResult",
  "getResultSlip",
  "uploadResultSlip",
  "commitResultSlip",
  "discardResultSlipSession",
  "removeResultSlip",
  "createChallenge",
]);

function getAdminSecret(): string {
  return (Deno.env.get("IERNE_TENNIS_ADMIN_SECRET") ?? "").trim();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqualBytes(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

async function signAdminPayload(secret: string, payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return base64UrlEncode(new Uint8Array(sig));
}

async function mintAdminToken(): Promise<{ token: string; expiresAt: string }> {
  const secret = getAdminSecret();
  if (!secret) throw new Error("Admin login unavailable");
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SEC;
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ exp })));
  const sig = await signAdminPayload(secret, payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  const secret = getAdminSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = base64UrlDecode(await signAdminPayload(secret, parts[0]!));
    if (!timingSafeEqualBytes(expected, base64UrlDecode(parts[1]!))) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]!))) as { exp?: number };
    const exp = Number(payload.exp);
    return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function parsePostEnvelope(req: Request): Promise<PostEnvelope | null> {
  if (req.method !== "POST") return null;
  const form = await req.formData().catch(() => null);
  const dataStr = form?.get("data");
  if (typeof dataStr !== "string") return null;
  try {
    const parsed = JSON.parse(dataStr) as Record<string, unknown>;
    const rawData = parsed.data;
    return {
      action: String(parsed.action ?? ""),
      data: typeof rawData === "object" && rawData !== null && !Array.isArray(rawData)
        ? rawData as Record<string, unknown>
        : {},
      adminToken: typeof parsed.adminToken === "string" ? parsed.adminToken : undefined,
      sessionToken: typeof parsed.sessionToken === "string" ? parsed.sessionToken : undefined,
    };
  } catch {
    return null;
  }
}

async function hasAdminPin(envelope: PostEnvelope): Promise<boolean> {
  const token = typeof envelope.adminToken === "string" ? envelope.adminToken.trim() : "";
  return !!token && await verifyAdminToken(token);
}

async function requireAdmin(envelope: PostEnvelope): Promise<Response | null> {
  if (await hasAdminPin(envelope)) return null;
  const token = typeof envelope.adminToken === "string" ? envelope.adminToken.trim() : "";
  const session = typeof envelope.sessionToken === "string" ? envelope.sessionToken.trim() : "";
  if (session) {
    const actor = await readPlayerSession(db(), session);
    if (actor?.isAdmin) return null;
  }
  if (!token && !session) {
    return unauthorizedResponse("Missing admin token. Unlock Admin Mode from the site menu, then try again.");
  }
  return unauthorizedResponse("Invalid or expired admin session. Unlock Admin Mode again from the menu.");
}

/** Admin PIN, an admin account, or an approver account. */
async function requireScoreApprover(envelope: PostEnvelope): Promise<Response | null> {
  if (await hasAdminPin(envelope)) return null;
  const token = typeof envelope.adminToken === "string" ? envelope.adminToken.trim() : "";
  const session = typeof envelope.sessionToken === "string" ? envelope.sessionToken.trim() : "";
  if (session) {
    const actor = await readPlayerSession(db(), session);
    if (actor?.isAdmin || actor?.isApprover) return null;
  }
  if (!token && !session) return unauthorizedResponse("Sign in as an approver, or unlock Admin Mode.");
  return unauthorizedResponse("This score can only be approved by an approver or an admin.");
}

async function handleAdminLogin(data: Record<string, unknown>): Promise<Response> {
  const secret = getAdminSecret();
  if (!secret) return errorResponse("Admin login not configured", 503);
  const pin = String(data.pin ?? data.secret ?? "");
  if (!timingSafeEqualStr(pin, secret)) return unauthorizedResponse("Invalid PIN");
  const { token, expiresAt } = await mintAdminToken();
  return jsonResponse({ success: true, token, expiresAt });
}

// ---------- Players and pairs ---------------------------------------------------

function slugify(name: string): string {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pairEntrantId(p1: string, p2: string): { id: string; a: string; b: string } {
  const [a, b] = [p1, p2].sort();
  return { id: `pr:${a}+${b}`, a: a!, b: b! };
}

async function handleUpsertPlayer(data: Record<string, unknown>): Promise<Response> {
  const playerName = String(data.playerName ?? "").trim().replace(/\s+/g, " ");
  const playerId = String(data.playerId ?? "").trim() || slugify(playerName);
  if (!playerId || !playerName) return errorResponse("playerName required");
  if (isInternalEntrantId(playerId) || playerId.startsWith("pr:") || playerId.includes("+")) {
    return errorResponse("That player id is reserved.");
  }
  if (playerName.includes(" / ")) return errorResponse("A player name cannot contain ' / '.");
  const genderRaw = String(data.gender ?? "").trim().toUpperCase();
  const gender = genderRaw === "M" || genderRaw === "F" ? genderRaw : null;
  const active = data.active === undefined ? true : Boolean(data.active);
  try {
    await db()`
      insert into ierne_tennis.players (player_id, player_name, gender, active, updated_at)
      values (${playerId}, ${playerName}, ${gender}, ${active}, now())
      on conflict (player_id) do update set
        player_name = excluded.player_name,
        gender = excluded.gender,
        active = excluded.active,
        updated_at = now()
    `;
  } catch (err) {
    if (String((err as { code?: string })?.code) === "23505") {
      return errorResponse("Another player already has that name.", 409);
    }
    throw err;
  }
  return jsonResponse({ success: true, playerId });
}

async function handleDeletePlayer(data: Record<string, unknown>): Promise<Response> {
  const playerId = String(data.playerId ?? "").trim();
  if (!playerId) return errorResponse("playerId required");
  const sql = db();
  const used = await sql<{ ok: boolean }[]>`
    select exists(
      select 1 from ierne_tennis.entrants e
       where (e.player1_id = ${playerId} or e.player2_id = ${playerId})
         and (
           exists(select 1 from ierne_tennis.fixtures f where f.side_a_id = e.entrant_id or f.side_b_id = e.entrant_id)
           or exists(select 1 from ierne_tennis.competition_entrants ce where ce.entrant_id = e.entrant_id)
         )
    ) as ok
  `;
  if (truthy(used[0]?.ok)) {
    return errorResponse(
      "Cannot delete player: they are in a competition or have fixtures. Remove them from those first.",
      409,
    );
  }
  await sql.begin(async (tx) => {
    await tx`delete from ierne_tennis.entrants where player1_id = ${playerId} or player2_id = ${playerId}`;
    await tx`delete from ierne_tennis.players where player_id = ${playerId}`;
  });
  return jsonResponse({ success: true });
}

async function ensureSingleEntrant(sql: Sql, playerId: string): Promise<string> {
  const found = await sql<{ player_id: string }[]>`
    select player_id from ierne_tennis.players where player_id = ${playerId}
  `;
  if (!found.length) throw new ApiError("Player not found", 404);
  await sql`
    insert into ierne_tennis.entrants (entrant_id, kind, player1_id)
    values (${playerId}, 'single', ${playerId})
    on conflict (entrant_id) do nothing
  `;
  return playerId;
}

async function ensurePairEntrant(sql: Sql, p1: string, p2: string): Promise<string> {
  if (!p1 || !p2) throw new ApiError("Choose two players for the pair.");
  if (p1 === p2) throw new ApiError("A pair needs two different players.");
  const { id, a, b } = pairEntrantId(p1, p2);
  const found = await sql<{ player_id: string }[]>`
    select player_id from ierne_tennis.players where player_id in (${a}, ${b})
  `;
  if (found.length !== 2) throw new ApiError("Player not found", 404);
  await sql`
    insert into ierne_tennis.entrants (entrant_id, kind, player1_id, player2_id)
    values (${id}, 'pair', ${a}, ${b})
    on conflict (entrant_id) do nothing
  `;
  return id;
}

async function handleUpsertPair(data: Record<string, unknown>): Promise<Response> {
  try {
    const id = await ensurePairEntrant(db(), String(data.player1Id ?? "").trim(), String(data.player2Id ?? "").trim());
    return jsonResponse({ success: true, entrantId: id });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }
}

async function handleDeletePair(data: Record<string, unknown>): Promise<Response> {
  const entrantId = String(data.entrantId ?? "").trim();
  if (!entrantId.startsWith("pr:")) return errorResponse("entrantId of a pair required");
  const sql = db();
  const used = await sql<{ ok: boolean }[]>`
    select exists(select 1 from ierne_tennis.fixtures where side_a_id = ${entrantId} or side_b_id = ${entrantId})
        or exists(select 1 from ierne_tennis.competition_entrants where entrant_id = ${entrantId}) as ok
  `;
  if (truthy(used[0]?.ok)) {
    return errorResponse("Cannot delete pair: it is in a competition or has fixtures.", 409);
  }
  await sql`delete from ierne_tennis.entrants where entrant_id = ${entrantId} and kind = 'pair'`;
  return jsonResponse({ success: true });
}

/**
 * Add, move or remove an entrant in a competition roster.
 * data: compId, groupId, and one of entrantId | playerId (singles) |
 * player1Id + player2Id (doubles). Optional seed, ladderStartPosition. remove: true.
 */
async function handleUpsertCompetitionEntrant(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  if (!compId) return errorResponse("compId required");
  const sql = db();
  const comp = await loadCompetition(compId);
  if (!comp) return errorResponse("Competition not found", 404);
  try {
    let entrantId = String(data.entrantId ?? "").trim();
    const p1 = String(data.player1Id ?? "").trim();
    const p2 = String(data.player2Id ?? "").trim();
    const playerId = String(data.playerId ?? "").trim();
    if (!entrantId && p1 && p2) entrantId = await ensurePairEntrant(sql, p1, p2);
    if (!entrantId && playerId) {
      entrantId = playerId.startsWith("pr:") ? playerId : await ensureSingleEntrant(sql, playerId);
    }
    if (!entrantId) return errorResponse("entrantId, playerId or player1Id + player2Id required");

    if (Boolean(data.remove)) {
      await sql`
        delete from ierne_tennis.competition_entrants
         where competition_id = ${compId} and entrant_id = ${entrantId}
      `;
      return jsonResponse({ success: true });
    }

    const entrant = (await loadEntrantMap([entrantId])).get(entrantId);
    if (!entrant) {
      if (comp.format === "singles") entrantId = await ensureSingleEntrant(sql, entrantId);
      else return errorResponse("Entrant not found", 404);
    }
    const e = (await loadEntrantMap([entrantId])).get(entrantId)!;
    if (comp.format === "singles" && e.kind !== "single") {
      return errorResponse("This is a singles competition: add individual players.");
    }
    if (comp.format !== "singles" && e.kind !== "pair") {
      return errorResponse("This is a doubles competition: add pairs, not individual players.");
    }

    // A player may only appear once per competition (e.g. not in two pairs).
    const members = entrantMemberIds(e);
    const clash = await sql<{ entrant_name: string }[]>`
      select v.entrant_name
        from ierne_tennis.competition_entrants ce
        join ierne_tennis.entrants_v v on v.entrant_id = ce.entrant_id
       where ce.competition_id = ${compId}
         and ce.entrant_id <> ${entrantId}
         and (v.player1_id = any(${members}::text[]) or v.player2_id = any(${members}::text[]))
       limit 1
    `;
    if (clash.length) {
      return errorResponse(`A player in this pair is already entered as ${clash[0].entrant_name}.`, 409);
    }

    let groupId = String(data.groupId ?? "").trim();
    if (usesPoolGroup(comp.competition_type)) {
      await ensurePoolGroup(compId, comp.competition_type);
      groupId = KNOCKOUT_GROUP_ID;
    }
    if (!groupId) return errorResponse("groupId required when not removing");
    const grp = await sql<{ ok: boolean }[]>`
      select exists(select 1 from ierne_tennis.competition_groups
                     where competition_id = ${compId} and group_id = ${groupId}) as ok
    `;
    if (!truthy(grp[0]?.ok)) {
      return errorResponse("That group is not part of this competition. Add the group first.");
    }
    const hasSeed = Object.prototype.hasOwnProperty.call(data, "seed");
    const seed = data.seed === "" || data.seed == null ? null : Math.trunc(Number(data.seed));
    const hasStart = Object.prototype.hasOwnProperty.call(data, "ladderStartPosition");
    const start = data.ladderStartPosition === "" || data.ladderStartPosition == null
      ? null
      : Math.trunc(Number(data.ladderStartPosition));
    await sql`
      insert into ierne_tennis.competition_entrants
        (competition_id, entrant_id, group_id, seed, ladder_start_position, updated_at)
      values (${compId}, ${entrantId}, ${groupId}, ${seed}, ${start}, now())
      on conflict (competition_id, entrant_id) do update set
        group_id = excluded.group_id,
        seed = case when ${hasSeed} then excluded.seed else ierne_tennis.competition_entrants.seed end,
        ladder_start_position = case when ${hasStart} then excluded.ladder_start_position
                                     else ierne_tennis.competition_entrants.ladder_start_position end,
        updated_at = now()
    `;
    return jsonResponse({ success: true, entrantId });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }
}

// ---------- Competitions and groups -----------------------------------------------

function smallIntIn(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.trunc(n) !== n || n < min || n > max) return null;
  return n;
}

async function handleUpsertCompetition(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  const name = String(data.name ?? "").trim();
  if (!compId || !name) return errorResponse("compId and name required");
  const existing = await loadCompetition(compId);
  const startsOn = data.startsOn ? String(data.startsOn) : null;
  const endsOn = data.endsOn ? String(data.endsOn) : null;
  const isCurrent = Boolean(data.isCurrent);
  const competitionType = normalizeCompetitionType(String(data.competitionType ?? existing?.competition_type ?? "league"));
  const format = normalizeFormat(data.format ?? existing?.format);
  const parentCompId = data.parentCompId != null && data.parentCompId !== "" ? String(data.parentCompId).trim() : null;

  const fallbackFormat: MatchFormat = existing ? parseMatchFormat(existing) : { setsToWin: 2, gamesPerSet: 6, finalSet: "match_tiebreak" };
  const mf = readFormatInput(data, fallbackFormat);
  if (!mf) return errorResponse("Invalid match format: sets to win 1–3, games per set 4, 6 or 8.");
  const winPoints = smallIntIn(data.winPoints, existing?.win_points ?? 2, 0, 10);
  const lossPoints = smallIntIn(data.lossPoints, existing?.loss_points ?? 0, 0, 10);
  const setPoints = smallIntIn(data.setPoints, existing?.set_points ?? 0, 0, 10);
  const lossBonus = smallIntIn(data.lossWithSetBonus, existing?.loss_with_set_bonus ?? 0, 0, 10);
  if (winPoints == null || lossPoints == null || setPoints == null || lossBonus == null) {
    return errorResponse("Points must be whole numbers from 0 to 10.");
  }
  const range = smallIntIn(data.ladderChallengeRange, existing?.ladder_challenge_range ?? 3, 1, 20);
  const days = smallIntIn(data.ladderChallengeDays, existing?.ladder_challenge_days ?? 14, 1, 90);
  if (range == null || days == null) {
    return errorResponse("Ladder range must be 1–20 places and the challenge period 1–90 days.");
  }

  if (existing && existing.format !== format) {
    const rosterCount = await db()<{ cnt: number }[]>`
      select count(*)::int as cnt from ierne_tennis.competition_entrants where competition_id = ${compId}
    `;
    if (Number(rosterCount[0]?.cnt) > 0) {
      return errorResponse("Remove everyone from the roster before switching between singles and doubles.", 409);
    }
  }

  await db()`
    insert into ierne_tennis.competitions (
      competition_id, name, starts_on, ends_on, is_current, competition_type, format, parent_competition_id,
      sets_to_win, games_per_set, final_set, win_points, loss_points, set_points, loss_with_set_bonus,
      ladder_challenge_range, ladder_challenge_days
    ) values (
      ${compId}, ${name}, ${startsOn}, ${endsOn}, ${isCurrent}, ${competitionType}, ${format}, ${parentCompId},
      ${mf.setsToWin}, ${mf.gamesPerSet}, ${mf.finalSet}, ${winPoints}, ${lossPoints}, ${setPoints}, ${lossBonus},
      ${range}, ${days}
    )
    on conflict (competition_id) do update set
      name = excluded.name,
      starts_on = excluded.starts_on,
      ends_on = excluded.ends_on,
      is_current = excluded.is_current,
      competition_type = excluded.competition_type,
      format = excluded.format,
      parent_competition_id = excluded.parent_competition_id,
      sets_to_win = excluded.sets_to_win,
      games_per_set = excluded.games_per_set,
      final_set = excluded.final_set,
      win_points = excluded.win_points,
      loss_points = excluded.loss_points,
      set_points = excluded.set_points,
      loss_with_set_bonus = excluded.loss_with_set_bonus,
      ladder_challenge_range = excluded.ladder_challenge_range,
      ladder_challenge_days = excluded.ladder_challenge_days,
      updated_at = now()
  `;

  // Unplayed fixtures follow a change of match format.
  if (existing) {
    await db()`
      update ierne_tennis.fixtures
         set sets_to_win = ${mf.setsToWin}, games_per_set = ${mf.gamesPerSet}, final_set = ${mf.finalSet},
             updated_at = now()
       where competition_id = ${compId} and score_a is null
         and sets_to_win = ${existing.sets_to_win} and games_per_set = ${existing.games_per_set}
         and final_set = ${existing.final_set}
    `;
  }

  if (usesPoolGroup(competitionType)) await ensurePoolGroup(compId, competitionType);
  else await removePoolGroupIfSafe(compId);
  return jsonResponse({ success: true });
}

async function handleDeleteCompetition(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  if (!compId) return errorResponse("compId required");
  const sql = db();
  if (!(await loadCompetition(compId))) return errorResponse("Competition not found", 404);
  const children = await sql<{ ok: boolean }[]>`
    select exists(select 1 from ierne_tennis.competitions where parent_competition_id = ${compId}) as ok
  `;
  if (truthy(children[0]?.ok)) {
    return errorResponse("Cannot delete competition: child competitions still reference it.", 409);
  }
  const results = await sql<{ ok: boolean }[]>`
    select exists(
      select 1 from ierne_tennis.fixtures
       where competition_id = ${compId} and score_a is not null and score_b is not null
         and side_a_id <> ${BYE_ENTRANT_ID} and side_b_id <> ${BYE_ENTRANT_ID}
    ) as ok
  `;
  if (truthy(results[0]?.ok)) {
    return errorResponse(
      "Cannot delete this competition while it still has results. Delete the results first, then try again.",
      409,
    );
  }
  const slipRows = await sql<{ fixture_id: string; result_slip_path: string | null }[]>`
    select fixture_id, result_slip_path from ierne_tennis.fixtures where competition_id = ${compId}
  `;
  await sql`delete from ierne_tennis.fixtures where competition_id = ${compId}`;
  await sql`delete from ierne_tennis.competitions where competition_id = ${compId}`;
  await pruneUnusedInternalEntrants(sql);
  for (const row of slipRows) {
    const paths = [resultSlipPendingPath(row.fixture_id), resultSlipCommittedPath(row.fixture_id)];
    if (row.result_slip_path) paths.push(row.result_slip_path);
    await deleteSlipPaths(paths);
  }
  return jsonResponse({ success: true });
}

async function handleUpsertCompetitionGroup(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  const groupId = String(data.groupId ?? "").trim();
  const name = String(data.name ?? "").trim();
  const displayOrder = data.displayOrder !== undefined && data.displayOrder !== "" ? Number(data.displayOrder) : 0;
  if (!compId || !groupId || !name) return errorResponse("compId, groupId and name required");
  if (groupId === KNOCKOUT_GROUP_ID) return errorResponse("That group id is reserved.");
  if (!Number.isFinite(displayOrder)) return errorResponse("displayOrder must be a number");
  await db()`
    insert into ierne_tennis.competition_groups (competition_id, group_id, name, display_order)
    values (${compId}, ${groupId}, ${name}, ${Math.trunc(displayOrder)})
    on conflict (competition_id, group_id) do update set
      name = excluded.name, display_order = excluded.display_order, updated_at = now()
  `;
  return jsonResponse({ success: true });
}

async function handleDeleteCompetitionGroup(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  const groupId = String(data.groupId ?? "").trim();
  if (!compId || !groupId) return errorResponse("compId and groupId required");
  const sql = db();
  const used = await sql<{ ok: boolean }[]>`
    select exists(select 1 from ierne_tennis.fixtures where competition_id = ${compId} and group_id = ${groupId})
        or exists(select 1 from ierne_tennis.competition_entrants where competition_id = ${compId} and group_id = ${groupId}) as ok
  `;
  if (truthy(used[0]?.ok)) {
    return errorResponse("Cannot delete group: entrants or fixtures still reference it for this competition.", 409);
  }
  await sql`delete from ierne_tennis.competition_groups where competition_id = ${compId} and group_id = ${groupId}`;
  return jsonResponse({ success: true });
}

// ---------- Fixtures --------------------------------------------------------------

/** Create or edit a fixture's pairing, round, date and match format. Results are separate. */
async function handleUpsertFixture(data: Record<string, unknown>): Promise<Response> {
  const fixtureId = data.fixtureId ? String(data.fixtureId).trim() : "";
  const compId = String(data.compId ?? "").trim();
  const stage = String(data.stage ?? "").trim();
  const roundLabel = String(data.roundLabel ?? "").trim();
  const roundNameRaw = data.roundName;
  const roundName = roundNameRaw === undefined || roundNameRaw === null || roundNameRaw === "" ? null : String(roundNameRaw).trim();
  const sideAId = String(data.playerAId ?? data.sideAId ?? "").trim();
  const sideBId = String(data.playerBId ?? data.sideBId ?? "").trim();
  const groupId = data.groupId === undefined || data.groupId === null || data.groupId === "" ? null : String(data.groupId);
  const matchDate = data.matchDate ? String(data.matchDate) : null;
  const playBy = data.playBy ? String(data.playBy) : null;
  const sortOrder = data.sortOrder !== undefined && data.sortOrder !== "" ? Number(data.sortOrder) : 0;

  if (!compId || !roundLabel || !sideAId || !sideBId) {
    return errorResponse("compId, roundLabel, playerAId, playerBId required");
  }
  if (stage !== "group" && stage !== "knockout" && stage !== "ladder") {
    return errorResponse("stage must be group, knockout or ladder");
  }
  if (stage === "group" && !groupId) return errorResponse("groupId required for group stage");
  if (sideAId === sideBId) return errorResponse("The two sides must be different");
  if (!Number.isFinite(sortOrder)) return errorResponse("sortOrder must be a number");

  const comp = await loadCompetition(compId);
  if (!comp) return errorResponse("Competition not found", 404);
  const sql = db();
  const priorRows = fixtureId
    ? await sql<(BracketFixture & { sets_to_win: number; games_per_set: number; final_set: string })[]>`
        select fixture_id, competition_id, stage, round_label, side_a_id, side_b_id, score_a, score_b,
               sets_to_win, games_per_set, final_set
          from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
      `
    : [];
  const prior = priorRows[0];
  if (fixtureId && !prior) return errorResponse("Fixture not found", 404);

  const mf = readFormatInput(data, prior ? parseMatchFormat(prior) : parseMatchFormat(comp));
  if (!mf) return errorResponse("Invalid match format: sets to win 1–3, games per set 4, 6 or 8.");
  if (prior && prior.score_a != null && (
    mf.setsToWin !== Number(prior.sets_to_win) || mf.gamesPerSet !== Number(prior.games_per_set) ||
    mf.finalSet !== prior.final_set
  )) {
    return errorResponse("Clear the result before changing this match's format.", 409);
  }

  // Real sides must be in the entrants table; singles entrants are created on demand.
  await ensureInternalEntrants(sql, sideAId, sideBId);
  try {
    for (const id of [sideAId, sideBId]) {
      if (isInternalEntrantId(id)) continue;
      const known = await loadEntrantMap([id]);
      if (!known.get(id)) {
        if (id.startsWith("pr:")) return errorResponse(`Unknown pair: ${id}`, 404);
        await ensureSingleEntrant(sql, id);
      }
    }
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }

  const so = Math.trunc(sortOrder);
  if (prior) {
    await sql`
      update ierne_tennis.fixtures set
        competition_id = ${compId}, group_id = ${groupId}, stage = ${stage},
        round_label = ${roundLabel}, round_name = ${roundName},
        side_a_id = ${sideAId}, side_b_id = ${sideBId},
        match_date = ${matchDate}, play_by = coalesce(${playBy}::date, play_by), sort_order = ${so},
        sets_to_win = ${mf.setsToWin}, games_per_set = ${mf.gamesPerSet}, final_set = ${mf.finalSet},
        updated_at = now()
      where fixture_id = ${fixtureId}::uuid
    `;
    // Pairing may have changed: restore from the old pairing, then re-apply the result.
    if (prior.score_a != null && prior.score_b != null &&
        (prior.side_a_id !== sideAId || prior.side_b_id !== sideBId || prior.round_label !== roundLabel)) {
      await syncBracketPlaceholdersForResult(sql, prior, null, null);
      await syncBracketPlaceholdersForResult(sql, {
        ...prior,
        stage,
        round_label: roundLabel,
        side_a_id: sideAId,
        side_b_id: sideBId,
        score_a: null,
        score_b: null,
      }, prior.score_a, prior.score_b);
    }
    await pruneUnusedInternalEntrants(sql);
    return jsonResponse({ success: true, fixtureId });
  }

  const inserted = await sql<{ fixture_id: string }[]>`
    insert into ierne_tennis.fixtures (
      competition_id, group_id, stage, round_label, round_name, side_a_id, side_b_id,
      match_date, play_by, sort_order, sets_to_win, games_per_set, final_set,
      challenged_at
    ) values (
      ${compId}, ${groupId}, ${stage}, ${roundLabel}, ${roundName}, ${sideAId}, ${sideBId},
      ${matchDate}, ${playBy}, ${so}, ${mf.setsToWin}, ${mf.gamesPerSet}, ${mf.finalSet},
      ${stage === "ladder" ? new Date().toISOString() : null}
    )
    returning fixture_id
  `;
  return jsonResponse({ success: true, fixtureId: inserted[0]?.fixture_id });
}

async function insertGeneratedFixtures(sql: Sql, comp: CompetitionRow, fixtures: GeneratedFixture[]): Promise<void> {
  const mf = parseMatchFormat(comp);
  for (const f of fixtures) {
    await ensureInternalEntrants(sql, f.sideAId, f.sideBId);
    await sql`
      insert into ierne_tennis.fixtures (
        competition_id, group_id, stage, round_label, round_name, side_a_id, side_b_id,
        sort_order, sets_to_win, games_per_set, final_set
      ) values (
        ${comp.competition_id}, ${f.groupId}, ${f.stage}, ${f.roundLabel}, ${f.roundName},
        ${f.sideAId}, ${f.sideBId}, ${f.sortOrder}, ${mf.setsToWin}, ${mf.gamesPerSet}, ${mf.finalSet}
      )
    `;
  }
}

async function handleGenerateFixtures(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  if (!compId) return errorResponse("compId required");
  const regenerate = Boolean(data.regenerate);
  const sql = db();
  const comp = await loadCompetition(compId);
  if (!comp) return errorResponse("Competition not found", 404);
  const competitionType = normalizeCompetitionType(comp.competition_type);
  if (competitionType === "ladder") {
    return errorResponse("Ladder matches come from challenges, not generated fixtures.");
  }

  const existing = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from ierne_tennis.fixtures where competition_id = ${compId}
  `;
  const existingCount = Number(existing[0]?.cnt) || 0;
  if (existingCount > 0) {
    if (!regenerate) {
      return errorResponse("Fixtures already exist for this competition. Use regenerate to replace them.", 409);
    }
    const played = await sql<{ ok: boolean }[]>`
      select exists(
        select 1 from ierne_tennis.fixtures
         where competition_id = ${compId} and score_a is not null and score_b is not null
           and side_a_id <> ${BYE_ENTRANT_ID} and side_b_id <> ${BYE_ENTRANT_ID}
      ) as ok
    `;
    if (truthy(played[0]?.ok)) {
      return errorResponse("Cannot re-generate: one or more fixtures already have a result.", 409);
    }
    await sql`delete from ierne_tennis.fixtures where competition_id = ${compId}`;
    await pruneUnusedInternalEntrants(sql);
  }

  let generated: GeneratedFixture[] = [];
  const members = await sql<{ group_id: string; entrant_id: string }[]>`
    select group_id, entrant_id from ierne_tennis.competition_entrants where competition_id = ${compId}
  `;
  if (competitionType === "league") {
    const groups = await loadCompetitionGroups(compId);
    let sortStart = 1;
    for (const g of groups) {
      if (g.group_id === KNOCKOUT_GROUP_ID) continue;
      const ids = members.filter((m) => m.group_id === g.group_id).map((m) => m.entrant_id);
      const rr = generateLeagueRoundRobin(g.group_id, ids, sortStart);
      generated = generated.concat(rr);
      sortStart += rr.length + 1;
    }
    if (!generated.length) return errorResponse("No group entrants found to generate league fixtures");
  } else {
    await ensurePoolGroup(compId, competitionType);
    const ids = members
      .filter((m) => m.group_id === KNOCKOUT_GROUP_ID && !isInternalEntrantId(m.entrant_id))
      .map((m) => m.entrant_id);
    try {
      generated = competitionType === "double-eliminator"
        ? generateDoubleElimFixtures(ids)
        : generateKnockoutFixtures(ids);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err));
    }
  }

  await insertGeneratedFixtures(sql, comp, generated);
  await pruneUnusedInternalEntrants(sql);
  return jsonResponse({ success: true, created: generated.length, regenerated: regenerate && existingCount > 0 });
}

async function handleDeleteFixture(data: Record<string, unknown>): Promise<Response> {
  const fixtureId = String(data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const sql = db();
  const rows = await sql<(BracketFixture & { result_slip_path: string | null })[]>`
    select fixture_id, result_slip_path, competition_id, stage, round_label, side_a_id, side_b_id, score_a, score_b
      from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  const prior = rows[0];
  if (prior && prior.score_a != null && prior.score_b != null) {
    await syncBracketPlaceholdersForResult(sql, prior, null, null);
  }
  await sql`delete from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid`;
  await pruneUnusedInternalEntrants(sql);
  const paths = [resultSlipPendingPath(fixtureId), resultSlipCommittedPath(fixtureId)];
  if (prior?.result_slip_path) paths.push(prior.result_slip_path);
  await deleteSlipPaths(paths);
  return jsonResponse({ success: true });
}

// ---------- Results ---------------------------------------------------------------

type EditorGate = {
  admin: boolean;
  editorPlayerId: string | null;
};

async function requireResultEditor(envelope: PostEnvelope, fixtureId: string): Promise<Response | EditorGate> {
  const sql = db();
  const rows = await sql<{ side_a_id: string; side_b_id: string; result_posted_at: string | Date | null }[]>`
    select side_a_id, side_b_id, result_posted_at from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  const fixture = rows[0];
  if (!fixture) return errorResponse("Fixture not found", 404);

  if (await hasAdminPin(envelope)) return { admin: true, editorPlayerId: null };
  const adminToken = typeof envelope.adminToken === "string" ? envelope.adminToken.trim() : "";
  const player = await readPlayerSession(sql, envelope.sessionToken);
  if (!player) {
    if (adminToken) {
      return unauthorizedResponse("Invalid or expired admin session. Unlock Admin Mode again from the menu.");
    }
    return unauthorizedResponse("Sign in as a player in this match, or unlock Admin Mode.");
  }
  if (player.isAdmin || player.isApprover) return { admin: false, editorPlayerId: player.playerId };

  const map = await loadEntrantMap([fixture.side_a_id, fixture.side_b_id]);
  const members = [
    ...entrantMemberIds(map.get(fixture.side_a_id)),
    ...entrantMemberIds(map.get(fixture.side_b_id)),
  ];
  if (!members.includes(player.playerId)) {
    return errorResponse("You can only report results for your own matches.", 403);
  }
  if (!withinResultWindow(fixture.result_posted_at)) {
    return errorResponse("This result is locked. Only an admin or an approver can change it after 24 hours.", 403);
  }
  return { admin: false, editorPlayerId: player.playerId };
}

async function playerNameFor(playerId: string | null): Promise<string> {
  if (!playerId) return "";
  const rows = await db()<{ player_name: string }[]>`
    select player_name from ierne_tennis.players where player_id = ${playerId}
  `;
  return String(rows[0]?.player_name || "").trim();
}

async function resultEnteredByLabel(gate: EditorGate, sessionToken: string | undefined): Promise<string> {
  if (gate.admin || !gate.editorPlayerId) return "Admin";
  const name = await playerNameFor(gate.editorPlayerId);
  if (name) return name;
  const actor = await readPlayerSession(db(), sessionToken);
  return actor?.handle || "Player";
}

async function resultApprovedByLabel(envelope: PostEnvelope): Promise<string> {
  const session = typeof envelope.sessionToken === "string" ? envelope.sessionToken.trim() : "";
  if (session) {
    const actor = await readPlayerSession(db(), session);
    if (actor && (actor.isAdmin || actor.isApprover) && actor.playerId) {
      return (await playerNameFor(actor.playerId)) || actor.handle || "Admin";
    }
  }
  return "Admin";
}

/**
 * A bracket result cannot be cleared, or changed so the other side wins, once either
 * side has a result in a later round of the same comp: the later match was only possible
 * because of this one. Applies to everyone, admins included; clear the later match
 * first. Leagues and ladders are not affected. Returns the reason, or null when fine.
 */
async function laterBracketResultBlockingChange(
  sql: Sql,
  fixture: BracketFixture,
  change: "clear" | "winner",
): Promise<string | null> {
  if (fixture.stage !== "knockout") return null;
  const rank = bracketRoundRank(fixture.round_label);
  if (rank == null) return null;
  const sides = [fixture.side_a_id, fixture.side_b_id].filter((id) => id && !isInternalEntrantId(id));
  if (!sides.length) return null;
  const later = await sql<{ round_label: string; round_name: string | null; side_a_id: string; side_b_id: string }[]>`
    select round_label, round_name, side_a_id, side_b_id
      from ierne_tennis.fixtures
     where competition_id = ${fixture.competition_id}
       and stage = 'knockout'
       and fixture_id <> ${fixture.fixture_id}::uuid
       and score_a is not null and score_b is not null
       and side_a_id <> ${BYE_ENTRANT_ID} and side_b_id <> ${BYE_ENTRANT_ID}
       and (side_a_id = any(${sides}::text[]) or side_b_id = any(${sides}::text[]))
  `;
  const hit = later
    .filter((f) => {
      const r = bracketRoundRank(f.round_label);
      return r != null && r > rank;
    })
    .sort((x, y) => (bracketRoundRank(x.round_label) ?? 0) - (bracketRoundRank(y.round_label) ?? 0))[0];
  if (!hit) return null;
  const who = sides.includes(hit.side_a_id) ? hit.side_a_id : hit.side_b_id;
  const name = sideName(who, await loadEntrantMap([who])) || "A player in this match";
  const played = `${name} has already played ${bracketRoundTitle(hit.round_label, hit.round_name)}`;
  return change === "winner"
    ? `${played}, so the winner of this match cannot be changed. Clear that result first.`
    : `${played}. Clear that result first.`;
}

/**
 * Save, change or clear a result.
 * data: fixtureId, sets: [{a, b, tbA?, tbB?}] (empty list clears), optional matchDate.
 */
async function handleUpdateFixtureResult(envelope: PostEnvelope): Promise<Response> {
  const data = envelope.data;
  const fixtureId = String(data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) return gate;

  const sql = db();
  const priorRows = await sql<(BracketFixture & {
    sets_to_win: number;
    games_per_set: number;
    final_set: string;
    result_entered_by: string | null;
    result_approved: boolean;
    result_approved_by: string | null;
  })[]>`
    select fixture_id, competition_id, stage, round_label, side_a_id, side_b_id, score_a, score_b,
           sets_to_win, games_per_set, final_set, result_entered_by, result_approved, result_approved_by
      from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  const prior = priorRows[0];
  if (!prior) return errorResponse("Fixture not found", 404);

  const totals = validateSets(data.sets, parseMatchFormat(prior));
  if (typeof totals === "string") return errorResponse(totals);
  const clearing = totals.sets.length === 0;
  if (!clearing && (isInternalEntrantId(prior.side_a_id) || isInternalEntrantId(prior.side_b_id))) {
    return errorResponse("Both sides must be known before a result can be entered.");
  }
  if (prior.score_a != null && prior.score_b != null) {
    const priorAWon = Number(prior.score_a) > Number(prior.score_b);
    const winnerChanges = !clearing && totals.setsA > totals.setsB !== priorAWon;
    if (clearing || winnerChanges) {
      const blocked = await laterBracketResultBlockingChange(sql, prior, clearing ? "clear" : "winner");
      if (blocked) return errorResponse(blocked, 409);
    }
  }

  const hasMatchDate = Object.prototype.hasOwnProperty.call(data, "matchDate");
  const md = data.matchDate;
  const matchDateVal = !hasMatchDate || md === null || md === "" ? null : String(md).trim();

  const enteredBy = await resultEnteredByLabel(gate, envelope.sessionToken);
  const actor = gate.admin ? null : await readPlayerSession(sql, envelope.sessionToken);
  const privileged = gate.admin || !!actor?.isAdmin || !!actor?.isApprover;
  const approved = clearing || privileged;
  const priorEntered = String(prior.result_entered_by || "").trim();
  const priorByPlayer = priorEntered !== "" && priorEntered !== "Admin";
  const subsequentApproval = approved && !clearing && priorByPlayer && prior.result_approved === false && privileged;
  const preservePlayerEntry = approved && !clearing && priorByPlayer && prior.result_approved === true;
  const keepExistingApproval = preservePlayerEntry && String(prior.result_approved_by || "").trim() !== "";
  const enteredByToStore = clearing ? null : (subsequentApproval || preservePlayerEntry ? priorEntered : enteredBy);
  const approvedBy = subsequentApproval ? await resultApprovedByLabel(envelope) : null;

  const sa = clearing ? null : totals.setsA;
  const sb = clearing ? null : totals.setsB;
  const ga = clearing ? null : totals.gamesA;
  const gb = clearing ? null : totals.gamesB;
  // deno-lint-ignore no-explicit-any
  const setsJson = clearing ? null : sql.json(totals.sets as any);

  await sql`
    update ierne_tennis.fixtures
       set score_a = ${sa}, score_b = ${sb}, games_a = ${ga}, games_b = ${gb},
           set_scores = ${setsJson},
           match_date = case when ${hasMatchDate} then ${matchDateVal}::date else match_date end,
           result_entered_by = ${enteredByToStore},
           result_approved = ${approved},
           result_approved_by = case
             when ${subsequentApproval} then ${approvedBy}
             when ${keepExistingApproval} then result_approved_by
             else null end,
           result_approved_at = case
             when ${subsequentApproval} then now()
             when ${keepExistingApproval} then result_approved_at
             else null end,
           result_posted_at = case
             when ${!clearing} then coalesce(result_posted_at, now())
             else null end,
           updated_at = now()
     where fixture_id = ${fixtureId}::uuid
  `;
  await syncBracketPlaceholdersForResult(sql, prior, sa, sb);
  if (clearing) await clearFixtureResultSlip(fixtureId);
  return jsonResponse({ success: true, resultApproved: approved, setLine: formatSetLine(totals.sets) });
}

async function handleApproveFixtureResult(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const sql = db();
  const rows = await sql<{ score_a: number | null; score_b: number | null; result_entered_by: string | null }[]>`
    select score_a, score_b, result_entered_by from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  const fixture = rows[0];
  if (!fixture) return errorResponse("Fixture not found", 404);
  if (fixture.score_a == null || fixture.score_b == null) return errorResponse("There is no score to approve");
  const entered = String(fixture.result_entered_by || "").trim();
  const approvedBy = entered !== "" && entered !== "Admin" ? await resultApprovedByLabel(envelope) : null;
  await sql`
    update ierne_tennis.fixtures
       set result_approved = true,
           result_approved_by = ${approvedBy},
           result_approved_at = case when ${approvedBy !== null} then now() else result_approved_at end,
           updated_at = now()
     where fixture_id = ${fixtureId}::uuid
  `;
  return jsonResponse({ success: true, resultApproved: true });
}

// ---------- Ladder challenges ---------------------------------------------------

async function handleCreateChallenge(envelope: PostEnvelope): Promise<Response> {
  const data = envelope.data;
  const compId = String(data.compId ?? "").trim();
  const defenderId = String(data.defenderId ?? "").trim();
  if (!compId || !defenderId) return errorResponse("compId and defenderId required");
  const sql = db();

  let state: LadderState;
  try {
    state = await computeLadder(compId);
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }

  let isAdmin = await hasAdminPin(envelope);
  let challengerId = "";
  if (!isAdmin) {
    const actor = await readPlayerSession(sql, envelope.sessionToken);
    if (!actor) return unauthorizedResponse("Sign in to make a challenge.");
    isAdmin = actor.isAdmin;
    if (!isAdmin || !data.challengerId) {
      challengerId = state.order.find((id) => entrantMemberIds(state.entrants.get(id)).includes(actor.playerId)) || "";
      if (!challengerId) return errorResponse("You are not on this ladder.", 403);
    }
  }
  if (isAdmin && !challengerId) challengerId = String(data.challengerId ?? "").trim();
  if (!challengerId) return errorResponse("challengerId required");

  const reason = challengeBlockReason(state.order, challengerId, defenderId, Number(state.comp.ladder_challenge_range));
  if (reason) return errorResponse(reason);
  const busy = state.fixtures.find((f) =>
    f.score_a == null && [f.side_a_id, f.side_b_id].some((id) => id === challengerId || id === defenderId)
  );
  if (busy) {
    const who = [busy.side_a_id, busy.side_b_id].includes(challengerId) ? "You already have" : "That opponent already has";
    return errorResponse(`${who} an open challenge. Play or cancel it first.`, 409);
  }

  const seq = state.fixtures.reduce((m, f) => {
    const n = parseInt(String(f.round_label).replace(/^C/i, ""), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0) + 1;
  const mf = parseMatchFormat(state.comp);
  const days = Number(state.comp.ladder_challenge_days) || 14;
  const inserted = await sql<{ fixture_id: string; play_by: string }[]>`
    insert into ierne_tennis.fixtures (
      competition_id, group_id, stage, round_label, side_a_id, side_b_id, sort_order,
      sets_to_win, games_per_set, final_set, challenged_at, play_by
    ) values (
      ${compId}, ${KNOCKOUT_GROUP_ID}, 'ladder', ${"C" + seq}, ${challengerId}, ${defenderId}, ${seq},
      ${mf.setsToWin}, ${mf.gamesPerSet}, ${mf.finalSet}, now(), current_date + ${days}::int
    )
    returning fixture_id, to_char(play_by, 'YYYY-MM-DD') as play_by
  `;
  return jsonResponse({ success: true, fixtureId: inserted[0]?.fixture_id, playBy: inserted[0]?.play_by });
}

async function handleCancelChallenge(data: Record<string, unknown>): Promise<Response> {
  const fixtureId = String(data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const sql = db();
  const rows = await sql<{ stage: string; score_a: number | null }[]>`
    select stage, score_a from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  if (!rows[0]) return errorResponse("Challenge not found", 404);
  if (rows[0].stage !== "ladder") return errorResponse("That fixture is not a ladder challenge.");
  if (rows[0].score_a != null) return errorResponse("Clear the result before cancelling this challenge.", 409);
  await sql`delete from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid`;
  await deleteSlipPaths([resultSlipPendingPath(fixtureId), resultSlipCommittedPath(fixtureId)]);
  return jsonResponse({ success: true });
}

/** data: compId, order: [entrantId, ...] top first. Entrants not listed become later joiners. */
async function handleSetLadderStartPositions(data: Record<string, unknown>): Promise<Response> {
  const compId = String(data.compId ?? "").trim();
  const order = Array.isArray(data.order) ? (data.order as unknown[]).map((x) => String(x || "").trim()).filter(Boolean) : null;
  if (!compId || !order) return errorResponse("compId and order required");
  const comp = await loadCompetition(compId);
  if (!comp) return errorResponse("Competition not found", 404);
  if (comp.competition_type !== "ladder") return errorResponse("That competition is not a ladder.");
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`update ierne_tennis.competition_entrants set ladder_start_position = null, updated_at = now()
              where competition_id = ${compId}`;
    for (let i = 0; i < order.length; i++) {
      await tx`update ierne_tennis.competition_entrants set ladder_start_position = ${i + 1}, updated_at = now()
                where competition_id = ${compId} and entrant_id = ${order[i]!}`;
    }
  });
  return jsonResponse({ success: true });
}

// ---------- Result slips ----------------------------------------------------------

async function handleGetResultSlip(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) {
    const approverDenied = await requireScoreApprover(envelope);
    if (approverDenied) return gate;
  }
  const rows = await db()<{ result_slip_path: string | null; result_slip_mime: string | null }[]>`
    select result_slip_path, result_slip_mime from ierne_tennis.fixtures where fixture_id = ${fixtureId}::uuid
  `;
  if (!rows.length) return errorResponse("Fixture not found", 404);
  const path = rows[0]!.result_slip_path;
  if (!path) return jsonResponse({ success: true, hasImage: false, imageUrl: null, mimeType: null });
  return jsonResponse({
    success: true,
    hasImage: true,
    imageUrl: await getSignedSlipUrl(path),
    mimeType: rows[0]!.result_slip_mime || "image/jpeg",
  });
}

async function handleUploadResultSlip(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) return gate;
  const payload = decodeImagePayload(
    envelope.data.base64 ?? envelope.data.imageBase64,
    envelope.data.mimeType ?? envelope.data.imageMimeType,
  );
  if (!payload) return errorResponse("Image payload required");
  const path = resultSlipPendingPath(fixtureId);
  await uploadSlipBytes(path, payload.bytes, payload.mime);
  return jsonResponse({ success: true, pending: true, path, mimeType: payload.mime, imageUrl: await getSignedSlipUrl(path) });
}

async function handleCommitResultSlip(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) return gate;
  const pending = resultSlipPendingPath(fixtureId);
  const committed = resultSlipCommittedPath(fixtureId);
  const { data: blob, error: dlErr } = await storageClient().storage.from(RESULT_SLIP_BUCKET).download(pending);
  if (dlErr || !blob) return jsonResponse({ success: true, committed: false });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = blob.type || "image/jpeg";
  await uploadSlipBytes(committed, bytes, mime);
  await deleteSlipPaths([pending]);
  await db()`
    update ierne_tennis.fixtures
       set result_slip_path = ${committed}, result_slip_mime = ${mime}, updated_at = now()
     where fixture_id = ${fixtureId}::uuid
  `;
  return jsonResponse({ success: true, committed: true, path: committed, mimeType: mime, imageUrl: await getSignedSlipUrl(committed) });
}

async function handleDiscardResultSlipSession(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) return gate;
  await deleteSlipPaths([resultSlipPendingPath(fixtureId)]);
  return jsonResponse({ success: true });
}

async function handleRemoveResultSlip(envelope: PostEnvelope): Promise<Response> {
  const fixtureId = String(envelope.data.fixtureId ?? "").trim();
  if (!fixtureId) return errorResponse("fixtureId required");
  const gate = await requireResultEditor(envelope, fixtureId);
  if (gate instanceof Response) return gate;
  await clearFixtureResultSlip(fixtureId);
  return jsonResponse({ success: true });
}

// ---------- Accounts ------------------------------------------------------------

function accountResult(result: unknown): Response {
  if (result && typeof result === "object" && "sessionToken" in (result as object)) {
    const body = result as { sessionToken: string; account: unknown };
    return jsonResponse({ success: true, sessionToken: body.sessionToken, account: body.account });
  }
  if (result && typeof result === "object" && "handle" in (result as object) && "playerId" in (result as object)) {
    return jsonResponse({ success: true, account: result });
  }
  return jsonResponse({ success: true, ...(result as object) });
}

async function dispatchAccount(envelope: PostEnvelope, req: Request): Promise<Response> {
  const sql = db();
  try {
    switch (envelope.action) {
      case "register": return accountResult(await registerAccount(sql, req, envelope.data));
      case "connect": return accountResult(await connectAccount(sql, req, envelope.data));
      case "resetPassword": return accountResult(await resetAccountPassword(sql, req, envelope.data));
      case "signOut": return accountResult(await signOutAccount(sql, envelope.sessionToken));
      case "whoAmI": return accountResult(await whoAmIAccount(sql, envelope.sessionToken));
      default: return errorResponse(`Unknown action: ${envelope.action}`, 400);
    }
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }
}

async function dispatchAdminAccount(envelope: PostEnvelope): Promise<Response> {
  const sql = db();
  try {
    switch (envelope.action) {
      case "issueInvite": return accountResult(await issueInvite(sql, envelope.data));
      case "listInvites": return jsonResponse({ success: true, invites: await listInvites(sql) });
      case "revokeInvite": return accountResult(await revokeInvite(sql, envelope.data));
      case "listAccounts": return jsonResponse({ success: true, accounts: await listAccounts(sql) });
      case "disableAccount": return accountResult(await disableAccount(sql, envelope.data));
      case "setAccountAdmin": return accountResult(await setAccountAdmin(sql, envelope.data));
      case "setAccountApprover": return accountResult(await setAccountApprover(sql, envelope.data));
      default: return errorResponse(`Unknown action: ${envelope.action}`, 400);
    }
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    throw err;
  }
}

async function dispatchPost(envelope: PostEnvelope, req: Request): Promise<Response> {
  if (PUBLIC_POST_ACTIONS.has(envelope.action)) return dispatchAccount(envelope, req);
  if (PLAYER_RESULT_ACTIONS.has(envelope.action)) {
    switch (envelope.action) {
      case "updateFixtureResult": return handleUpdateFixtureResult(envelope);
      case "getResultSlip": return handleGetResultSlip(envelope);
      case "uploadResultSlip": return handleUploadResultSlip(envelope);
      case "commitResultSlip": return handleCommitResultSlip(envelope);
      case "discardResultSlipSession": return handleDiscardResultSlipSession(envelope);
      case "removeResultSlip": return handleRemoveResultSlip(envelope);
      case "createChallenge": return handleCreateChallenge(envelope);
      default: return errorResponse(`Unknown action: ${envelope.action}`, 400);
    }
  }
  if (!ADMIN_POST_ACTIONS.has(envelope.action)) return errorResponse(`Unknown action: ${envelope.action}`, 400);
  if (envelope.action !== "adminLogin") {
    const denied = envelope.action === "approveFixtureResult"
      ? await requireScoreApprover(envelope)
      : await requireAdmin(envelope);
    if (denied) return denied;
  }
  if (ACCOUNT_ADMIN_ACTIONS.has(envelope.action)) return dispatchAdminAccount(envelope);
  switch (envelope.action) {
    case "adminLogin": return handleAdminLogin(envelope.data);
    case "upsertPlayer": return handleUpsertPlayer(envelope.data);
    case "deletePlayer": return handleDeletePlayer(envelope.data);
    case "upsertPair": return handleUpsertPair(envelope.data);
    case "deletePair": return handleDeletePair(envelope.data);
    case "upsertCompetitionEntrant":
    case "upsertCompetitionPlayer": return handleUpsertCompetitionEntrant(envelope.data);
    case "upsertCompetition": return handleUpsertCompetition(envelope.data);
    case "deleteCompetition": return handleDeleteCompetition(envelope.data);
    case "upsertCompetitionGroup": return handleUpsertCompetitionGroup(envelope.data);
    case "deleteCompetitionGroup": return handleDeleteCompetitionGroup(envelope.data);
    case "upsertFixture": return handleUpsertFixture(envelope.data);
    case "generateFixtures": return handleGenerateFixtures(envelope.data);
    case "deleteFixture": return handleDeleteFixture(envelope.data);
    case "approveFixtureResult": return handleApproveFixtureResult(envelope);
    case "cancelChallenge": return handleCancelChallenge(envelope.data);
    case "setLadderStartPositions": return handleSetLadderStartPositions(envelope.data);
    default: return errorResponse(`Unknown action: ${envelope.action}`, 400);
  }
}

// ---------- Server ----------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  let action = "";
  try {
    if (req.method === "POST") {
      const env = await parsePostEnvelope(req);
      if (!env?.action) return errorResponse("Missing required parameter: action");
      action = env.action;
      return await dispatchPost(env, req);
    }
    const url = new URL(req.url);
    action = url.searchParams.get("action") ?? "";
    if (!action) return errorResponse("Missing required parameter: action");
    switch (action) {
      case "getCompetitions": return await handleGetCompetitions();
      case "getCompetitionGroups": return await handleGetCompetitionGroups(req);
      case "getFixtures": return await handleGetFixtures(req);
      case "getStandings": return await handleGetStandings(req);
      case "getPlayers": return await handleGetPlayers(req);
      case "getPlayerComps": return await handleGetPlayerComps(req);
      case "getEntrants": return await handleGetEntrants(req);
      case "getLadder": return await handleGetLadder(req);
      default: return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ierne-tennis-api error (action=${action}):`, message);
    return errorResponse(message, 500);
  }
});
