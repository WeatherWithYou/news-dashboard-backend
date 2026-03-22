<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>The Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0a0a0f;
      --surface:   #13131a;
      --surface2:  #1a1a24;
      --border:    #22222e;
      --border-hi: #32323f;
      --text:      #e6e4f0;
      --muted:     #6b6880;
      --accent:    #7c6dfa;
      --accent-lo: rgba(124,109,250,0.07);
      --red:       #f05e6a;
      --green:     #3ecf8e;
      --col-abc:       #7c6dfa;
      --col-cnn:       #f05e6a;
      --col-aljazeera: #f0a05e;
      --col-nzherald:  #3ecf8e;
      --col-tech:      #5b9cf6;
      --col-sport:     #3ecf8e;
      --col-science:   #f0a05e;
      --col-business:  #b06dfa;
      --serif: 'DM Serif Display', Georgia, serif;
      --mono:  'DM Mono', monospace;
      --sans:  'DM Sans', system-ui, sans-serif;
    }

    html { background: var(--bg); color: var(--text); font-family: var(--sans); }
    body { min-height: 100vh; }

    /* ─── Header ─── */
    header {
      position: sticky; top: 0; z-index: 100;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .header-left { display: flex; align-items: baseline; gap: 16px; padding: 14px 0; }
    .masthead { font-family: var(--serif); font-size: 24px; color: var(--text); }
    .masthead span { color: var(--accent); }
    .dateline { font-family: var(--mono); font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
    .header-right { display: flex; align-items: center; gap: 12px; }
    .refresh-btn {
      font-family: var(--mono); font-size: 11px; color: var(--muted);
      background: none; border: 1px solid var(--border); border-radius: 6px;
      padding: 6px 14px; cursor: pointer; transition: all 0.15s; letter-spacing: 0.04em;
    }
    .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
    .refresh-btn.spinning { opacity: 0.4; pointer-events: none; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

    /* ─── Widgets row ─── */
    .widgets-row {
      display: grid;
      grid-template-columns: 1fr 400px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Stocks ── */
    .stocks-panel { border-right: 1px solid var(--border); padding: 14px 20px 16px; display: flex; flex-direction: column; gap: 10px; }
    .panel-label { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
    .stocks-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
    .stock-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 12px; transition: border-color 0.15s;
    }
    .stock-card:hover { border-color: var(--border-hi); }
    .stock-name { font-family: var(--mono); font-size: 10px; color: var(--muted); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stock-price { font-family: var(--sans); font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
    .stock-change { font-family: var(--mono); font-size: 10px; font-weight: 500; }
    .stock-change.up   { color: var(--green); }
    .stock-change.down { color: var(--red); }
    .stock-skel { height: 62px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; animation: shimmer 1.5s ease infinite; }

    /* ── Weather ── */
    .weather-panel { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
    .weather-header { display: flex; align-items: center; justify-content: space-between; }
    .weather-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      flex: 1;
    }
    .weather-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: border-color 0.15s;
    }
    .weather-card:hover { border-color: var(--border-hi); }
    .weather-city { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 2px; }
    .weather-temp { font-family: var(--sans); font-size: 20px; font-weight: 600; color: var(--text); line-height: 1; }
    .weather-temp span { font-size: 12px; font-weight: 400; color: var(--muted); }
    .weather-desc { font-family: var(--sans); font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .weather-row { display: flex; gap: 8px; margin-top: 2px; }
    .weather-stat { font-family: var(--mono); font-size: 9px; color: var(--muted); }
    .weather-stat b { color: var(--text); font-weight: 500; }
    .weather-minmax { font-family: var(--mono); font-size: 9px; }
    .weather-max { color: #e74c3c; }
    .weather-min { color: #5b9cf6; }
    .weather-skel { height: 88px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; animation: shimmer 1.5s ease infinite; }

    /* ─── Nav ─── */
    nav { border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; overflow-x: auto; }
    nav::-webkit-scrollbar { display: none; }
    .nav-item {
      font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
      padding: 10px 16px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent;
      transition: all 0.15s; white-space: nowrap; background: none;
      border-top: none; border-left: none; border-right: none;
      display: flex; align-items: center; gap: 7px;
    }
    .nav-item:hover { color: var(--text); }
    .nav-item.active { color: var(--text); border-bottom-color: var(--cat-color, var(--accent)); }
    .nav-item .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--cat-color, var(--muted)); opacity: 0.6; }
    .nav-item.active .dot { opacity: 1; background: var(--cat-color, var(--accent)); }

    /* ─── Main grid ─── */
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); border-left: 1px solid var(--border); }

    /* ─── Column ─── */
    .column { border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); display: flex; flex-direction: column; animation: fadeIn 0.35s ease both; }
    @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    .column-header {
      padding: 14px 20px 12px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 57px; background: var(--bg); z-index: 10;
    }
    .column-title { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--cat-color, var(--accent)); display: flex; align-items: center; gap: 8px; }
    .column-title::before { content: ''; display: block; width: 12px; height: 1.5px; background: var(--cat-color, var(--accent)); border-radius: 2px; }
    .article-count { font-family: var(--mono); font-size: 10px; color: var(--muted); }

    /* ─── Article card ─── */
    .article {
      padding: 14px 20px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.12s;
      text-decoration: none; display: block; color: inherit;
    }
    .article:last-child { border-bottom: none; }
    .article:hover { background: var(--accent-lo); }

    /* Image + text layout */
    .article-inner { display: flex; gap: 12px; align-items: flex-start; }
    .article-img {
      width: 72px; height: 52px; object-fit: cover; border-radius: 4px;
      flex-shrink: 0; background: var(--surface); display: block;
    }
    .article-img-placeholder { width: 72px; height: 52px; border-radius: 4px; flex-shrink: 0; background: var(--surface); border: 1px solid var(--border); }
    .article-body { flex: 1; min-width: 0; }

    .article-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
    .source-tag { font-family: var(--mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--cat-color, var(--accent)); opacity: 0.8; }
    .article-time { font-family: var(--mono); font-size: 9px; color: var(--muted); }

    .article-title {
      font-family: var(--serif); font-size: 14px; font-weight: 400;
      line-height: 1.38; color: var(--text); margin-bottom: 5px; transition: color 0.12s;
    }
    .article:hover .article-title { color: var(--cat-color, var(--accent)); }
    .article-summary {
      font-family: var(--sans); font-size: 11px; font-weight: 300; color: var(--muted);
      line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }

    /* ─── Skeletons ─── */
    .skeleton { animation: shimmer 1.5s ease infinite; }
    @keyframes shimmer { 0%,100%{opacity:0.3} 50%{opacity:0.65} }
    .skel-line { height: 12px; background: var(--border); border-radius: 3px; margin-bottom: 8px; }
    .skel-line.wide { width: 88%; } .skel-line.med { width: 62%; } .skel-line.short { width: 38%; }
    .skel-meta { display: flex; gap: 8px; margin-bottom: 10px; }
    .skel-tag { height: 9px; width: 55px; background: var(--border); border-radius: 3px; }
    .skel-time { height: 9px; width: 40px; background: var(--border); border-radius: 3px; }
    .skel-img { width: 72px; height: 52px; background: var(--border); border-radius: 4px; flex-shrink: 0; }

    /* ─── Error/empty ─── */
    .error-card { padding: 20px; font-family: var(--mono); font-size: 11px; color: var(--red); opacity: 0.7; line-height: 1.6; }
    .empty { padding: 32px 20px; text-align: center; font-family: var(--mono); font-size: 11px; color: var(--muted); }

    /* ─── Footer ─── */
    footer { border-top: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
    .footer-note { font-family: var(--mono); font-size: 10px; color: var(--muted); }
    .footer-note a { color: var(--muted); text-decoration: none; }
    .footer-note a:hover { color: var(--accent); }

    ::-webkit-scrollbar { width: 3px; height: 3px; }
    ::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }

    @media (max-width: 900px) {
      .widgets-row { grid-template-columns: 1fr; }
      .weather-panel { border-top: 1px solid var(--border); }
      .stocks-grid { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 600px) { .stocks-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>

<header>
  <div class="header-left">
    <div class="masthead">The<span>.</span>Dashboard</div>
    <div class="dateline" id="dateline"></div>
  </div>
  <div class="header-right">
    <div class="status-dot"></div>
    <button class="refresh-btn" id="refresh-btn" onclick="refreshAll()">↻ Refresh</button>
  </div>
</header>

<div class="widgets-row">
  <!-- Stocks -->
  <div class="stocks-panel">
    <div class="panel-label">Markets</div>
    <div class="stocks-grid" id="stocks-grid">
      <div class="stock-skel"></div><div class="stock-skel"></div><div class="stock-skel"></div>
      <div class="stock-skel"></div><div class="stock-skel"></div><div class="stock-skel"></div>
    </div>
  </div>
  <!-- BOM Weather city list -->
  <div class="weather-panel">
    <div class="weather-header">
      <div class="panel-label">Australia — BOM live observations</div>
      <div class="panel-label" id="weather-updated"></div>
    </div>
    <div class="weather-grid" id="weather-grid">
      <div class="weather-skel"></div><div class="weather-skel"></div>
      <div class="weather-skel"></div><div class="weather-skel"></div>
      <div class="weather-skel"></div><div class="weather-skel"></div>
      <div class="weather-skel"></div><div class="weather-skel"></div>
    </div>
  </div>
</div>

<nav id="category-nav"></nav>
<main id="grid"></main>

<footer>
  <div class="footer-note">
    News via <a href="https://news-dashboard-backend-production.up.railway.app/api/news" target="_blank">Railway backend</a>
    &nbsp;·&nbsp; Weather: <a href="https://www.bom.gov.au" target="_blank">Bureau of Meteorology</a>
    &nbsp;·&nbsp; Stocks: Yahoo Finance
  </div>
  <div class="footer-note" id="last-updated"></div>
</footer>

<script>
// ═══════════════════════════════════════════════════════════════
// CONFIG — update API_BASE if your Railway URL changes
// ═══════════════════════════════════════════════════════════════
const API_BASE = 'https://news-dashboard-backend-production.up.railway.app';

const CATEGORY_META = {
  abc:       { label: 'ABC News AU',  color: 'var(--col-abc)'       },
  cnn:       { label: 'CNN',          color: 'var(--col-cnn)'        },
  aljazeera: { label: 'Al Jazeera',   color: 'var(--col-aljazeera)'  },
  nzherald:  { label: 'NZ News',      color: 'var(--col-nzherald)'   },
  tech:      { label: 'Tech',         color: 'var(--col-tech)'       },
  sport:     { label: 'Sport',        color: 'var(--col-sport)'      },
  science:   { label: 'Science',      color: 'var(--col-science)'    },
  business:  { label: 'Business',     color: 'var(--col-business)'   },
};

const DEFAULT_VISIBLE = ['abc', 'cnn', 'aljazeera', 'nzherald'];
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const STOCK_META = {
  '^DJI':  { label: 'Dow Jones' },
  '^AXJO': { label: 'ASX 200'   },
  '^NZ50': { label: 'NZX 50'    },
  '^HSI':  { label: 'Hang Seng' },
  '^FTSE': { label: 'FTSE 100'  },
  '^IXIC': { label: 'NASDAQ'    },
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let visibleCategories = [...DEFAULT_VISIBLE];
let articleData = {};
let allCategories = [];

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  updateDateline();
  setInterval(updateDateline, 30_000);

  fetchStocks();
  fetchWeather();

  allCategories = await fetchCategories();
  renderNav();
  renderColumns();
  fetchAllData();

  if (AUTO_REFRESH_MS > 0) {
    setInterval(() => { fetchStocks(); fetchWeather(); fetchAllData(); }, AUTO_REFRESH_MS);
  }
});

// ═══════════════════════════════════════════════════════════════
// STOCKS — now fetched via Railway proxy
// ═══════════════════════════════════════════════════════════════
async function fetchStocks() {
  try {
    const res    = await fetch(`${API_BASE}/api/stocks`);
    const quotes = await res.json();
    if (!Array.isArray(quotes)) throw new Error('Bad response');
    renderStocks(quotes);
  } catch (err) {
    console.warn('Stocks error:', err.message);
    document.getElementById('stocks-grid').innerHTML =
      Object.values(STOCK_META).map(s =>
        `<div class="stock-card">
          <div class="stock-name">${s.label}</div>
          <div class="stock-price" style="color:var(--muted);font-size:12px">Unavailable</div>
        </div>`
      ).join('');
  }
}

function renderStocks(quotes) {
  const bySymbol = {};
  quotes.forEach(q => { bySymbol[q.symbol] = q; });

  document.getElementById('stocks-grid').innerHTML =
    Object.entries(STOCK_META).map(([sym, meta]) => {
      const q = bySymbol[sym];
      if (!q) return `<div class="stock-card"><div class="stock-name">${meta.label}</div><div class="stock-price" style="color:var(--muted)">—</div></div>`;
      const up  = q.regularMarketChange >= 0;
      return `<div class="stock-card">
        <div class="stock-name">${meta.label}</div>
        <div class="stock-price">${fmtPrice(q.regularMarketPrice)}</div>
        <div class="stock-change ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(q.regularMarketChangePercent).toFixed(2)}%</div>
      </div>`;
    }).join('');
}

function fmtPrice(p) {
  if (p == null) return '—';
  return p >= 1000 ? Math.round(p).toLocaleString() : p.toFixed(2);
}

// ═══════════════════════════════════════════════════════════════
// WEATHER — fetched from Railway which proxies BOM JSON feeds
// ═══════════════════════════════════════════════════════════════
async function fetchWeather() {
  try {
    const res  = await fetch(`${API_BASE}/api/weather`);
    const data = await res.json();
    renderWeatherCards(data);
    document.getElementById('weather-updated').textContent =
      'BOM · ' + new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.warn('Weather error:', err.message);
    document.getElementById('weather-grid').innerHTML =
      '<div style="font-family:var(--mono);font-size:11px;color:var(--red);padding:12px;grid-column:1/-1">⚠ Weather unavailable — deploy the updated server.js to Railway</div>';
  }
}

function tempColor(t) {
  if (t === null) return 'var(--muted)';
  if (t >= 40) return '#c0392b';
  if (t >= 35) return '#e74c3c';
  if (t >= 30) return '#e67e22';
  if (t >= 25) return '#f1c40f';
  if (t >= 20) return '#27ae60';
  if (t >= 15) return '#2980b9';
  return '#8e44ad';
}

function renderWeatherCards(cities) {
  document.getElementById('weather-grid').innerHTML = cities.map(c => {
    const color  = tempColor(c.temp);
    const temp   = c.temp  !== null ? `${c.temp}` : '—';
    const feels  = c.feels !== null ? `${c.feels}°` : '—';
    const humid  = c.humidity !== null ? `${c.humidity}%` : '—';
    const maxT   = c.max  !== null && c.max  !== undefined ? `${c.max}°` : '—';
    const minT   = c.min  !== null && c.min  !== undefined ? `${c.min}°` : '—';
    const desc   = c.desc || '';
    return `<div class="weather-card">
      <div class="weather-city">${c.city}</div>
      <div class="weather-temp" style="color:${color}">${temp}<span>°C</span></div>
      ${desc ? `<div class="weather-desc">${desc}</div>` : ''}
      <div class="weather-row">
        <span class="weather-minmax"><span class="weather-max">↑${maxT}</span> <span class="weather-min">↓${minT}</span></span>
      </div>
      <div class="weather-row">
        <span class="weather-stat">Feels <b>${feels}</b></span>
        <span class="weather-stat">Hum <b>${humid}</b></span>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// NEWS
// ═══════════════════════════════════════════════════════════════
async function fetchCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    return await res.json();
  } catch { return Object.keys(CATEGORY_META); }
}

async function fetchCategory(cat) {
  const res = await fetch(`${API_BASE}/api/news/${cat}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).articles;
}

async function fetchAllData() {
  setRefreshing(true);
  const results = await Promise.allSettled(
    visibleCategories.map(async cat => [cat, await fetchCategory(cat)])
  );
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      const [cat, articles] = r.value;
      articleData[cat] = { articles, error: null };
    }
  });
  renderColumns();
  setRefreshing(false);
  document.getElementById('last-updated').textContent =
    'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function refreshAll() {
  fetchStocks();
  fetchWeather();
  await fetchAllData();
}

// ─── Render ─────────────────────────────────────────────────────
function renderNav() {
  document.getElementById('category-nav').innerHTML = allCategories.map(cat => {
    const meta   = CATEGORY_META[cat] || { label: cat, color: 'var(--muted)' };
    const active = visibleCategories.includes(cat);
    return `<button class="nav-item ${active ? 'active' : ''}" style="--cat-color:${meta.color}" onclick="toggleCategory('${cat}')">
      <span class="dot"></span>${meta.label}
    </button>`;
  }).join('');
}

function renderColumns() {
  document.getElementById('grid').innerHTML = visibleCategories.map((cat, i) => {
    const meta  = CATEGORY_META[cat] || { label: cat, color: 'var(--muted)' };
    const state = articleData[cat];
    let content;
    if (!state)            content = renderSkeletons(6);
    else if (state.error)  content = `<div class="error-card">⚠ Could not load stories.<br><br>Make sure your Railway backend is running and this URL is reachable:<br><a href="${API_BASE}/api/news/${cat}" target="_blank" style="color:var(--accent)">${API_BASE}/api/news/${cat}</a></div>`;
    else if (!state.articles.length) content = `<div class="empty">No articles found.</div>`;
    else content = state.articles.map(renderArticle).join('');
    const count = state?.articles?.length ?? '…';
    return `<section class="column" style="--cat-color:${meta.color};animation-delay:${i*0.05}s">
      <div class="column-header">
        <div class="column-title">${meta.label}</div>
        <div class="article-count">${count} stories</div>
      </div>
      ${content}
    </section>`;
  }).join('');
}

function renderArticle(a) {
  const safe = s => (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const time = a.published ? formatTime(new Date(a.published)) : '';
  const imgHtml = a.image
    ? `<img class="article-img" src="${a.image}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="article-img-placeholder"></div>`;

  return `<a class="article" href="${safe(a.link)}" target="_blank" rel="noopener">
    <div class="article-inner">
      ${imgHtml}
      <div class="article-body">
        <div class="article-meta">
          <span class="source-tag">${safe(a.source)}</span>
          ${time ? `<span class="article-time">${time}</span>` : ''}
        </div>
        <div class="article-title">${safe(a.title)}</div>
        ${a.summary ? `<div class="article-summary">${safe(a.summary.slice(0,160))}</div>` : ''}
      </div>
    </div>
  </a>`;
}

function renderSkeletons(n) {
  return Array.from({length: n}, (_, i) => `
    <div class="article skeleton" style="animation-delay:${i*0.07}s">
      <div class="article-inner">
        <div class="skel-img"></div>
        <div style="flex:1">
          <div class="skel-meta"><div class="skel-tag"></div><div class="skel-time"></div></div>
          <div class="skel-line wide"></div><div class="skel-line med"></div>
        </div>
      </div>
    </div>`).join('');
}

// ─── Interactions ────────────────────────────────────────────────
function toggleCategory(cat) {
  if (visibleCategories.includes(cat)) {
    if (visibleCategories.length === 1) return;
    visibleCategories = visibleCategories.filter(c => c !== cat);
  } else {
    visibleCategories.push(cat);
    fetch(`${API_BASE}/api/news/${cat}`)
      .then(r => r.json())
      .then(d => { articleData[cat] = { articles: d.articles, error: null }; renderColumns(); })
      .catch(() => { articleData[cat] = { articles: [], error: true }; renderColumns(); });
  }
  renderNav();
  renderColumns();
}

function setRefreshing(on) {
  const btn = document.getElementById('refresh-btn');
  btn.classList.toggle('spinning', on);
  btn.textContent = on ? '↻ Loading…' : '↻ Refresh';
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatTime(date) {
  const s = (Date.now() - date) / 1000;
  if (isNaN(s) || s < 0) return '';
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  // For older stories show actual date
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function updateDateline() {
  document.getElementById('dateline').textContent =
    new Date().toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).toUpperCase();
}
</script>
</body>
</html>
