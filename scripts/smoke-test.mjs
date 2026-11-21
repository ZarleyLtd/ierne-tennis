// End-to-end smoke test for the live ierne-tennis-api Edge Function.
//
// Creates throwaway players, pairs, competitions and accounts (all named
// "ZZ Test …"), exercises scoring, standings, brackets, the ladder and the
// account roles, then deletes everything it created.
//
// Usage (PowerShell):
//   $env:IERNE_TENNIS_API_URL = "https://yzyipxvlsoxfphwobfkb.functions.supabase.co/ierne-tennis-api"
//   $env:IERNE_TENNIS_ADMIN_SECRET = "<admin secret>"
//   node scripts/smoke-test.mjs
//
// Test accounts cannot be deleted through the API; deleting their test
// players removes them (accounts cascade from players).

const API = process.env.IERNE_TENNIS_API_URL ||
  'https://yzyipxvlsoxfphwobfkb.functions.supabase.co/ierne-tennis-api';
const PIN = process.env.IERNE_TENNIS_ADMIN_SECRET;
if (!PIN) {
  console.error('Set IERNE_TENNIS_ADMIN_SECRET first.');
  process.exit(2);
}

let adminToken = '';
let failures = 0;
const created = { comps: [], players: [], pairs: [] };

function check(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else {
    failures++;
    console.log('  FAIL ' + label + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
  }
}

async function get(params) {
  const url = new URL(API);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  return res.json();
}

async function post(action, data = {}, opts = {}) {
  const env = { action, data };
  if (opts.admin !== false && adminToken) env.adminToken = adminToken;
  if (opts.session) env.sessionToken = opts.session;
  if (opts.admin === false) delete env.adminToken;
  const body = new URLSearchParams({ data: JSON.stringify(env) });
  const res = await fetch(API, { method: 'POST', body });
  const json = await res.json();
  return { status: res.status, ...json };
}

async function must(action, data, opts) {
  const r = await post(action, data, opts);
  if (!r.success) throw new Error(action + ' failed: ' + r.error);
  return r;
}

async function addPlayer(name, gender) {
  const r = await must('upsertPlayer', { playerName: name, gender });
  created.players.push(r.playerId);
  return r.playerId;
}

async function addComp(compId, name, extra) {
  await must('upsertCompetition', Object.assign({ compId, name, isCurrent: false }, extra));
  created.comps.push(compId);
}

async function fixtures(comp) {
  return (await get({ action: 'getFixtures', comp })).fixtures;
}

async function result(fixtureId, sets, opts) {
  return post('updateFixtureResult', { fixtureId, sets, matchDate: '2026-11-20' }, opts);
}

async function cleanup() {
  console.log('\nCleaning up');
  for (const compId of created.comps.slice().reverse()) {
    // A bracket result can only be cleared once later rounds are cleared, so repeat
    // until a pass clears nothing more.
    for (let pass = 0; pass < 6; pass++) {
      const fx = await fixtures(compId).catch(() => []);
      let cleared = 0;
      for (const f of (fx || []).slice().reverse()) {
        if (f.scoreA == null) continue;
        const r = await post('updateFixtureResult', { fixtureId: f.fixtureId, sets: [] });
        if (r.success) cleared++;
      }
      if (!cleared) break;
    }
  }
  for (const compId of created.comps.slice().reverse()) {
    const r = await post('deleteCompetition', { compId });
    if (!r.success) console.log('  could not delete comp ' + compId + ': ' + r.error);
  }
  for (const id of created.pairs) await post('deletePair', { entrantId: id });
  for (const id of created.players) {
    const r = await post('deletePlayer', { playerId: id });
    if (!r.success) console.log('  could not delete player ' + id + ': ' + r.error);
  }
}

async function main() {
  console.log('Reads');
  const comps = await get({ action: 'getCompetitions' });
  check(comps.success, 'getCompetitions');

  console.log('Admin login');
  const bad = await post('adminLogin', { pin: 'wrong' });
  check(bad.status === 401, 'wrong PIN refused');
  const login = await must('adminLogin', { pin: PIN });
  adminToken = login.token;
  check(!!adminToken, 'PIN gives a token');

  console.log('Players and pairs');
  const p = [];
  for (let i = 1; i <= 8; i++) p.push(await addPlayer('ZZ Test Player ' + i, i % 2 ? 'F' : 'M'));
  const dupe = await post('upsertPlayer', { playerId: 'zz-other', playerName: 'ZZ Test Player 1' });
  check(dupe.status === 409, 'duplicate player name refused');
  const pairs = [];
  for (let i = 0; i < 8; i += 2) {
    const r = await must('upsertPair', { player1Id: p[i], player2Id: p[i + 1] });
    pairs.push(r.entrantId);
    created.pairs.push(r.entrantId);
  }
  check(pairs[0].startsWith('pr:'), 'pair entrant id', pairs[0]);

  // ---------- Singles league, two groups, win 2 / loss 0 ----------
  console.log('Singles league');
  await addComp('zz-test-league', 'ZZ Test League', { competitionType: 'league', format: 'singles' });
  await must('upsertCompetitionGroup', { compId: 'zz-test-league', groupId: 'a', name: 'Group A', displayOrder: 1 });
  await must('upsertCompetitionGroup', { compId: 'zz-test-league', groupId: 'b', name: 'Group B', displayOrder: 2 });
  for (let i = 0; i < 4; i++) await must('upsertCompetitionEntrant', { compId: 'zz-test-league', playerId: p[i], groupId: 'a' });
  for (let i = 4; i < 7; i++) await must('upsertCompetitionEntrant', { compId: 'zz-test-league', playerId: p[i], groupId: 'b' });
  const pairInSingles = await post('upsertCompetitionEntrant', { compId: 'zz-test-league', entrantId: pairs[0], groupId: 'a' });
  check(!pairInSingles.success, 'pair refused in a singles comp');
  const gen = await must('generateFixtures', { compId: 'zz-test-league' });
  check(gen.created === 6 + 6, 'round robin: 6 matches in A, 3 + 3 byes in B', gen.created);

  let fx = (await fixtures('zz-test-league')).filter((f) => f.Group === 'a');
  const [m1, m2, m3] = fx;
  let r = await result(m1.fixtureId, [{ a: 6, b: 4 }, { a: 6, b: 3 }]);
  check(r.success && r.setLine === '6-4 6-3', 'straight sets saved', r);
  r = await result(m2.fixtureId, [{ a: 7, b: 6, tbA: 7, tbB: 5 }, { a: 3, b: 6 }, { tbA: 10, tbB: 8 }]);
  check(r.success && r.setLine === '7-6(5) 3-6 [10-8]', 'tiebreak set and match tiebreak saved', r);
  for (const [label, sets] of [
    ['6-5 refused', [{ a: 6, b: 5 }, { a: 6, b: 2 }]],
    ['7-7 refused', [{ a: 7, b: 7 }, { a: 6, b: 2 }]],
    ['unfinished match refused', [{ a: 6, b: 4 }]],
    ['third set after a 2-0 refused', [{ a: 6, b: 4 }, { a: 6, b: 4 }, { a: 6, b: 4 }]],
    ['bad match tiebreak refused', [{ a: 6, b: 4 }, { a: 4, b: 6 }, { tbA: 10, tbB: 9 }]],
  ]) {
    r = await result(m3.fixtureId, sets);
    check(!r.success, label, r.error);
  }
  r = await result(m3.fixtureId, [{ a: 4, b: 6 }, { a: 6, b: 1 }, { tbA: 12, tbB: 10 }]);
  check(r.success, 'extended match tiebreak saved');

  let st = await get({ action: 'getStandings', comp: 'zz-test-league' });
  let ga = st.groups.find((g) => g.groupId === 'a');
  const sumPts = ga.rows.reduce((t, x) => t + x.Pts, 0);
  check(sumPts === 6, 'win 2 / loss 0: three matches give 6 points', sumPts);
  check(st.groups.length === 2 && ga.rows.length === 4, 'two groups, four rows in A');

  console.log('Box-league points scheme');
  await must('upsertCompetition', { compId: 'zz-test-league', name: 'ZZ Test League', competitionType: 'league', format: 'singles', winPoints: 3, lossPoints: 0, lossWithSetBonus: 1, setPoints: 0 });
  st = await get({ action: 'getStandings', comp: 'zz-test-league' });
  ga = st.groups.find((g) => g.groupId === 'a');
  const sumBox = ga.rows.reduce((t, x) => t + x.Pts, 0);
  check(sumBox === 3 * 3 + 2, 'win 3 / loss-with-a-set 1: 11 points', sumBox);
  const top = ga.rows[0];
  check(top.Pts >= ga.rows[1].Pts, 'rows ordered by points');

  // ---------- Doubles knockout ----------
  console.log('Doubles knockout');
  await addComp('zz-test-ko', 'ZZ Test Doubles KO', { competitionType: 'knockout', format: 'doubles', setsToWin: 1, gamesPerSet: 8 });
  const singleInDoubles = await post('upsertCompetitionEntrant', { compId: 'zz-test-ko', playerId: p[0] });
  check(!singleInDoubles.success, 'single player refused in a doubles comp');
  for (const e of pairs) await must('upsertCompetitionEntrant', { compId: 'zz-test-ko', entrantId: e });
  await must('generateFixtures', { compId: 'zz-test-ko' });
  fx = await fixtures('zz-test-ko');
  const sf1 = fx.find((f) => f['Game Week'] === 'SF1');
  const fin = fx.find((f) => f['Game Week'] === 'F');
  check(fin.playerAId === 'wo:SF1', 'final waits on SF1', fin.playerAId);
  check(sf1.setsToWin === 1 && sf1.gamesPerSet === 8, 'pro-set format copied to fixtures');
  r = await result(sf1.fixtureId, [{ a: 8, b: 6 }]);
  check(r.success, 'pro set 8-6 saved');
  let fin2 = (await fixtures('zz-test-ko')).find((f) => f['Game Week'] === 'F');
  check(fin2.playerAId === sf1.playerAId && fin2['Player A'].includes(' / '), 'winning pair advances to the final', fin2['Player A']);
  r = await result(sf1.fixtureId, []);
  fin2 = (await fixtures('zz-test-ko')).find((f) => f['Game Week'] === 'F');
  check(fin2.playerAId === 'wo:SF1', 'clearing restores the placeholder', fin2.playerAId);
  const early = await result(fin2.fixtureId, [{ a: 8, b: 2 }]);
  check(!early.success, 'final refused before both sides are known');

  // A semi-final result cannot be cleared once a finalist has played the final.
  const sf2 = fx.find((f) => f['Game Week'] === 'SF2');
  check((await result(sf1.fixtureId, [{ a: 8, b: 6 }])).success, 'SF1 saved again');
  check((await result(sf2.fixtureId, [{ a: 8, b: 3 }])).success, 'SF2 saved');
  fin2 = (await fixtures('zz-test-ko')).find((f) => f['Game Week'] === 'F');
  check((await result(fin2.fixtureId, [{ a: 8, b: 4 }])).success, 'final saved');
  r = await result(sf1.fixtureId, []);
  check(!r.success && /already played the Final/.test(r.error || ''), 'semi-final cannot be cleared after the final', r.error);
  check((await result(fin2.fixtureId, [])).success, 'final cleared');
  check((await result(sf1.fixtureId, [])).success, 'semi-final cleared once the final is cleared');
  check((await result(sf2.fixtureId, [])).success, 'SF2 cleared');

  // ---------- Double-eliminator ----------
  console.log('Double-eliminator');
  await addComp('zz-test-de', 'ZZ Test DE', { competitionType: 'double-eliminator', format: 'singles' });
  for (let i = 0; i < 4; i++) await must('upsertCompetitionEntrant', { compId: 'zz-test-de', playerId: p[i] });
  const deGen = await must('generateFixtures', { compId: 'zz-test-de' });
  fx = await fixtures('zz-test-de');
  const codes = fx.map((f) => f['Game Week']).join(' ');
  check(codes === 'W1-1 W1-2 WF L1-1 LF GF GF-R', 'DE rounds for four players', codes);
  check(deGen.created === 7, 'seven DE fixtures');

  // ---------- Ladder ----------
  console.log('Ladder');
  await addComp('zz-test-ladder', 'ZZ Test Ladder', { competitionType: 'ladder', format: 'singles', ladderChallengeRange: 2, ladderChallengeDays: 7 });
  for (let i = 0; i < 5; i++) await must('upsertCompetitionEntrant', { compId: 'zz-test-ladder', playerId: p[i] });
  await must('setLadderStartPositions', { compId: 'zz-test-ladder', order: [p[0], p[1], p[2], p[3], p[4]] });
  const noGen = await post('generateFixtures', { compId: 'zz-test-ladder' });
  check(!noGen.success, 'ladders do not generate fixtures');
  const tooFar = await post('createChallenge', { compId: 'zz-test-ladder', challengerId: p[4], defenderId: p[1] });
  check(!tooFar.success, 'challenge beyond the range refused', tooFar.error);
  const down = await post('createChallenge', { compId: 'zz-test-ladder', challengerId: p[1], defenderId: p[3] });
  check(!down.success, 'challenge downwards refused');
  const ch = await must('createChallenge', { compId: 'zz-test-ladder', challengerId: p[4], defenderId: p[2] });
  check(!!ch.playBy, 'challenge has a play-by date', ch.playBy);
  const busy = await post('createChallenge', { compId: 'zz-test-ladder', challengerId: p[3], defenderId: p[2] });
  check(!busy.success, 'second open challenge for the same defender refused');
  r = await result(ch.fixtureId, [{ a: 6, b: 3 }, { a: 6, b: 4 }]);
  let lad = await get({ action: 'getLadder', comp: 'zz-test-ladder' });
  let order = lad.rows.map((x) => x.entrantId);
  check(order.join() === [p[0], p[1], p[4], p[2], p[3]].join(), 'challenger win takes the defender’s place', order);
  r = await result(ch.fixtureId, [{ a: 3, b: 6 }, { a: 4, b: 6 }]);
  lad = await get({ action: 'getLadder', comp: 'zz-test-ladder' });
  order = lad.rows.map((x) => x.entrantId);
  check(order.join() === [p[0], p[1], p[2], p[3], p[4]].join(), 'editing to a defender win restores the order', order);
  const ch2 = await must('createChallenge', { compId: 'zz-test-ladder', challengerId: p[3], defenderId: p[1] });
  const cancel = await must('cancelChallenge', { fixtureId: ch2.fixtureId });
  check(cancel.success, 'unplayed challenge cancelled');

  // ---------- Accounts and roles ----------
  console.log('Accounts');
  const inv1 = await must('issueInvite', { purpose: 'register', label: 'smoke test player' });
  const inv2 = await must('issueInvite', { purpose: 'register', label: 'smoke test approver' });
  const reg1 = await post('register', { inviteCode: inv1.code, handle: 'zztestplayer', password: 'smoke-test-pass-1', playerId: p[0] }, { admin: false });
  check(reg1.success, 'player registers with a code', reg1.error);
  const reg2 = await post('register', { inviteCode: inv2.code, handle: 'zztestapprover', password: 'smoke-test-pass-2', playerId: p[5] }, { admin: false });
  check(reg2.success, 'second account registers', reg2.error);
  const reuse = await post('register', { inviteCode: inv1.code, handle: 'zztestagain', password: 'smoke-test-pass-3', playerId: p[6] }, { admin: false });
  check(!reuse.success, 'a used code is refused');
  const s1 = reg1.sessionToken;
  const s2 = reg2.sessionToken;
  await must('setAccountApprover', { accountId: reg2.account.id || (await post('listAccounts')).accounts.find((a) => a.handle === 'zztestapprover').id, isApprover: true });

  fx = (await fixtures('zz-test-league')).filter((f) => f.Group === 'a' && f.scoreA == null && f.playerBId !== 'bye');
  const mine = fx.find((f) => f.playerAId === p[0] || f.playerBId === p[0]);
  const notMine = fx.find((f) => f.playerAId !== p[0] && f.playerBId !== p[0]);
  r = await post('updateFixtureResult', { fixtureId: notMine.fixtureId, sets: [{ a: 6, b: 0 }, { a: 6, b: 0 }] }, { admin: false, session: s1 });
  check(r.status === 403, 'player cannot enter someone else’s match', r.error);
  r = await post('updateFixtureResult', { fixtureId: mine.fixtureId, sets: [{ a: 6, b: 2 }, { a: 6, b: 2 }], matchDate: '2026-11-20' }, { admin: false, session: s1 });
  check(r.success && r.resultApproved === false, 'player result saved as pending', r);
  st = await get({ action: 'getStandings', comp: 'zz-test-league' });
  check(st.groups.find((g) => g.groupId === 'a').rows.some((x) => x.unapproved), 'pending result flagged in standings');
  r = await post('approveFixtureResult', { fixtureId: mine.fixtureId }, { admin: false, session: s1 });
  check(!r.success, 'a regular player cannot approve');
  r = await post('approveFixtureResult', { fixtureId: mine.fixtureId }, { admin: false, session: s2 });
  check(r.success, 'an approver can approve');
  const approved = (await fixtures('zz-test-league')).find((f) => f.fixtureId === mine.fixtureId);
  check(approved.resultApproved && approved.resultApprovedBy === 'ZZ Test Player 6', 'approval recorded with the approver’s name', approved.resultApprovedBy);
  r = await post('upsertCompetition', { compId: 'zz-x', name: 'x' }, { admin: false, session: s2 });
  check(r.status === 401, 'approver cannot use admin tools');

  // Pair membership: either partner may enter a doubles result.
  await must('upsertCompetitionEntrant', { compId: 'zz-test-ko', entrantId: pairs[0] });
  fx = await fixtures('zz-test-ko');
  const pairMatch = fx.find((f) => (f.playerAId === pairs[0] || f.playerBId === pairs[0]) && f.playerBId !== 'bye' && !String(f.playerAId).startsWith('wo:'));
  if (pairMatch) {
    r = await post('updateFixtureResult', { fixtureId: pairMatch.fixtureId, sets: [{ a: 8, b: 5 }] }, { admin: false, session: s1 });
    check(r.success, 'a partner in a pair can enter the pair’s match', r.error);
  } else {
    check(false, 'found a doubles match for the test pair');
  }
}

main()
  .catch((err) => {
    failures++;
    console.error('ERROR', err.message);
  })
  .then(cleanup)
  .then(() => {
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  });
