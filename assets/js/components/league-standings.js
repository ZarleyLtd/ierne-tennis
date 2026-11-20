// League standings table.
// Rows arrive from getStandings already ordered by the server's tiebreak
// chain (points, set difference, game difference, head-to-head, name), so
// this component never re-sorts them. Keys: 'Player Name', P, W, L,
// 'Sets +/-', 'Games +/-', Pts, unapproved.

const LeagueStandings = {
  signed: function (n) {
    const v = Formatters.toInt(n);
    return v > 0 ? '+' + v : String(v);
  },

  /** Shared rank only when every sort key is equal (head-to-head never split them). */
  ranks: function (rows) {
    let last = null;
    let lastRank = 0;
    return rows.map((r, idx) => {
      const key = [r.Pts, r['Sets +/-'], r['Games +/-']].join('|');
      const rank = key === last ? lastRank : idx + 1;
      last = key;
      lastRank = rank;
      return rank;
    });
  },

  render: function (container, rows) {
    if (!container) return;
    container.innerHTML = '';
    if (!rows || rows.length === 0) {
      container.innerHTML = '<p class="align-center"><em>No entrants yet.</em></p>';
      return;
    }
    const table = document.createElement('table');
    table.className = 'standings-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th class="num" scope="col">#</th>' +
      '<th scope="col">Name</th>' +
      '<th class="num" scope="col" title="Played">P</th>' +
      '<th class="num" scope="col" title="Won">W</th>' +
      '<th class="num" scope="col" title="Lost">L</th>' +
      '<th class="num" scope="col" title="Set difference">Sets</th>' +
      '<th class="num" scope="col" title="Game difference">Games</th>' +
      '<th class="num" scope="col" title="Points">Pts</th>' +
      '</tr></thead>';
    const tbody = document.createElement('tbody');
    const ranks = this.ranks(rows);
    rows.forEach((r, idx) => {
      const tr = document.createElement('tr');
      if (r.unapproved) tr.className = 'standings-row--unapproved';
      tr.setAttribute('data-help', 'leagues.row');
      const cells = [
        [ranks[idx], 'num'],
        [(r['Player Name'] || '') + (r.unapproved ? ' *' : ''), 'name'],
        [r.P, 'num'],
        [r.W, 'num'],
        [r.L, 'num'],
        [this.signed(r['Sets +/-']), 'num'],
        [this.signed(r['Games +/-']), 'num'],
        [r.Pts, 'num pts'],
      ];
      cells.forEach(function (c) {
        const td = document.createElement('td');
        td.className = c[1];
        td.textContent = String(c[0] == null ? '' : c[0]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },
};
