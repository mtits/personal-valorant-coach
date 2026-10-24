// Tab renderers. Each takes the report from /api/stats and returns an element.

import { h, panel, table, tile, bar, pct, pct0, num, rateClass, thinBadge, empty, heatStyle, ago } from './ui.js';
import { icon } from './icons.js';

export function renderOverview(report, { onAsk }) {
  const o = report.overview;
  const sample = report.sample;
  if (!o.matches) return emptyState(report);

  const tiles = panel(null, h('div', { class: 'tiles' },
    tile('Matches', o.matches, `${o.wins}W ${o.losses}L${o.draws ? ` ${o.draws}D` : ''}`),
    tile('Win rate', pct(o.win_rate), `${pct(o.round_win_rate)} of rounds`, rateClass(o.win_rate)),
    tile('ACS', num(o.acs), `${num(o.adr)} ADR`),
    tile('K/D', num(o.kd, 2), `${o.kills}/${o.deaths}/${o.assists}`, rateClass(o.kd * 50, 50, 4)),
    tile('Headshot %', pct(o.hs_pct), 'of registered shots', rateClass(o.hs_pct, 22, 3)),
    tile('KAST', pct0(o.kast_pct), 'rounds with impact', rateClass(o.kast_pct, 70, 5)),
    tile('First bloods', pct0(o.first_blood_rate), `${pct0(o.first_death_rate)} first deaths`),
    tile('Survival', pct0(o.survival_rate), 'of rounds lived through'),
  ));

  return h('div', null,
    tiles,
    renderInsights(report, onAsk),
    h('div', { class: 'grid cols-2' }, renderSidePanel(report), renderRecent(report)),
    sampleNote(sample, report));
}

function emptyState(report) {
  const account = report.account || {};
  return empty(
    'No matches yet',
    `Nothing stored for ${account.name || 'this account'}#${account.tag || ''} in ${report.queue || 'this queue'} yet.`,
    h('p', null, 'Hit ', h('b', null, 'Sync'), ' above to pull your match history. ',
      'The first sync grabs your recent games; ', h('b', null, 'Deep'), ' walks further back.'),
    h('p', { class: 'muted' }, 'If sync reports an error, check your ', h('code', null, 'HENRIK_API_KEY'), ' in .env.'));
}

function renderInsights(report, onAsk) {
  const insights = report.insights || { leaks: [], strengths: [] };
  if (!insights.leaks.length && !insights.strengths.length) {
    return panel('What to work on',
      h('p', { class: 'muted' },
        'Nothing stands out yet — either your splits are even, or there are not enough rounds to say. Sync more matches.'));
  }
  return panel('What to work on',
    insightGroup('Biggest leaks', insights.leaks, onAsk),
    insightGroup("What's working", insights.strengths, onAsk),
    h('p', { class: 'panel-note' },
      'Ranked by how far each split sits from your own baseline, weighted by how many rounds it covers. '
      + 'The number on the right is that gap in percentage points. Splits below the sample floor are never shown here.'));
}

function insightGroup(title, findings, onAsk) {
  if (!findings.length) return null;
  return h('div', { class: 'insight-group' },
    h('h3', null, title),
    ...findings.map((finding) => h('div', { class: `insight ${finding.kind}` },
      h('div', { class: 'insight-marker' }),
      h('div', { class: 'insight-body' },
        h('div', { class: 'insight-title' }, finding.title),
        h('div', { class: 'insight-detail' }, finding.detail)),
      h('div', {
        class: 'insight-delta',
        title: `${Math.abs(finding.delta)} percentage points ${finding.delta > 0 ? 'above' : 'below'} the comparison of ${finding.baseline}%`,
      }, `${finding.delta > 0 ? '+' : ''}${finding.delta.toFixed(1)} pp`),
      onAsk ? h('button', { class: 'ask-button', onclick: () => onAsk(finding.ask) }, 'Ask coach') : null)));
}

function renderSidePanel(report) {
  const sides = report.rounds.by_side;
  const overall = report.overview.round_win_rate;
  const econ = report.rounds.by_economy;
  return panel('Sides and buys',
    sideRow('Attack', sides.attack, 'attack'),
    sideRow('Defense', sides.defense, 'defense'),
    h('div', { style: { height: '14px' } }),
    ...econ.filter((row) => row.bucket !== 'unknown').map((row) =>
      h('div', { class: 'split-row' },
        h('span', { class: 'side-label' }, capitalise(row.bucket)),
        bar(row.win_rate, 100, rateClass(row.win_rate, overall, 4)),
        h('span', { class: 'side-value' }, `${pct0(row.win_rate)} of ${row.rounds}`))),
    h('p', { class: 'panel-note' },
      `Buy buckets come from your loadout value at round start. Your overall round win rate is ${pct(overall)}.`));
}

function sideRow(label, data, variant) {
  return h('div', { class: 'split-row' },
    h('span', { class: 'side-label' }, label),
    bar(data.win_rate, 100, variant),
    h('span', { class: 'side-value' }, `${pct0(data.win_rate)} of ${data.rounds}`));
}

function renderRecent(report) {
  const rows = report.recent || [];
  if (!rows.length) return panel('Recent matches', h('p', { class: 'muted' }, 'Nothing stored yet.'));
  return panel('Recent matches',
    ...rows.slice(0, 12).map((match) => h('div', {
      class: `match-row ${match.draw ? 'draw' : match.won ? 'won' : 'lost'}`,
    },
      h('div', { class: 'match-flag' }),
      h('div', null,
        h('div', null, match.map),
        h('div', { class: 'match-meta' }, `${match.agent} · ${ago(match.started_at)}`)),
      h('div', { class: 'match-score' }, `${match.rounds_won}–${match.rounds_lost}`),
      h('div', { class: 'match-kda' }, `${match.kills}/${match.deaths}/${match.assists}`),
      h('div', { class: 'match-kda' }, `${match.acs} ACS`))));
}

function sampleNote(sample, report) {
  const parts = [
    `${sample.matches_used} matches analysed (${sample.rounds_with_detail} rounds with full round-by-round detail).`,
  ];
  if (sample.side_inferred_matches) {
    parts.push(`${sample.side_inferred_matches} match(es) had no spike plant to anchor sides, so their attack/defense split is inferred.`);
  }
  return h('p', { class: 'panel-note', style: { textAlign: 'center' } }, parts.join(' '));
}

// ---------------------------------------------------------------- maps

export function renderMaps(report) {
  const maps = report.maps || [];
  if (!maps.length) return empty('No map data', 'Sync some matches first.');
  const baseline = report.overview.win_rate;

  const rows = maps.map((row) => h('tr', null,
    h('td', null, h('div', { class: 'name-cell' }, icon('maps', row.map), h('span', null, row.map),
      thinBadge(row.thin, row.matches))),
    h('td', null, row.matches),
    h('td', null, `${row.wins}–${row.losses}`),
    h('td', null, h('span', { class: `value ${rateClass(row.win_rate, baseline)}` }, pct(row.win_rate))),
    h('td', null, sideCell(row.attack, 'attack')),
    h('td', null, sideCell(row.defense, 'defense')),
    h('td', null, num(row.acs)),
    h('td', null, num(row.kd, 2)),
    h('td', null, num(row.adr)),
    h('td', null, row.best_agent
      ? h('div', { class: 'name-cell', style: { justifyContent: 'flex-end' } },
        icon('agents', row.best_agent.agent),
        h('span', null, `${row.best_agent.agent} ${pct0(row.best_agent.win_rate)}`))
      : '—')));

  return h('div', null,
    panel('Maps',
      table(['Map', 'Games', 'W–L', 'Win rate', 'Attack', 'Defense', 'ACS', 'K/D', 'ADR', 'Best agent'], rows),
      h('p', { class: 'panel-note' },
        `Sorted by Wilson lower bound rather than raw win rate, so small samples sit lower than they would in a plain table. `
        + `Attack and defense are round win rates on that side. Your overall match win rate is ${pct(baseline)}.`)));
}

function sideCell(data, variant) {
  if (!data || !data.rounds) return h('span', { class: 'muted' }, '—');
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' } },
    bar(data.win_rate, 100, variant),
    h('span', null, pct0(data.win_rate)));
}

// ---------------------------------------------------------------- agents

export function renderAgents(report) {
  const agents = report.agents || [];
  if (!agents.length) return empty('No agent data', 'Sync some matches first.');
  const baseline = report.overview.win_rate;

  const rows = agents.map((row) => h('tr', null,
    h('td', null, h('div', { class: 'name-cell' }, icon('agents', row.agent), h('span', null, row.agent),
      thinBadge(row.thin, row.matches))),
    h('td', null, row.matches),
    h('td', null, `${row.wins}–${row.losses}`),
    h('td', null, h('span', { class: `value ${rateClass(row.win_rate, baseline)}` }, pct(row.win_rate))),
    h('td', null, num(row.acs)),
    h('td', null, num(row.kd, 2)),
    h('td', null, num(row.adr)),
    h('td', null, pct(row.hs_pct))));

  return h('div', null,
    panel('Best picks per map', renderPicks(report)),
    panel('Agents', table(['Agent', 'Games', 'W–L', 'Win rate', 'ACS', 'K/D', 'ADR', 'HS%'], rows)),
    panel('Map × agent', renderHeatmap(report)));
}

function renderPicks(report) {
  const picks = report.best_picks || [];
  if (!picks.length) return h('p', { class: 'muted' }, 'Not enough games yet.');
  const label = { solid: 'solid', tentative: 'tentative', 'not enough data': 'too few games' };
  return h('div', { class: 'tiles' }, ...picks.map((pick) => h('div', { class: 'tile pick-tile' },
    h('div', { class: 'label' }, pick.map),
    h('div', { class: 'value', style: { fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' } },
      icon('agents', pick.agent), pick.agent),
    h('div', { class: 'sub' },
      h('span', null, `${pct0(pick.win_rate)} of ${pick.matches}`),
      h('span', {
        class: `badge ${pick.confidence === 'solid' ? 'solid' : 'thin'}`,
        title: 'How much weight this recommendation deserves, given how many games it rests on',
      }, label[pick.confidence] || pick.confidence)))));
}

function renderHeatmap(report) {
  const grid = report.map_agents || {};
  const maps = (report.maps || []).map((row) => row.map);
  const agentTotals = new Map();
  for (const rows of Object.values(grid)) {
    for (const row of rows) agentTotals.set(row.agent, (agentTotals.get(row.agent) || 0) + row.matches);
  }
  const agents = [...agentTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);
  if (!maps.length || !agents.length) return h('p', { class: 'muted' }, 'Not enough games yet.');

  const header = h('tr', null, h('th', null, 'Map'), ...agents.map((agent) =>
    h('th', null, h('div', { class: 'name-cell', style: { justifyContent: 'flex-end' } },
      icon('agents', agent), h('span', null, agent)))));

  const body = maps.map((map) => {
    const rows = grid[map] || [];
    const byAgent = new Map(rows.map((row) => [row.agent, row]));
    return h('tr', null,
      h('td', null, h('div', { class: 'name-cell' }, icon('maps', map), h('span', null, map))),
      ...agents.map((agent) => {
        const cell = byAgent.get(agent);
        if (!cell) return h('td', null, h('div', { class: 'heat-empty' }, '·'));
        // Thin samples get a washed-out cell so the eye is not drawn to them.
        const weight = Math.min(1, cell.matches / 5);
        return h('td', null, h('div', { class: 'heat-cell', style: heatStyle(cell.win_rate, weight) },
          pct0(cell.win_rate), h('span', { class: 'games' }, `${cell.matches}g`)));
      }));
  });

  return h('div', null,
    h('div', { class: 'heatmap' }, h('table', null, h('thead', null, header), h('tbody', null, ...body))),
    h('p', { class: 'panel-note' },
      'Win rate per map and agent. Faded cells have few games behind them — treat a bright 100% off two games as noise, not a read.'));
}

// ---------------------------------------------------------------- matches

export function renderMatches(report) {
  const matches = report.recent || [];
  if (!matches.length) return empty('No matches', 'Sync some matches first.');

  return h('div', null,
    renderPartyPanel(report),
    renderPeoplePanel('Played with', report.teammates || [], true),
    panel('Matches',
      ...matches.map(renderMatchRow),
      h('p', { class: 'panel-note' },
        `The ${matches.length} most recent matches. Click one to see both teams. `
        + 'Players marked "party" queued with you — that comes from Riot\'s party id, '
        + 'not from a guess about who you happen to appear alongside.')));
}

function renderPartyPanel(report) {
  const parties = report.parties || { available: false, sizes: [] };
  if (!parties.available || !parties.sizes.length) {
    return panel('Queueing',
      h('p', { class: 'muted' },
        'No party information in these matches, so everything reads as solo queue.'));
  }
  const overall = report.overview.win_rate;
  return panel('Solo, duo or stack',
    table(['How you queued', 'Games', 'W–L', 'Win rate'],
      parties.sizes.map((row) => h('tr', null,
        h('td', null, row.label, thinBadge(row.thin, row.matches)),
        h('td', null, row.matches),
        h('td', null, `${row.wins}–${row.losses}`),
        h('td', null, h('span', { class: `value ${rateClass(row.win_rate, overall)}` },
          pct(row.win_rate)))))),
    h('p', { class: 'panel-note' },
      `Your overall win rate is ${pct(overall)}. A real gap between solo and stacked `
      + 'games usually says more about comms than about aim.'));
}

function renderPeoplePanel(title, people, showParty) {
  if (!people.length) return null;
  const headers = ['Player', 'Games', 'Win rate'];
  if (showParty) headers.push('Queued with you');
  headers.push('Main agent');

  return panel(title,
    table(headers, people.map((person) => {
      const cells = [
        h('td', null, `${person.name}#${person.tag}`, thinBadge(person.thin, person.matches)),
        h('td', null, person.matches),
        h('td', null, pct(person.win_rate)),
      ];
      if (showParty) {
        cells.push(h('td', null, person.party_matches || h('span', { class: 'muted' }, '—')));
      }
      cells.push(h('td', null, person.main_agent
        ? h('div', { class: 'name-cell', style: { justifyContent: 'flex-end' } },
          icon('agents', person.main_agent), h('span', null, person.main_agent))
        : '—'));
      return h('tr', null, ...cells);
    })),
    h('p', { class: 'panel-note' },
      'Everyone you have shared a team with, most-played first. "Queued with you" counts '
      + 'games where you were actually in the same party.'));
}

function renderMatchRow(match) {
  const roster = match.roster || [];
  const allies = roster.filter((r) => r.side === 'ally');
  const enemies = roster.filter((r) => r.side === 'enemy');
  const partySize = match.party && match.party.size > 1 ? match.party.size : 0;
  const partyLabel = { 2: 'Duo', 3: 'Trio', 4: '4-stack', 5: '5-stack' }[partySize];

  const summary = h('summary', { class: `match-summary ${match.draw ? 'draw' : match.won ? 'won' : 'lost'}` },
    h('span', { class: 'match-flag' }),
    h('div', null,
      h('div', null, match.map,
        partyLabel ? h('span', { class: 'badge' }, partyLabel) : null),
      h('div', { class: 'match-meta' }, `${match.agent} · ${ago(match.started_at)}`)),
    h('div', { class: 'match-score' }, `${match.rounds_won}–${match.rounds_lost}`),
    h('div', { class: 'match-kda' }, `${match.kills}/${match.deaths}/${match.assists}`),
    h('div', { class: 'match-kda' }, `${match.acs} ACS`));

  if (!roster.length) return h('details', { class: 'match' }, summary);

  return h('details', { class: 'match' }, summary,
    h('div', { class: 'match-teams' },
      renderTeam('Your team', allies),
      renderTeam('Enemy team', enemies)));
}

function renderTeam(title, players) {
  return h('div', { class: 'team' },
    h('h4', null, title),
    ...players.map((player) => h('div', { class: `team-row ${player.me ? 'is-me' : ''}`.trim() },
      icon('agents', player.agent),
      h('div', { class: 'team-name' },
        h('span', null, player.name || '—'),
        h('span', { class: 'muted' }, player.tag ? `#${player.tag}` : ''),
        player.in_party ? h('span', { class: 'badge' }, 'party') : null),
      h('span', { class: 'team-tier muted' }, player.tier || ''),
      h('span', { class: 'team-kda' }, `${player.kills}/${player.deaths}/${player.assists}`),
      h('span', { class: 'team-acs' }, player.acs))));
}

// ---------------------------------------------------------------- weapons

export function renderWeapons(report) {
  const weapons = (report.weapons || []).filter((row) => row.kills > 0 || row.rounds_bought > 0);
  if (!weapons.length) return empty('No weapon data', 'Sync some matches with full round detail first.');

  const rows = weapons.map((row) => h('tr', null,
    h('td', null, h('div', { class: 'name-cell' }, icon('weapons', row.weapon), h('span', null, row.weapon))),
    h('td', null, row.kills),
    h('td', null, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' } },
      bar(row.kill_share, Math.max(...weapons.map((w) => w.kill_share)) || 1),
      h('span', null, pct(row.kill_share)))),
    h('td', null, row.rounds_bought || '—'),
    h('td', null, row.kills_per_bought_round === null ? '—' : num(row.kills_per_bought_round, 2)),
    h('td', null, row.round_win_rate === null ? '—'
      : h('span', { class: `value ${rateClass(row.round_win_rate, report.overview.round_win_rate)}` },
        pct0(row.round_win_rate))),
    h('td', null, row.hs_pct_estimate === null ? h('span', { class: 'muted' }, '—')
      : h('span', { title: `estimated from ${row.hs_sample_rounds} single-weapon rounds` },
        `~${pct0(row.hs_pct_estimate)}`))));

  return panel('Weapons',
    table(['Weapon', 'Kills', 'Share', 'Rounds bought', 'Kills / round', 'Round win rate', 'HS% (est)'], rows),
    h('p', { class: 'panel-note' },
      h('b', null, 'On the headshot column: '),
      'the API reports headshots per round, not per weapon. This estimate only counts rounds where every kill came from one gun, '
      + 'so it gets more reliable the more you play, and reads "—" until there is anything to go on. ',
      h('b', null, 'Not available at all: '),
      'per-weapon accuracy, shots fired, and damage per weapon — Riot does not expose them, so nothing here guesses at them.'));
}

// ---------------------------------------------------------------- rounds

export function renderRounds(report, { onAsk }) {
  const rounds = report.rounds;
  if (!report.sample.rounds_with_detail) {
    return empty('No round detail', 'Stored matches have no round-by-round data yet. Run a sync.');
  }
  const overall = report.overview.round_win_rate;

  return h('div', null,
    panel(null, h('div', { class: 'tiles' },
      tile('Round win rate', pct(overall), `${report.sample.rounds_with_detail} rounds`),
      tile('Attack', pct0(rounds.by_side.attack.win_rate), `${rounds.by_side.attack.rounds} rounds`,
        rateClass(rounds.by_side.attack.win_rate, overall)),
      tile('Defense', pct0(rounds.by_side.defense.win_rate), `${rounds.by_side.defense.rounds} rounds`,
        rateClass(rounds.by_side.defense.win_rate, overall)),
      tile('Pistols', pct0(rounds.pistols.win_rate), `${rounds.pistols.rounds} played`,
        rateClass(rounds.pistols.win_rate, overall)),
      tile('Opening duels', pct0(rounds.opening.duel_win_rate), `${rounds.opening.duels} taken`,
        rateClass(rounds.opening.duel_win_rate, 50)),
      tile('Clutches', `${rounds.clutches.wins}/${rounds.clutches.attempts}`,
        pct0(rounds.clutches.win_rate)),
      tile('Triple kills', report.overview.multikills['3k'] || 0,
        `${report.overview.multikills['4k'] || 0} quads, ${report.overview.multikills['5k'] || 0} aces`),
    )),
    panel('Win rate by round number', renderRoundChart(rounds, overall)),
    h('div', { class: 'grid cols-2' },
      renderEconomyPanel(rounds, overall, onAsk),
      renderOpeningPanel(rounds, onAsk)),
    h('div', { class: 'grid cols-2' },
      renderPostPlantPanel(rounds),
      renderClutchPanel(rounds)));
}

function renderRoundChart(rounds, overall) {
  const data = rounds.by_number || [];
  if (!data.length) return h('p', { class: 'muted' }, 'No data.');
  return h('div', null,
    h('div', { class: 'round-chart-frame' },
      h('div', { class: 'round-baseline', title: '50% — an even round' }),
      h('div', { class: 'round-chart' }, ...data.map((row) => h('div', {
      class: 'round-col',
      title: `Round ${row.round}: ${row.wins}/${row.rounds} won (${pct(row.win_rate)})`,
    },
      h('div', { class: 'round-bar-wrap' },
        h('div', {
          class: `round-bar ${row.kind === 'normal' ? '' : row.kind}`.trim(),
          style: { height: `${Math.max(2, Math.round((row.win_rate / 100) * 130))}px` },
        })),
      h('div', { class: 'round-num' }, row.round))))),
    h('div', { class: 'legend' },
      legendItem('var(--accent)', 'Pistol (1, 13)'),
      legendItem('var(--warn)', 'Bonus (2, 14)'),
      legendItem('var(--defense)', 'Normal'),
      legendItem('#a78bfa', 'Overtime')),
    h('p', { class: 'panel-note' },
      `Bar height is your win rate in that round number. Your average across all rounds is ${pct(overall)}. `
      + 'Late round numbers have fewer games behind them, because not every match reaches them.'));
}

function legendItem(colour, label) {
  return h('span', null, h('i', { class: 'swatch', style: { background: colour } }), label);
}

function renderEconomyPanel(rounds, overall, onAsk) {
  const rows = (rounds.by_economy || []).filter((row) => row.bucket !== 'unknown');
  return panel('Buy types',
    table(['Buy', 'Rounds', 'Win rate', 'ADR', 'Kills/rd'],
      rows.map((row) => h('tr', null,
        h('td', null, capitalise(row.bucket), thinBadge(row.thin, row.rounds)),
        h('td', null, row.rounds),
        h('td', null, h('span', { class: `value ${rateClass(row.win_rate, overall)}` }, pct0(row.win_rate))),
        h('td', null, num(row.adr)),
        h('td', null, num(row.kills_per_round, 2))))),
    h('p', { class: 'panel-note' },
      'Eco under 1500 credits of loadout, force to 2900, half to 3900, full above. '
      + 'The gap between your full-buy and eco win rates is normal; a small gap usually means you are over-forcing.'),
    onAsk ? h('button', {
      class: 'ask-button',
      onclick: () => onAsk('Look at my win rate by buy type and tell me whether I am over-forcing or saving too much, and what to change.'),
    }, 'Ask coach about my buys') : null);
}

function renderOpeningPanel(rounds, onAsk) {
  const opening = rounds.opening;
  const trades = rounds.trades;
  return panel('Opening duels and trades',
    h('div', { class: 'split-row' },
      h('span', { class: 'side-label' }, 'Duels won'),
      bar(opening.duel_win_rate, 100, rateClass(opening.duel_win_rate, 50)),
      h('span', { class: 'side-value' }, `${pct0(opening.duel_win_rate)} of ${opening.duels}`)),
    h('div', { class: 'split-row' },
      h('span', { class: 'side-label' }, 'On attack'),
      bar(opening.by_side.attack.win_rate, 100, 'attack'),
      h('span', { class: 'side-value' }, `${pct0(opening.by_side.attack.win_rate)} of ${opening.by_side.attack.duels}`)),
    h('div', { class: 'split-row' },
      h('span', { class: 'side-label' }, 'On defense'),
      bar(opening.by_side.defense.win_rate, 100, 'defense'),
      h('span', { class: 'side-value' }, `${pct0(opening.by_side.defense.win_rate)} of ${opening.by_side.defense.duels}`)),
    h('div', { class: 'tiles', style: { marginTop: '14px' } },
      tile('Round win after my first blood', pct0(opening.round_win_after_first_blood)),
      tile('Round win after my first death', pct0(opening.round_win_after_first_death)),
      tile('My deaths traded', pct0(trades.traded_death_rate), `${trades.traded_deaths} of ${trades.deaths}`,
        rateClass(trades.traded_death_rate, 45, 8)),
      tile('My kills that were trades', pct0(trades.trade_kill_share))),
    h('p', { class: 'panel-note' },
      `A death counts as traded when a team-mate kills your killer within ${trades.window_seconds}s. `
      + 'Dying untraded round after round is a positioning problem, not an aim one.'),
    onAsk ? h('button', {
      class: 'ask-button',
      onclick: () => onAsk('Break down my opening duels and trade numbers. Am I entering badly, or dying in the wrong places?'),
    }, 'Ask coach about my entries') : null);
}

function renderPostPlantPanel(rounds) {
  const postplant = rounds.postplant;
  return panel('Spike rounds',
    h('div', { class: 'tiles' },
      tile('Plants converted', pct0(postplant.attack_conversion), `${postplant.attack_plants} plants`,
        rateClass(postplant.attack_conversion, 70, 8)),
      tile('Retakes won', pct0(postplant.retake_win_rate), `${postplant.defense_plants_faced} faced`,
        rateClass(postplant.retake_win_rate, 30, 8)),
      tile('Average plant time', postplant.avg_plant_time_s === null ? '—' : `${postplant.avg_plant_time_s}s`,
        'into the round')),
    h('p', { class: 'panel-note' },
      'Conversion is how often your team wins the round once your side has planted. '
      + 'Below roughly 70% means post-plant positions are losing you rounds you had already won.'));
}

function renderClutchPanel(rounds) {
  const clutches = rounds.clutches;
  const entries = Object.entries(clutches.by_x || {});
  return panel('Clutches',
    entries.length
      ? table(['Situation', 'Won', 'Attempts', 'Rate'], entries.map(([enemies, row]) => h('tr', null,
        h('td', null, `1v${enemies}`),
        h('td', null, row.wins),
        h('td', null, row.attempts),
        h('td', null, pct0(row.win_rate)))))
      : h('p', { class: 'muted' }, 'No clutch situations recorded yet.'),
    h('p', { class: 'panel-note' },
      'Reconstructed from the kill feed: a clutch starts the moment you are the last player alive on your team. '
      + 'Wins count the round, so a defuse or a time-out counts the same as fragging out.'));
}

function capitalise(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
