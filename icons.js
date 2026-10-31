// Agent / map / weapon art from valorant-api.com, resolved by name.
//
// Purely decorative: the lookup is fetched once, cached in localStorage for a
// day, and every failure path falls back to a letter tile. The app is fully
// usable with no network access to that host at all.

const CACHE_KEY = 'vacc.icons.v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const ENDPOINTS = {
  agents: 'https://valorant-api.com/v1/agents?isPlayableCharacter=true',
  maps: 'https://valorant-api.com/v1/maps',
  weapons: 'https://valorant-api.com/v1/weapons',
};

let lookup = { agents: {}, maps: {}, weapons: {} };
let loaded = false;

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.at || Date.now() - parsed.at > TTL_MS) return null;
    return parsed.data;
  } catch (err) {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch (err) {
    /* private mode or full storage — icons simply will not be cached */
  }
}

export async function loadIcons() {
  if (loaded) return lookup;
  const cached = readCache();
  if (cached) {
    lookup = cached;
    loaded = true;
    return lookup;
  }
  const next = { agents: {}, maps: {}, weapons: {} };
  await Promise.all(Object.entries(ENDPOINTS).map(async ([kind, url]) => {
    try {
      const response = await fetch(url);
      const payload = await response.json();
      for (const entry of payload.data || []) {
        const name = entry.displayName;
        const icon = kind === 'maps'
          ? (entry.listViewIcon || entry.splash)
          : entry.displayIcon;
        if (name && icon) next[kind][name.toLowerCase()] = icon;
      }
    } catch (err) {
      /* offline or blocked: leave this category empty */
    }
  }));
  lookup = next;
  loaded = true;
  writeCache(next);
  return lookup;
}

function url(kind, name) {
  if (!name) return null;
  return lookup[kind][String(name).toLowerCase()] || null;
}

// An <img> when art is available, a letter tile when it is not.
export function icon(kind, name) {
  const src = url(kind, name);
  if (src) {
    const img = document.createElement('img');
    img.className = 'icon';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(letterTile(name));
    return img;
  }
  return letterTile(name);
}

function letterTile(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.justifyContent = 'center';
  span.style.fontSize = '11px';
  span.style.color = 'var(--muted)';
  span.textContent = (name || '?').slice(0, 2).toUpperCase();
  return span;
}
