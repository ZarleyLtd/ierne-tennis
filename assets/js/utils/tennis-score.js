// Tennis score rules for the browser.
// Mirrors supabase/functions/ierne-tennis-api/scoring.ts; the server is the
// authority and re-validates every save.
//
// A match format is { setsToWin: 1..3, gamesPerSet: 4|6|8, finalSet: 'full'|'match_tiebreak' }.
// A set is { a, b, tbA?, tbB?, mtb? }. A match tiebreak is stored as 1-0 or
// 0-1 games with the points in tbA / tbB and mtb: true.

var TennisScore = (function () {
  function normalizeFormat(raw) {
    raw = raw || {};
    var stw = parseInt(raw.setsToWin, 10);
    var gps = parseInt(raw.gamesPerSet, 10);
    return {
      setsToWin: stw >= 1 && stw <= 3 ? stw : 2,
      gamesPerSet: gps === 4 || gps === 8 ? gps : 6,
      finalSet: raw.finalSet === 'full' ? 'full' : 'match_tiebreak',
    };
  }

  function maxSets(format) {
    return format.setsToWin * 2 - 1;
  }

  /** True when set number `index` (0-based) is played as a match tiebreak. */
  function isMatchTiebreakSet(format, index) {
    var n = maxSets(format);
    return n > 1 && index === n - 1 && format.finalSet === 'match_tiebreak';
  }

  function tiebreakWinner(x, y, target) {
    if (x == null || y == null) return null;
    var hi = Math.max(x, y);
    var lo = Math.min(x, y);
    if (hi < target || hi - lo < 2) return null;
    if (hi > target && hi - lo !== 2) return null;
    return x > y ? 'a' : 'b';
  }

  /** True when the games score needs a tiebreak (e.g. 7-6). */
  function isTiebreakScore(set, format) {
    if (!set) return false;
    var hi = Math.max(set.a, set.b);
    var lo = Math.min(set.a, set.b);
    return hi === format.gamesPerSet + 1 && lo === format.gamesPerSet;
  }

  /**
   * Winner of one set ('a' | 'b'), or null if unfinished, or an error string
   * prefixed with '!' when the score can never be valid.
   */
  function setWinner(set, format, index) {
    if (!set) return null;
    if (isMatchTiebreakSet(format, index)) {
      return tiebreakWinner(set.tbA, set.tbB, 10);
    }
    var a = set.a;
    var b = set.b;
    var gps = format.gamesPerSet;
    var hi = Math.max(a, b);
    var lo = Math.min(a, b);
    var side = a > b ? 'a' : 'b';
    if (a === b) return hi > gps ? '!A set cannot finish level.' : null;
    if (hi === gps && lo <= gps - 2) return side;
    if (hi === gps + 1 && lo === gps - 1) return side;
    if (hi === gps + 1 && lo === gps) {
      if (set.tbA == null && set.tbB == null) return side;
      if (set.tbA == null || set.tbB == null) return null;
      var tbw = tiebreakWinner(set.tbA, set.tbB, 7);
      if (!tbw) return null;
      return tbw === side ? side : '!The tiebreak winner must also win the set.';
    }
    if (hi > gps + 1 || (hi === gps + 1 && lo < gps - 1)) {
      return '!' + a + '-' + b + ' is not a possible set score.';
    }
    return null;
  }

  /**
   * Summary of the sets entered so far:
   * { setsA, setsB, gamesA, gamesB, winner: 'a'|'b'|null, error: string|null, complete: bool }
   */
  function summarize(sets, format) {
    format = normalizeFormat(format);
    var out = { setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, winner: null, error: null, complete: false };
    for (var i = 0; i < (sets || []).length; i++) {
      if (out.winner) break;
      var s = sets[i];
      var w = setWinner(s, format, i);
      if (typeof w === 'string' && w.charAt(0) === '!') {
        out.error = 'Set ' + (i + 1) + ': ' + w.slice(1);
        return out;
      }
      if (w !== 'a' && w !== 'b') break;
      if (isMatchTiebreakSet(format, i)) {
        if (w === 'a') out.gamesA += 1;
        else out.gamesB += 1;
      } else {
        out.gamesA += s.a;
        out.gamesB += s.b;
      }
      if (w === 'a') out.setsA++;
      else out.setsB++;
      if (out.setsA === format.setsToWin) out.winner = 'a';
      if (out.setsB === format.setsToWin) out.winner = 'b';
    }
    out.complete = !!out.winner;
    return out;
  }

  /** Sets ready to send to the API (trimmed to the deciding set). */
  function toPayload(sets, format) {
    format = normalizeFormat(format);
    var payload = [];
    var tally = { a: 0, b: 0 };
    for (var i = 0; i < (sets || []).length; i++) {
      if (tally.a === format.setsToWin || tally.b === format.setsToWin) break;
      var s = sets[i];
      var w = setWinner(s, format, i);
      if (w !== 'a' && w !== 'b') break;
      tally[w]++;
      if (isMatchTiebreakSet(format, i)) {
        payload.push({ tbA: s.tbA, tbB: s.tbB });
      } else if (isTiebreakScore(s, format) && s.tbA != null && s.tbB != null) {
        payload.push({ a: s.a, b: s.b, tbA: s.tbA, tbB: s.tbB });
      } else {
        payload.push({ a: s.a, b: s.b });
      }
    }
    return payload;
  }

  /** "6-4 3-6 [10-7]" from side A's point of view. */
  function formatSetLine(sets) {
    if (!sets || !sets.length) return '';
    return sets
      .map(function (s) {
        if (s.mtb) return '[' + s.tbA + '-' + s.tbB + ']';
        var tb = s.tbA != null && s.tbB != null ? '(' + Math.min(s.tbA, s.tbB) + ')' : '';
        return s.a + '-' + s.b + tb;
      })
      .join(' ');
  }

  /** "6-4 3-6 [10-7]" seen from side B (for "winner first" displays). */
  function flipSets(sets) {
    return (sets || []).map(function (s) {
      return { a: s.b, b: s.a, tbA: s.tbB, tbB: s.tbA, mtb: s.mtb };
    });
  }

  /** "Best of 3 sets, match tiebreak decider" */
  function describeFormat(format) {
    format = normalizeFormat(format);
    var n = maxSets(format);
    var parts = [];
    if (n === 1) {
      parts.push(format.gamesPerSet === 8 ? 'One pro set to 8 games' : 'One set to ' + format.gamesPerSet + ' games');
    } else {
      parts.push('Best of ' + n + ' sets');
      if (format.gamesPerSet !== 6) parts.push('sets to ' + format.gamesPerSet + ' games');
      parts.push(format.finalSet === 'match_tiebreak' ? 'match tiebreak decider' : 'full final set');
    }
    return parts.join(', ');
  }

  return {
    normalizeFormat: normalizeFormat,
    maxSets: maxSets,
    isMatchTiebreakSet: isMatchTiebreakSet,
    isTiebreakScore: isTiebreakScore,
    setWinner: setWinner,
    summarize: summarize,
    toPayload: toPayload,
    formatSetLine: formatSetLine,
    flipSets: flipSets,
    describeFormat: describeFormat,
  };
})();
