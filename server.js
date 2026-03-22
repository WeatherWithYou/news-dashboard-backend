const express  = require('express');
const cors     = require('cors');
const cheerio  = require('cheerio');
const Parser   = require('rss-parser');

const app  = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// User-agent rotation
// ---------------------------------------------------------------------------
const UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
];
let uaIdx = 0;

async function get(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA[uaIdx++ % UA.length],
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
      'Cache-Control': 'no-cache',
      ...opts.headers,
    },
    signal: AbortSignal.timeout(12000),
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res;
}

async function getJSON(url, opts = {}) {
  const res = await get(url, { headers: { Accept: 'application/json', ...opts.headers }, ...opts });
  return res.json();
}

async function getHTML(url, opts = {}) {
  return (await get(url, opts)).text();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clean(s) {
  return (s || '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(a => {
    if (!a || !a.title || a.title.length < 12) return false;
    const key = a.title.slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeArticle(title, link, source, summary = '', published = null, image = null) {
  if (!title || !link || link === '#') return null;
  // Sanitise image — must be a proper http/https URL
  const img = (image && /^https?:\/\//.test(image)) ? image : null;
  return { title: clean(title), link, summary: clean(summary), published, source, image: img };
}

// Extract image from RSS item (checks all common media namespaces)
function rssImage(item) {
  return item?.enclosure?.url ||
    item?.['media:content']?.$.url ||
    item?.['media:thumbnail']?.$.url ||
    item?.['media:content']?.url ||
    item?.itunes?.image ||
    null;
}

// Extract first <img src> from an HTML string
function firstImgSrc(html) {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// ABC News Australia
// ---------------------------------------------------------------------------
async function scrapeABC() {
  const articles = [];

  // Strategy 1: ABC internal JSON API
  try {
    const data  = await getJSON(
      'https://www.abc.net.au/news-web/api/loader/channelrefetch?name=PaginationArticleList&documentId=13437&offset=0&size=20&total=20',
      { headers: { Referer: 'https://www.abc.net.au/news' } }
    );
    const items = data?.items || data?.data?.items || [];
    items.forEach(item => {
      const image =
        item.image?.ratio16x9?.inline?.src ||
        item.image?.ratio16x9?.full?.src   ||
        item.image?.primary?.src           ||
        item.thumbnail?.url                ||
        item.teaserImage?.ratio16x9?.url   ||
        null;
      const a = makeArticle(
        item.title || item.headline,
        item.link  ? `https://www.abc.net.au${item.link}` : item.url,
        'ABC News AU',
        item.synopsis || item.description,
        item.updated  || item.published,
        image
      );
      if (a) articles.push(a);
    });
  } catch (_) {}

  // Strategy 2: scrape Just In page, extract article cards with images
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.abc.net.au/news/justin');
      const $    = cheerio.load(html);
      $('article, [class*="story"], [class*="Article"], [class*="card"]').each((_, el) => {
        const a_el  = $(el).find('a[href]').first();
        const href  = a_el.attr('href') || '';
        const title = $(el).find('h1,h2,h3,[class*="title"],[class*="heading"]').first().text().trim()
                   || a_el.text().trim();
        const img   = $(el).find('img').first().attr('src')
                   || $(el).find('img').first().attr('data-src')
                   || null;
        if (title.length > 20 && /\/news\/\d{4}-\d{2}-\d{2}\//.test(href)) {
          const a = makeArticle(title, `https://www.abc.net.au${href}`, 'ABC News AU', '', null, img);
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  // Strategy 3: plain link scrape fallback
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.abc.net.au/news');
      const $    = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 20 && href.includes('/news/') && href.includes('-')) {
          const link = href.startsWith('http') ? href : `https://www.abc.net.au${href}`;
          const a = makeArticle(title, link, 'ABC News AU');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// Reuters
// ---------------------------------------------------------------------------
async function scrapeBBC() {
  const articles = [];

  // Strategy 1: BBC News RSS — most reliable, includes images via media:thumbnail
  try {
    const rssP = new Parser({
      timeout: 10000,
      headers: { 'User-Agent': UA[0] },
      customFields: { item: [['media:thumbnail','media:thumbnail',{keepArray:false}],['media:content','media:content',{keepArray:false}]] },
    });
    const feed = await rssP.parseURL('https://feeds.bbci.co.uk/news/rss.xml');
    feed.items.slice(0, 20).forEach(item => {
      const img = item['media:thumbnail']?.$.url || item['media:content']?.$.url || null;
      const a = makeArticle(item.title, item.link, 'BBC News', item.contentSnippet || '', item.pubDate, img);
      if (a) articles.push(a);
    });
  } catch (_) {}

  // Strategy 2: BBC Top Stories RSS
  if (articles.length < 5) {
    try {
      const rssP = new Parser({ timeout: 10000, headers: { 'User-Agent': UA[0] } });
      const feed = await rssP.parseURL('https://feeds.bbci.co.uk/news/world/rss.xml');
      feed.items.slice(0, 15).forEach(item => {
        const a = makeArticle(item.title, item.link, 'BBC News', item.contentSnippet || '', item.pubDate, null);
        if (a) articles.push(a);
      });
    } catch (_) {}
  }

  // Strategy 3: Scrape BBC News front page
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.bbc.com/news');
      const $    = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 20 && /\/news\/articles\/|bbc\.co\.uk\/news\/[a-z]/.test(href)) {
          const full = href.startsWith('http') ? href : `https://www.bbc.com${href}`;
          const a = makeArticle(title, full, 'BBC News');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// Australian Financial Review (AFR)
// AFR is paywalled but headline teasers are publicly visible
// ---------------------------------------------------------------------------
async function scrapeAFR() {
  const articles = [];

  // Strategy 1: AFR RSS feed
  try {
    const rssP = new Parser({ timeout: 10000, headers: { 'User-Agent': UA[0] },
      customFields: { item: [['media:content','media:content',{keepArray:false}],['media:thumbnail','media:thumbnail',{keepArray:false}]] } });
    const feed = await rssP.parseURL('https://www.afr.com/rss');
    feed.items.slice(0, 15).forEach(item => {
      const a = makeArticle(item.title, item.link, 'AFR', item.contentSnippet, item.pubDate, rssImage(item));
      if (a) articles.push(a);
    });
  } catch (_) {}

  // Strategy 2: scrape AFR front page for teasers
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.afr.com');
      const $    = cheerio.load(html);
      $('article, [class*="story"], [class*="Card"], [class*="article"]').each((_, el) => {
        const a_el  = $(el).find('a[href]').first();
        const href  = a_el.attr('href') || '';
        const title = $(el).find('h2,h3,[class*="title"],[class*="headline"]').first().text().trim() || a_el.text().trim();
        const img   = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null;
        if (title.length > 15 && href && !href.includes('/subscribe') && !href.includes('/login')) {
          const full = href.startsWith('http') ? href : `https://www.afr.com${href}`;
          const a = makeArticle(title, full, 'AFR', '', null, img);
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  // Strategy 3: generic link scrape
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.afr.com');
      const $    = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 20 && /afr\.com\/[a-z]/.test(href) && !href.includes('subscribe') && !href.includes('login')) {
          const full = href.startsWith('http') ? href : `https://www.afr.com${href}`;
          const a = makeArticle(title, full, 'AFR');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// Al Jazeera
// ---------------------------------------------------------------------------
async function scrapeAlJazeera() {
  const articles = [];

  // Strategy 1: WordPress REST API with _embed for full featured images
  try {
    const data = await getJSON(
      'https://www.aljazeera.com/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&_embed=wp:featuredmedia',
      { headers: { Referer: 'https://www.aljazeera.com/' } }
    );
    if (Array.isArray(data)) {
      data.forEach(post => {
        const title   = post.title?.rendered;
        const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '');
        const media   = post._embedded?.['wp:featuredmedia']?.[0];
        const image   = media?.media_details?.sizes?.medium_large?.source_url ||
                        media?.media_details?.sizes?.large?.source_url ||
                        media?.source_url ||
                        post.jetpack_featured_media_url ||
                        null;
        const a = makeArticle(title, post.link, 'Al Jazeera', excerpt, post.date, image);
        if (a) articles.push(a);
      });
    }
  } catch (_) {}

  // Strategy 2: scrape /news/ with broad lazy-load image selectors
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.aljazeera.com/news/');
      const $    = cheerio.load(html);
      $('article, [class*="article-card"], [class*="ArticleCard"]').each((_, el) => {
        const link  = $(el).find('a[href]').first().attr('href') || '';
        const title = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim()
                   || $(el).find('a').first().text().trim();
        const imgEl = $(el).find('img').first();
        const img   = imgEl.attr('src') || imgEl.attr('data-src') ||
                      imgEl.attr('data-lazy-src') || imgEl.attr('data-original') || null;
        if (title.length > 15 && link) {
          const full = link.startsWith('http') ? link : `https://www.aljazeera.com${link}`;
          const a = makeArticle(title, full, 'Al Jazeera', $(el).find('p').first().text(), null, img);
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  // Strategy 3: generic link scrape
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.aljazeera.com');
      const $    = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 20 && /(news|features|opinions)/.test(href) && /\/20\d{2}\//.test(href)) {
          const full = href.startsWith('http') ? href : `https://www.aljazeera.com${href}`;
          const a = makeArticle(title, full, 'Al Jazeera');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  return dedup(articles).slice(0, 15);
}


async function scrapeNZHerald() {
  const articles = [];

  // NZ Herald /latest-news/
  try {
    const html = await getHTML('https://www.nzherald.co.nz/latest-news/');
    const $    = cheerio.load(html);
    $('article, [class*="story-card"], [class*="article"]').each((_, el) => {
      const a_el  = $(el).find('a[href]').first();
      const href  = a_el.attr('href') || '';
      const title = $(el).find('h2,h3,[class*="title"],[class*="heading"]').first().text().trim()
                 || a_el.text().trim();
      const img   = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') ||
                    $(el).find('img').first().attr('data-lazy-src') || $(el).find('img').first().attr('data-original') || null;
      if (title.length > 15 && href && !href.includes('/account') && !href.includes('/subscribe')) {
        const full = href.startsWith('http') ? href : `https://www.nzherald.co.nz${href}`;
        const a = makeArticle(title, full, 'NZ Herald', '', null, img);
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // Stuff.co.nz
  try {
    const html = await getHTML('https://www.stuff.co.nz');
    const $    = cheerio.load(html);
    $('article, [class*="story"], [class*="card"]').each((_, el) => {
      const a_el  = $(el).find('a[href]').first();
      const href  = a_el.attr('href') || '';
      const title = $(el).find('h2,h3,[class*="title"]').first().text().trim()
                 || a_el.text().trim();
      const img   = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') ||
                    $(el).find('img').first().attr('data-lazy-src') || $(el).find('img').first().attr('data-original') || null;
      if (title.length > 20 && /stuff\.co\.nz\/[a-z\-]+\/\d+/.test(href)) {
        const full = href.startsWith('http') ? href : `https://www.stuff.co.nz${href}`;
        const a = makeArticle(title, full, 'Stuff NZ', '', null, img);
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // RNZ RSS (reliable, includes images via media:content)
  try {
    const rssP = new Parser({
      timeout: 10000,
      headers: { 'User-Agent': UA[0] },
      customFields: { item: [['media:content', 'media:content', { keepArray: false }], ['media:thumbnail', 'media:thumbnail', { keepArray: false }]] },
    });
    const feed = await rssP.parseURL('https://www.rnz.co.nz/rss/news.xml');
    feed.items.slice(0, 8).forEach(item => {
      const a = makeArticle(item.title, item.link, 'RNZ', item.contentSnippet, item.pubDate, rssImage(item));
      if (a) articles.push(a);
    });
  } catch (_) {}

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// RSS-based categories (tech, sport, science, business)
// ---------------------------------------------------------------------------
const rssParser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': UA[0] },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
    ],
  },
});

const RSS_FEEDS = {
  tech: [
    { name: 'The Verge',    url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'Hacker News',  url: 'https://hnrss.org/frontpage' },
  ],
  sport: [
    { name: 'BBC Sport',    url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
    { name: 'ESPN',         url: 'https://www.espn.com/espn/rss/news' },
  ],
  science: [
    { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/' },
    { name: 'Phys.org',      url: 'https://phys.org/rss-feed/breaking/' },
    { name: 'NASA',          url: 'https://www.nasa.gov/news-release/feed/' },
  ],
  business: [
    { name: 'Reuters Biz',  url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'Bloomberg',    url: 'https://feeds.bloomberg.com/markets/news.rss' },
  ],
};

async function fetchRSSFeed(feed) {
  try {
    const parsed = await rssParser.parseURL(feed.url);
    return parsed.items.slice(0, 10).map(item => ({
      title:     clean(item.title || ''),
      link:      item.link || item.guid || '#',
      summary:   clean(item.contentSnippet || ''),
      published: item.pubDate || item.isoDate || null,
      source:    feed.name,
      image:     rssImage(item),
    })).filter(a => a.title.length > 10);
  } catch (err) {
    console.warn(`  RSS fail [${feed.name}]: ${err.message}`);
    return [];
  }
}

async function fetchRSSCategory(cat) {
  const results = await Promise.all((RSS_FEEDS[cat] || []).map(fetchRSSFeed));
  return results.flat().sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}

// ---------------------------------------------------------------------------
// Dispatch + cache
// ---------------------------------------------------------------------------
const SCRAPERS = { abc: scrapeABC, bbc: scrapeBBC, aljazeera: scrapeAlJazeera, nzherald: scrapeNZHerald, afr: scrapeAFR };
const ALL_CATEGORIES = [...Object.keys(SCRAPERS), ...Object.keys(RSS_FEEDS)];

const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getArticles(category) {
  const now = Date.now();
  if (cache[category] && now - cache[category].ts < CACHE_TTL) return cache[category].data;
  console.log(`  → [${category}]`);
  let articles = [];
  try {
    articles = SCRAPERS[category] ? await SCRAPERS[category]() : await fetchRSSCategory(category);
  } catch (err) {
    console.error(`  ✗ [${category}]: ${err.message}`);
  }
  cache[category] = { ts: now, data: articles };
  return articles;
}

// ---------------------------------------------------------------------------
// BOM Weather proxy
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// BOM Weather proxy — with Open-Meteo fallback for desc/min/max
// BOM JSON field names: air_temp, apparent_t, rel_hum, wind_spd_kmh,
//   weather (desc), maximum_air_temp, minimum_air_temp
// ---------------------------------------------------------------------------
const BOM_STATIONS = [
  { city: 'Sydney',    url: 'http://www.bom.gov.au/fwo/IDN60901/IDN60901.94768.json', lat: -33.87, lon: 151.21 },
  { city: 'Melbourne', url: 'http://www.bom.gov.au/fwo/IDV60901/IDV60901.95936.json', lat: -37.81, lon: 144.96 },
  { city: 'Brisbane',  url: 'http://www.bom.gov.au/fwo/IDQ60901/IDQ60901.94576.json', lat: -27.47, lon: 153.03 },
  { city: 'Perth',     url: 'http://www.bom.gov.au/fwo/IDW60901/IDW60901.94608.json', lat: -31.95, lon: 115.86 },
  { city: 'Adelaide',  url: 'http://www.bom.gov.au/fwo/IDS60901/IDS60901.94675.json', lat: -34.93, lon: 138.60 },
  { city: 'Darwin',    url: 'http://www.bom.gov.au/fwo/IDD60901/IDD60901.94120.json', lat: -12.46, lon: 130.84 },
  { city: 'Hobart',    url: 'http://www.bom.gov.au/fwo/IDT60901/IDT60901.94970.json', lat: -42.88, lon: 147.33 },
  { city: 'Alice Sp.', url: 'http://www.bom.gov.au/fwo/IDD60901/IDD60901.94240.json', lat: -23.70, lon: 133.88 },
];

// WMO weather code → human description (Open-Meteo fallback)
function wmoDesc(code) {
  const m = {
    0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
    45:'Fog', 48:'Icy fog', 51:'Light drizzle', 53:'Drizzle', 55:'Heavy drizzle',
    61:'Light rain', 63:'Rain', 65:'Heavy rain', 71:'Light snow', 73:'Snow', 75:'Heavy snow',
    80:'Rain showers', 81:'Rain showers', 82:'Heavy showers',
    95:'Thunderstorm', 96:'Thunderstorm w/ hail', 99:'Thunderstorm w/ hail',
  };
  return m[code] || null;
}

const weatherCache = { data: null, ts: 0 };
const WEATHER_TTL  = 10 * 60 * 1000;

app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.ts < WEATHER_TTL) return res.json(weatherCache.data);

  // Fetch BOM + Open-Meteo in parallel
  const [bomResults, omData] = await Promise.all([
    // BOM observations
    Promise.all(BOM_STATIONS.map(async s => {
      try {
        const r   = await fetch(s.url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'http://www.bom.gov.au/' },
          signal: AbortSignal.timeout(8000),
        });
        const d   = await r.json();
        // BOM returns newest reading first in data array
        const obs = d?.observations?.data?.[0];
        return {
          city:     s.city,
          temp:     obs?.air_temp             ?? null,
          feels:    obs?.apparent_t           ?? null,
          humidity: obs?.rel_hum              ?? null,
          wind:     obs?.wind_spd_kmh         ?? null,
          // BOM description field is 'weather' — may be null if station doesn't report it
          desc:     obs?.weather              ?? null,
          // Correct BOM field names for daily min/max
          max:      obs?.maximum_air_temp     ?? null,
          min:      obs?.minimum_air_temp     ?? null,
        };
      } catch (e) {
        console.warn(`  BOM fail [${s.city}]: ${e.message}`);
        return { city: s.city, temp: null, feels: null, humidity: null, wind: null, desc: null, max: null, min: null };
      }
    })),
    // Open-Meteo fallback — gets today's min/max forecast + weather code for description
    (async () => {
      try {
        const lats = BOM_STATIONS.map(s => s.lat).join(',');
        const lons = BOM_STATIONS.map(s => s.lon).join(',');
        const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=temperature_2m_max,temperature_2m_min,weathercode&current_weather=true&timezone=auto&forecast_days=1`;
        const r    = await fetch(url, { signal: AbortSignal.timeout(8000) });
        return await r.json();
      } catch { return null; }
    })(),
  ]);

  // Merge BOM data with Open-Meteo fallbacks
  const omArr = Array.isArray(omData) ? omData : (omData ? [omData] : []);
  const results = bomResults.map((b, i) => {
    const om = omArr[i];
    return {
      city:     b.city,
      temp:     b.temp,
      feels:    b.feels,
      humidity: b.humidity,
      wind:     b.wind,
      // Use BOM description if available, else derive from Open-Meteo weather code
      desc:     b.desc || wmoDesc(om?.current_weather?.weathercode) || null,
      // Use BOM min/max if available, else Open-Meteo daily forecast
      max:      b.max  ?? (om?.daily?.temperature_2m_max?.[0] ?? null),
      min:      b.min  ?? (om?.daily?.temperature_2m_min?.[0] ?? null),
    };
  });

  weatherCache.data = results;
  weatherCache.ts   = now;
  res.json(results);
});

// ---------------------------------------------------------------------------
// Stock market data — Yahoo Finance v8 with Stooq CSV fallback
// ---------------------------------------------------------------------------
const STOCK_SYMBOLS = {
  '^AXJO': { label: 'ASX 200',      stooq: '%5EAXJO' },
  '^NZ50': { label: 'NZX 50',       stooq: '%5ENZ50' },
  '^DJI':  { label: 'Dow Jones',    stooq: '%5EDJI'  },
  '^FTSE': { label: 'FTSE 100',     stooq: '%5EFTSE' },
  '^HSI':  { label: 'Hang Seng',    stooq: '%5EHSI'  },
  '^STOXX50E': { label: 'Euro Stoxx 50', stooq: '%5ESTOXX50E' },
  '000001.SS': { label: 'Shanghai',     stooq: '000001.ss' },
  '^N225':    { label: 'Nikkei 225',    stooq: '%5EN225' },
};

// Commodity tickers for the second ticker bar
const COMMODITY_SYMBOLS = {
  'GC=F':  { label: 'Gold',          unit: 'USD/oz'  },
  'SI=F':  { label: 'Silver',        unit: 'USD/oz'  },
  'CL=F':  { label: 'Crude Oil',     unit: 'USD/bbl' },
  'NG=F':  { label: 'Natural Gas',   unit: 'USD/MMBtu'},
  'HG=F':  { label: 'Copper',        unit: 'USD/lb'  },
  'PL=F':  { label: 'Platinum',      unit: 'USD/oz'  },
  'PA=F':  { label: 'Palladium',     unit: 'USD/oz'  },
  'ZW=F':  { label: 'Wheat',         unit: 'USc/bu'  },
  'ZC=F':  { label: 'Corn',          unit: 'USc/bu'  },
  'BTC-USD': { label: 'Bitcoin',     unit: 'USD'     },
};

const stockCache = { data: null, ts: 0 };
const STOCK_TTL  = 5 * 60 * 1000;

async function fetchYahoo(symbols) {
  const url = `https://query2.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=5m`;
  const r   = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
      'Origin':  'https://finance.yahoo.com',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const data = await r.json();

  // v8 spark returns: { spark: { result: [ { symbol, response: [{ meta }] } ] } }
  const results = data?.spark?.result || [];
  return results.map(item => {
    const meta   = item?.response?.[0]?.meta || {};
    const prices = item?.response?.[0]?.indicators?.quote?.[0]?.close || [];
    const prev   = meta.chartPreviousClose || meta.previousClose || null;
    const curr   = meta.regularMarketPrice || (prices.length ? prices[prices.length - 1] : null);
    const change = (curr && prev) ? curr - prev : null;
    const changePct = (change && prev) ? (change / prev) * 100 : null;
    return {
      symbol: item.symbol,
      regularMarketPrice: curr,
      regularMarketChange: change,
      regularMarketChangePercent: changePct,
    };
  }).filter(q => q.regularMarketPrice);
}

async function fetchStooqFallback(symbols) {
  // Stooq returns CSV: Date,Open,High,Low,Close,Volume — fetch one by one
  const results = await Promise.all(symbols.map(async sym => {
    try {
      const stooqSym = STOCK_SYMBOLS[sym]?.stooq || encodeURIComponent(sym);
      const r = await fetch(`https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcv&h&e=csv`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2) return null;
      const cols  = lines[1].split(',');
      const close = parseFloat(cols[4]);
      const open  = parseFloat(cols[2]);
      if (isNaN(close)) return null;
      const change    = close - open;
      const changePct = (change / open) * 100;
      return { symbol: sym, regularMarketPrice: close, regularMarketChange: change, regularMarketChangePercent: changePct };
    } catch { return null; }
  }));
  return results.filter(Boolean);
}

app.get('/api/stocks', async (req, res) => {
  const now = Date.now();
  if (stockCache.data && now - stockCache.ts < STOCK_TTL) return res.json(stockCache.data);

  const symbols = Object.keys(STOCK_SYMBOLS);
  let quotes = [];

  // Try Yahoo first
  try {
    quotes = await fetchYahoo(symbols);
    console.log(`  Stocks: Yahoo returned ${quotes.length} quotes`);
  } catch (err) {
    console.warn(`  Yahoo fail: ${err.message} — trying Stooq fallback`);
  }

  // If Yahoo returned fewer than expected, fill missing from Stooq
  if (quotes.length < symbols.length) {
    const have    = new Set(quotes.map(q => q.symbol));
    const missing = symbols.filter(s => !have.has(s));
    try {
      const fallback = await fetchStooqFallback(missing);
      quotes = [...quotes, ...fallback];
      console.log(`  Stocks: Stooq filled ${fallback.length} missing quotes`);
    } catch (err) {
      console.warn(`  Stooq fail: ${err.message}`);
    }
  }

  if (quotes.length === 0) {
    return res.status(502).json({ error: 'All stock sources failed' });
  }

  stockCache.data = quotes;
  stockCache.ts   = now;
  res.json(quotes);
});

// ---------------------------------------------------------------------------
// News routes
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Commodities proxy
// ---------------------------------------------------------------------------
const commodityCache = { data: null, ts: 0 };
const COMMODITY_TTL  = 5 * 60 * 1000;

app.get('/api/commodities', async (req, res) => {
  const now = Date.now();
  if (commodityCache.data && now - commodityCache.ts < COMMODITY_TTL) return res.json(commodityCache.data);
  const symbols = Object.keys(COMMODITY_SYMBOLS);
  let quotes = [];
  try {
    quotes = await fetchYahoo(symbols);
    console.log(`  Commodities: Yahoo returned ${quotes.length} quotes`);
  } catch (err) {
    console.warn(`  Commodities Yahoo fail: ${err.message}`);
  }
  if (quotes.length === 0) return res.status(502).json({ error: 'Commodities fetch failed' });
  commodityCache.data = quotes;
  commodityCache.ts   = now;
  res.json(quotes);
});

// ---------------------------------------------------------------------------
// News routes
// ---------------------------------------------------------------------------
app.get('/api/categories',      (_, res) => res.json(ALL_CATEGORIES));
app.get('/api/news/:category',  async (req, res) => {
  const { category } = req.params;
  if (!ALL_CATEGORIES.includes(category)) return res.status(404).json({ error: `Unknown: ${category}` });
  const articles = await getArticles(category);
  res.json({ category, articles, count: articles.length, cachedAt: cache[category]?.ts });
});
app.get('/api/news',            async (_, res) => {
  const results = await Promise.all(ALL_CATEGORIES.map(async c => [c, await getArticles(c)]));
  res.json(Object.fromEntries(results));
});
app.post('/api/cache/clear',    (_, res) => { Object.keys(cache).forEach(k => delete cache[k]); res.json({ ok: true }); });
app.get('/api/debug/:category', async (req, res) => {
  const { category } = req.params;
  delete cache[category];
  const articles = await getArticles(category);
  res.json({ category, count: articles.length, articles });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n📰  News Dashboard  →  http://localhost:${PORT}`);
  console.log(`    Scraped : ${Object.keys(SCRAPERS).join(', ')}`);
  console.log(`    RSS     : ${Object.keys(RSS_FEEDS).join(', ')}`);
  console.log(`    Weather : /api/weather`);
  console.log(`    Stocks  : /api/stocks\n`);
});
