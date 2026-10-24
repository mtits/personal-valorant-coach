// Coach tab: streams answers from Gemini through the local server, with the
// player's own computed stats already attached server-side as context.

import { h, clear, empty } from './ui.js';
import { unlock } from './keylock.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SUGGESTIONS = [
  'What is my single biggest leak right now?',
  'Which map should I ban, and why?',
  'Which agent should I main on my worst map?',
  'How do I win more eco rounds?',
  'Am I entering too early or too late?',
  'Give me a 30-minute practice routine for this week.',
];

const state = {
  puuid: null,
  model: null,
  models: [],
  enabled: false,
  messages: [],
  streaming: false,
  // Published-page only: the key stays in memory (and sessionStorage, so a
  // reload inside the same tab does not re-prompt) and never in localStorage.
  geminiKey: null,
};

function staticCoach() {
  const data = window.__VACC_STATIC__;
  return (data && data.coach) || null;
}

const KEY_CACHE = 'vacc.coachkey';

function rememberKey(key) {
  state.geminiKey = key;
  try {
    sessionStorage.setItem(KEY_CACHE, key);
  } catch (err) {
    /* private mode: the key just lives for this page load */
  }
}

function recallKey() {
  if (state.geminiKey) return state.geminiKey;
  try {
    state.geminiKey = sessionStorage.getItem(KEY_CACHE) || null;
  } catch (err) {
    state.geminiKey = null;
  }
  return state.geminiKey;
}

function storageKey(puuid) {
  return `vacc.chat.${puuid}`;
}

function loadHistory(puuid) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(puuid)) || '[]');
  } catch (err) {
    return [];
  }
}

function saveHistory(puuid, messages) {
  try {
    localStorage.setItem(storageKey(puuid), JSON.stringify(messages.slice(-40)));
  } catch (err) {
    /* storage unavailable — the conversation just will not survive a reload */
  }
}

export async function initChat(models) {
  // On a published page there is no /api/models to ask, so the snapshot carries
  // the choices. Without this the model would be undefined and every request
  // would go to `models/undefined`.
  const locked = staticCoach();
  if (locked) {
    state.models = locked.models || [];
    state.enabled = true;
    state.model = locked.model || (state.models[0] && state.models[0].id);
    return;
  }
  state.models = models.models || [];
  state.enabled = !!models.enabled;
  state.model = models.default || (state.models[0] && state.models[0].id);
}

export function setAccount(puuid) {
  if (state.puuid === puuid) return;
  state.puuid = puuid;
  state.messages = loadHistory(puuid);
}

export function renderCoach(report, { pendingQuestion } = {}) {
  const locked = staticCoach();
  if (window.__VACC_STATIC__ && !locked) {
    return empty('Coach needs the local app',
      'This snapshot was published without a locked Gemini key.',
      h('p', null,
        'Run ', h('code', null, 'web/lock.html'), ' locally to encrypt your key under a '
        + 'passphrase, set the result as the ', h('code', null, 'COACH_KEY_BLOB'),
        ' repository variable, and republish. Or just run ',
        h('code', null, 'python3 run.py'), ' locally.'));
  }
  if (locked && !recallKey()) {
    return renderUnlock(report, locked);
  }
  if (!window.__VACC_STATIC__ && !state.enabled) {
    return empty('Coach is off',
      'No GEMINI_API_KEY in your .env, so there is nothing to ask.',
      h('p', null, 'Add a key from ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noreferrer' }, 'Google AI Studio'),
        ' to .env and restart. The key stays on your machine — the browser never sees it.'));
  }
  if (!report.overview.matches) {
    return empty('Nothing to coach yet', 'Sync some matches first — the coach answers from your real numbers, not general advice.');
  }

  const log = h('div', { class: 'chat-log' });
  const input = h('textarea', {
    placeholder: 'Ask about your stats… (Enter to send, Shift+Enter for a new line)',
    rows: 2,
  });
  const sendButton = h('button', { class: 'primary' }, 'Send');

  const modelSelect = h('select', {
    onchange: (event) => { state.model = event.target.value; },
  }, ...state.models.map((model) => h('option', {
    value: model.id,
    selected: model.id === state.model,
  }, model.label)));

  const container = h('div', { class: 'chat' },
    h('div', { class: 'chat-controls' },
      h('span', { class: 'muted' }, 'Model'),
      modelSelect,
      h('button', {
        class: 'ghost',
        onclick: () => {
          state.messages = [];
          saveHistory(state.puuid, state.messages);
          redraw();
        },
      }, 'Clear chat'),
      h('span', { class: 'muted', style: { fontSize: '12px' } },
        `Answers use your ${report.overview.matches} analysed matches as context.`)),
    h('div', { class: 'suggestions' }, ...SUGGESTIONS.map((question) =>
      h('button', { onclick: () => send(question) }, question))),
    log,
    h('form', {
      class: 'chat-form',
      onsubmit: (event) => { event.preventDefault(); send(input.value); },
    }, input, sendButton));

  function redraw() {
    clear(log);
    for (const message of state.messages) {
      log.appendChild(h('div', { class: `msg ${message.role === 'user' ? 'user' : 'model'}` },
        h('div', { class: 'who' }, message.role === 'user' ? 'You' : 'Coach'),
        h('div', { class: 'bubble', html: format(message.text) })));
    }
    log.scrollTop = log.scrollHeight;
  }

  async function send(text) {
    const question = (text || '').trim();
    if (!question || state.streaming) return;
    input.value = '';
    state.messages.push({ role: 'user', text: question });
    redraw();

    state.streaming = true;
    sendButton.disabled = true;
    const bubble = h('div', { class: 'bubble' }, h('span', { class: 'typing' }, 'thinking…'));
    const node = h('div', { class: 'msg model' }, h('div', { class: 'who' }, 'Coach'), bubble);
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;

    let answer = '';
    const outgoing = state.messages.map((m) => (
      { role: m.role === 'user' ? 'user' : 'model', text: m.text }));
    try {
      const send = staticCoach()
        ? (onChunk) => streamGemini({
          key: recallKey(),
          model: state.model,
          system: report.coach_system,
          messages: outgoing,
        }, onChunk)
        : (onChunk) => streamChat({
          puuid: state.puuid,
          model: state.model,
          queue: report.queue,
          messages: outgoing,
        }, onChunk);

      await send((chunk) => {
        answer += chunk;
        bubble.innerHTML = format(answer);
        log.scrollTop = log.scrollHeight;
      });
      state.messages.push({ role: 'model', text: answer });
      saveHistory(state.puuid, state.messages);
    } catch (err) {
      bubble.innerHTML = '';
      bubble.appendChild(h('span', { style: { color: 'var(--bad)' } }, err.message));
    } finally {
      state.streaming = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  redraw();
  if (pendingQuestion) {
    // Fired from an "Ask coach" button on another tab.
    setTimeout(() => send(pendingQuestion), 0);
  }
  return container;
}

function renderUnlock(report, locked) {
  const input = h('input', {
    type: 'password',
    placeholder: 'passphrase',
    autocomplete: 'off',
    style: { width: '100%', marginTop: '12px' },
  });
  const error = h('div', { class: 'modal-error' });
  const button = h('button', { class: 'primary' }, 'Unlock');

  async function attempt() {
    const passphrase = input.value;
    if (!passphrase) return;
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Deriving…';
    try {
      const key = await unlock(locked.blob, passphrase);
      rememberKey(key);
      // Re-render the tab, now unlocked.
      const view = document.getElementById('view');
      clear(view);
      view.appendChild(renderCoach(report, {}));
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Unlock';
    }
  }

  button.addEventListener('click', attempt);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') attempt(); });

  return h('div', { class: 'panel', style: { maxWidth: '520px', margin: '40px auto' } },
    h('h2', null, 'Coach is locked'),
    h('p', { class: 'muted', style: { marginTop: 0 } },
      'The Gemini key in this page is encrypted. Enter the passphrase you locked it '
      + 'with and the chat will talk to Gemini directly from your browser.'),
    input,
    error,
    button,
    h('p', { class: 'panel-note' },
      'The key is held for this tab only and is never written to long-term storage. '
      + 'Deriving the key takes a moment on purpose — that is what makes guessing '
      + 'the passphrase expensive.'));
}

async function streamChat(body, onChunk) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.error || `HTTP ${response.status}`);
  }

  await forEachSseEvent(response, (event, payload) => {
    if (event === 'chunk' && payload.text) onChunk(payload.text);
    else if (event === 'error') throw new Error(payload.message || 'Gemini failed');
  });
}

// Frames an SSE body into (event, parsedData) pairs. Both transports are SSE:
// the local server tags events, Gemini does not and just sends data lines.
async function forEachSseEvent(response, handler) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data || data === '[DONE]') continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (err) {
        continue;
      }
      handler(event, payload);
    }
  }
}

// Gemini's own SSE shape: candidates -> content -> parts -> text. Thinking
// summaries arrive as parts too and are skipped.
async function readSse(response, onChunk) {
  await forEachSseEvent(response, (_event, payload) => {
    for (const candidate of payload.candidates || []) {
      const content = candidate.content || {};
      for (const part of content.parts || []) {
        if (part.thought) continue;
        if (part.text) onChunk(part.text);
      }
    }
  });
}

// Published pages talk to Gemini directly — the API allows browser origins, so
// no server is needed once the key has been unlocked.
async function streamGemini({ key, model, system, messages }, onChunk) {
  if (!key) throw new Error('Coach is locked.');
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:streamGenerateContent`
    + `?alt=sse&key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages
        .filter((m) => (m.text || '').trim())
        .map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      systemInstruction: { parts: [{ text: system || '' }] },
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const failure = await response.json();
      detail = (failure.error && failure.error.message) || detail;
    } catch (err) { /* keep the status */ }
    if (response.status === 400 && /API key/i.test(detail)) {
      forgetKey();
      detail += ' — the unlocked key was rejected. Re-lock it and republish.';
    }
    throw new Error(detail);
  }

  await readSse(response, onChunk);
}

function forgetKey() {
  state.geminiKey = null;
  try {
    sessionStorage.removeItem(KEY_CACHE);
  } catch (err) { /* nothing to clear */ }
}

// Just enough markdown for a chat reply. Everything is escaped first, so model
// output can never inject markup.
function format(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '<span class="md-head">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}
