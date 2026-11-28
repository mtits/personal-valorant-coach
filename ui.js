// Small DOM and formatting helpers. No framework: the whole UI is a handful of
// render functions that return elements.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else el.setAttribute(key, value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export async function getJSON(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({ error: 'Bad response from the server' }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function postJSON(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({ error: 'Bad response from the server' }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export async function del(url) {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export const pct = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);
export const pct0 = (value) => (value === null || value === undefined ? '—' : `${Math.round(value)}%`);
export const num = (value, digits = 0) =>
  value === null || value === undefined ? '—' : Number(value).toFixed(digits);

export function ago(timestamp) {
  if (!timestamp) return '';
  const seconds = Date.now() / 1000 - timestamp;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  const days = Math.round(seconds / 86400);
  return days < 30 ? `${days}d ago` : new Date(timestamp * 1000).toLocaleDateString();
}

// Colour a win rate against a baseline, with a dead band so noise is not
// painted as signal.
export function rateClass(value, baseline = 50, band = 4) {
  if (value === null || value === undefined) return '';
  if (value >= baseline + band) return 'good';
  if (value <= baseline - band) return 'bad';
  return '';
}

export function bar(value, max = 100, variant = '') {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return h('div', { class: 'bar-track' },
    h('div', { class: `bar-fill ${variant}`.trim(), style: { width: `${width}%` } }));
}

export function tile(label, value, sub, cls = '') {
  return h('div', { class: 'tile' },
    h('div', { class: 'label' }, label),
    h('div', { class: `value ${cls}`.trim() }, value),
    sub ? h('div', { class: 'sub' }, sub) : null);
}

export function panel(title, ...children) {
  return h('div', { class: 'panel' }, title ? h('h2', null, title) : null, ...children);
}

export function table(headers, rows) {
  return h('div', { class: 'table-scroll' },
    h('table', null,
      h('thead', null, h('tr', null, ...headers.map((label) => h('th', null, label)))),
      h('tbody', null, ...rows)));
}

export function thinBadge(isThin, matches) {
  if (!isThin) return null;
  return h('span', { class: 'badge thin', title: 'Too few games to conclude from' },
    `${matches} game${matches === 1 ? '' : 's'}`);
}

export function empty(title, ...lines) {
  return h('div', { class: 'empty' },
    h('h2', null, title),
    ...lines.map((line) => (line instanceof Node ? line : h('p', null, line))));
}

// Heat colour for a win rate: red below 50, green above, muted in the middle.
export function heatStyle(rate, weight = 1) {
  if (rate === null || rate === undefined) return {};
  const distance = Math.max(-25, Math.min(25, rate - 50)) / 25;
  const alpha = (0.08 + Math.abs(distance) * 0.3) * weight;
  const colour = distance >= 0 ? '74, 222, 128' : '248, 113, 113';
  return { background: `rgba(${colour}, ${alpha.toFixed(3)})` };
}
