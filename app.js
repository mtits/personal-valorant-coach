// Bootstrap and wiring: account switching, sync polling, tab routing.

import { h, clear, getJSON, postJSON, del, ago } from './ui.js';
import { loadIcons } from './icons.js';
import { renderOverview, renderMaps, renderAgents, renderWeapons, renderRounds, renderMatches } from './views.js';
import { initChat, setAccount as setChatAccount, renderCoach } from './chat.js';

// A snapshot export sets this, and the app then reads embedded data instead of
// talking to a server. Everything else — tabs, tables, the account switcher —
// works identically.
const STATIC = window.__VACC_STATIC__ || null;

const state = {
  accounts: [],
  puuid: null,
  queue: localStorage.getItem('vacc.queue') ?? 'Competitive',
  tab: 'overview',
  report: null,
  pendingQuestion: null,
  pollTimer: null,
};

const dom = {
  view: document.getElementById('view'),
  banner: document.getElementById('banner'),
  accountSelect: document.getElementById('account-select'),
  queueSelect: document.getElementById('queue-select'),
  rankPill: document.getElementById('rank-pill'),
  syncStatus: document.getElementById('sync-status'),
  syncButton: document.getElementById('sync-button'),
  deepButton: document.getElementById('deep-sync-button'),
  tabs: document.getElementById('tabs'),
  modal: document.getElementById('modal'),
  modalInput: document.getElementById('modal-input'),
  modalError: document.getElementById('modal-error'),
};

// ---------------------------------------------------------------- banners

function showBanner(message, kind = 'warn') {
  dom.banner.className = `banner ${kind === 'error' ? 'error' : ''}`.trim();
  clear(dom.banner);
  dom.banner.appendChild(h('span', null, message));
  dom.banner.classList.remove('hidden');
}

function hideBanner() {
  dom.banner.classList.add('hidden');
}

// ---------------------------------------------------------------- accounts

async function loadAccounts() {
  const data = STATIC ? { accounts: STATIC.accounts } : await getJSON('/api/accounts');
  state.accounts = data.accounts || [];

  clear(dom.accountSelect);
  for (const account of state.accounts) {
    dom.accountSelect.appendChild(h('option', { value: account.puuid },
      `${account.name}#${account.tag}`));
  }

  if (!state.accounts.length) {
    dom.accountSelect.appendChild(h('option', { value: '' }, 'No accounts'));
    state.puuid = null;
    return;
  }

  const remembered = localStorage.getItem('vacc.puuid');
  const known = state.accounts.some((a) => a.puuid === remembered);
  state.puuid = known ? remembered : state.accounts[0].puuid;
  dom.accountSelect.value = state.puuid;
  localStorage.setItem('vacc.puuid', state.puuid);
  setChatAccount(state.puuid);
}

function currentAccount() {
  return state.accounts.find((account) => account.puuid === state.puuid) || null;
}

function renderRank() {
  const account = currentAccount();
  const rank = account && account.rank;
  if (!rank || !rank.tier) {
    dom.rankPill.classList.add('hidden');
    return;
  }
  clear(dom.rankPill);
  dom.rankPill.appendChild(h('b', null, rank.tier));
  if (rank.rr !== null && rank.rr !== undefined) {
    dom.rankPill.appendChild(h('span', { class: 'rr' }, `${rank.rr} RR`));
  }
  if (rank.peak) dom.rankPill.appendChild(h('span', { class: 'rr' }, `peak ${rank.peak}`));
  dom.rankPill.classList.remove('hidden');
}

// ---------------------------------------------------------------- sync

async function pollSync({ once = false } = {}) {
  if (STATIC) return;
  if (!state.puuid) return;
  clearTimeout(state.pollTimer);

  let status;
  try {
    status = await getJSON(`/api/sync?puuid=${encodeURIComponent(state.puuid)}`);
  } catch (err) {
    dom.syncStatus.textContent = err.message;
    dom.syncStatus.classList.add('error');
    return;
  }

  const running = status.state === 'running';
  dom.syncButton.disabled = running;
  dom.deepButton.disabled = running;
  dom.syncStatus.classList.toggle('error', status.state === 'error');

  clear(dom.syncStatus);
  if (running) {
    dom.syncStatus.appendChild(h('span', { class: 'spin' }));
    dom.syncStatus.appendChild(document.createTextNode(
      `${status.phase} · ${status.stored} new`));
  } else if (status.state === 'error') {
    dom.syncStatus.textContent = status.errors[0] || 'Sync failed';
  } else {
    const account = currentAccount();
    const parts = [`${status.detailed} matches stored`];
    if (status.pending) parts.push(`${status.pending} not yet pulled`);
    if (account && account.last_sync) parts.push(ago(account.last_sync));
    dom.syncStatus.textContent = parts.join(' · ');
  }

  if (status.errors && status.errors.length && status.state !== 'running') {
    showBanner(status.errors.join(' — '), status.state === 'error' ? 'error' : 'warn');
  }

  // A finished sync means new data: refresh the report and the account list.
  if (!running && state.syncWasRunning) {
    state.syncWasRunning = false;
    await loadAccounts();
    dom.accountSelect.value = state.puuid;
    renderRank();
    await loadReport();
  }
  if (running) {
    state.syncWasRunning = true;
    state.pollTimer = setTimeout(pollSync, 1500);
  } else if (!once) {
    state.pollTimer = setTimeout(pollSync, 15000);
  }
}

async function startSync(deep) {
  if (!state.puuid) return;
  hideBanner();
  try {
    await postJSON('/api/sync', { puuid: state.puuid, deep });
    state.syncWasRunning = true;
    pollSync();
  } catch (err) {
    showBanner(err.message, 'error');
  }
}

// ---------------------------------------------------------------- report

async function loadReport() {
  if (!state.puuid) {
    renderNoAccounts();
    return;
  }
  try {
    if (STATIC) {
      const forAccount = STATIC.reports[state.puuid] || {};
      // Fall back to whatever queue the snapshot actually contains.
      state.report = forAccount[state.queue] || forAccount[Object.keys(forAccount)[0]];
      if (!state.report) throw new Error('This snapshot has no data for that queue.');
    } else {
      const query = new URLSearchParams({ puuid: state.puuid, queue: state.queue });
      state.report = await getJSON(`/api/stats?${query}`);
    }
    renderTab();
  } catch (err) {
    clear(dom.view);
    dom.view.appendChild(h('div', { class: 'empty' },
      h('h2', null, 'Could not load stats'),
      h('p', null, err.message)));
  }
}

function renderNoAccounts() {
  clear(dom.view);
  dom.view.appendChild(h('div', { class: 'empty' },
    h('h2', null, 'No account yet'),
    h('p', null, 'Add your Riot ID to get started.'),
    h('p', null, h('button', { class: 'primary', onclick: openModal }, 'Add an account'))));
}

function renderTab() {
  const report = state.report;
  if (!report) return;
  clear(dom.view);

  const handlers = {
    // No coach in a snapshot, so no buttons offering to ask it.
    onAsk: STATIC ? null : (question) => {
      state.pendingQuestion = question;
      switchTab('coach');
    },
  };

  let node;
  switch (state.tab) {
    case 'maps': node = renderMaps(report, handlers); break;
    case 'agents': node = renderAgents(report, handlers); break;
    case 'weapons': node = renderWeapons(report, handlers); break;
    case 'rounds': node = renderRounds(report, handlers); break;
    case 'matches': node = renderMatches(report, handlers); break;
    case 'coach':
      node = renderCoach(report, { pendingQuestion: state.pendingQuestion });
      state.pendingQuestion = null;
      break;
    default: node = renderOverview(report, handlers);
  }
  dom.view.appendChild(node);
}

function switchTab(tab) {
  state.tab = tab;
  for (const button of dom.tabs.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  renderTab();
}

// ---------------------------------------------------------------- modal

function openModal() {
  dom.modal.classList.remove('hidden');
  dom.modalError.textContent = '';
  dom.modalInput.value = '';
  dom.modalInput.focus();
}

function closeModal() {
  dom.modal.classList.add('hidden');
}

async function confirmModal() {
  const riotId = dom.modalInput.value.trim();
  if (!riotId) return;
  dom.modalError.textContent = '';
  try {
    const result = await postJSON('/api/accounts', { riot_id: riotId });
    closeModal();
    localStorage.setItem('vacc.puuid', result.account.puuid);
    await loadAccounts();
    dom.accountSelect.value = state.puuid;
    setChatAccount(state.puuid);
    renderRank();
    await loadReport();
    state.syncWasRunning = true;
    pollSync();
  } catch (err) {
    dom.modalError.textContent = err.message;
  }
}

async function removeAccount() {
  const account = currentAccount();
  if (!account) return;
  const label = `${account.name}#${account.tag}`;
  if (!window.confirm(`Forget ${label}? Downloaded matches stay on disk.`)) return;
  await del(`/api/accounts/${encodeURIComponent(account.puuid)}`);
  localStorage.removeItem('vacc.puuid');
  await loadAccounts();
  renderRank();
  await loadReport();
  pollSync({ once: true });
}

// ---------------------------------------------------------------- boot

async function main() {
  dom.queueSelect.value = state.queue;

  dom.accountSelect.addEventListener('change', async (event) => {
    state.puuid = event.target.value;
    localStorage.setItem('vacc.puuid', state.puuid);
    setChatAccount(state.puuid);
    hideBanner();
    renderRank();
    await loadReport();
    pollSync({ once: true });
  });

  dom.queueSelect.addEventListener('change', async (event) => {
    state.queue = event.target.value;
    localStorage.setItem('vacc.queue', state.queue);
    await loadReport();
  });

  dom.syncButton.addEventListener('click', () => startSync(false));
  dom.deepButton.addEventListener('click', () => startSync(true));
  document.getElementById('add-account').addEventListener('click', openModal);
  document.getElementById('remove-account').addEventListener('click', removeAccount);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmModal);
  dom.modalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') confirmModal();
    if (event.key === 'Escape') closeModal();
  });
  dom.modal.addEventListener('click', (event) => {
    if (event.target === dom.modal) closeModal();
  });

  dom.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (button) switchTab(button.dataset.tab);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') return;
    const tabs = ['overview', 'maps', 'agents', 'weapons', 'rounds', 'matches', 'coach'];
    const index = Number(event.key) - 1;
    if (index >= 0 && index < tabs.length) switchTab(tabs[index]);
  });

  const [health, models] = STATIC
    ? [{ henrik_key: true }, { models: [], enabled: false }]
    : await Promise.all([
      getJSON('/api/health').catch(() => ({})),
      getJSON('/api/models').catch(() => ({ models: [], enabled: false })),
    ]);
  await initChat(models);
  loadIcons();  // fire and forget: art is decorative

  if (STATIC) applyStaticMode();

  if (!health.henrik_key) {
    showBanner('No HENRIK_API_KEY in .env — the app cannot fetch matches until that is set.', 'error');
  }

  await loadAccounts();
  renderRank();
  await loadReport();
  pollSync();
}

// A snapshot is a frozen copy: anything that would need the API is removed
// rather than left visible and broken.
function applyStaticMode() {
  for (const id of ['sync-button', 'deep-sync-button', 'add-account', 'remove-account']) {
    const node = document.getElementById(id);
    if (node) node.remove();
  }

  const queues = new Set();
  for (const reports of Object.values(STATIC.reports || {})) {
    for (const queue of Object.keys(reports)) queues.add(queue);
  }
  clear(dom.queueSelect);
  for (const queue of queues) {
    dom.queueSelect.appendChild(h('option', { value: queue }, queue || 'All modes'));
  }
  if (!queues.has(state.queue)) state.queue = queues.values().next().value ?? 'Competitive';
  dom.queueSelect.value = state.queue;

  const when = STATIC.generated_at
    ? new Date(STATIC.generated_at * 1000).toLocaleString()
    : 'unknown date';
  dom.syncStatus.textContent = `snapshot · ${when}`;
  dom.syncStatus.title = 'A static export. Run the app locally to sync new matches.';
}

// Send on Enter in the chat box, newline on Shift+Enter.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  const target = event.target;
  if (target.tagName !== 'TEXTAREA' || !target.closest('.chat-form')) return;
  event.preventDefault();
  target.closest('form').requestSubmit();
});

main().catch((err) => {
  clear(dom.view);
  dom.view.appendChild(h('div', { class: 'empty' },
    h('h2', null, 'Failed to start'), h('p', null, err.message)));
});
