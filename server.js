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
// CNN
// ---------------------------------------------------------------------------
async function scrapeCNN() {
  const articles = [];

  // Strategy 1: CNN Arc Publishing API
  try {
    const data  = await getJSON(
      'https://www.cnn.com/data/ocs/section/index.html:homepage1-zone-1/views/zones/common/zone/t1/index.json',
      { headers: { Referer: 'https://www.cnn.com/' } }
    );
    const items = data?.zoneContents || data?.contentElements || [];
    items.forEach(item => {
      const headline = item?.headline?.basic || item?.headlines?.basic || item?.label?.text || item?.title;
      const url      = item?.canonical_url   || item?.url;
      const image    =
        item?.promo_items?.basic?.url                  ||
        item?.promo_items?.lead_art?.url               ||
        item?.promo_items?.basic?.resized_urls?.medium ||
        null;
      if (headline && url) {
        const a = makeArticle(
          headline,
          url.startsWith('http') ? url : `https://www.cnn.com${url}`,
          'CNN',
          item?.description?.basic || '',
          item?.first_publish_date || null,
          image
        );
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // Strategy 2: CNN search API
  if (articles.length < 5) {
    try {
      const data = await getJSON(
        'https://search.api.cnn.io/content?q=news&size=20&from=0&sort=newest',
        { headers: { Referer: 'https://www.cnn.com/' } }
      );
      (data?.result || []).forEach(item => {
        const a = makeArticle(
          item.headline, item.url, 'CNN',
          '', item.firstPublishDate,
          item.thumbnail || item.image || null
        );
        if (a) articles.push(a);
      });
    } catch (_) {}
  }

  // Strategy 3: scrape front page
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.cnn.com');
      const $    = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 25 && /^\/\d{4}\/\d{2}\/\d{2}\//.test(href)) {
          const a = makeArticle(title, `https://www.cnn.com${href}`, 'CNN');
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

  // Strategy 1: WordPress REST API — includes featured image
  try {
    const data = await getJSON(
      'https://www.aljazeera.com/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&_fields=title,link,excerpt,date,jetpack_featured_media_url,_links',
      { headers: { Referer: 'https://www.aljazeera.com/' } }
    );
    if (Array.isArray(data)) {
      data.forEach(post => {
        const title   = post.title?.rendered;
        const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '');
        const image   = post.jetpack_featured_media_url || null;
        const a = makeArticle(title, post.link, 'Al Jazeera', excerpt, post.date, image);
        if (a) articles.push(a);
      });
    }
  } catch (_) {}

  // Strategy 2: scrape /news/ listing
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.aljazeera.com/news/');
      const $    = cheerio.load(html);
      $('article, [class*="article-card"], [class*="ArticleCard"]').each((_, el) => {
        const link  = $(el).find('a[href]').first().attr('href') || '';
        const title = $(el).find('h2,h3,h4,[class*="title"]').first().text().trim()
                   || $(el).find('a').first().text().trim();
        const img   = $(el).find('img').first().attr('src')
                   || $(el).find('img').first().attr('data-src')
                   || null;
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
        if (title.length > 20 && /\/(news|features|opinions)\/\d{4}\//.test(href)) {
          const full = href.startsWith('http') ? href : `https://www.aljazeera.com${href}`;
          const a = makeArticle(title, full, 'Al Jazeera');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// NZ Herald + Stuff + RNZ
// ---------------------------------------------------------------------------
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
      const img   = $(el).find('img').first().attr('src')
                 || $(el).find('img').first().attr('data-src')
                 || null;
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
      const img   = $(el).find('img').first().attr('src')
                 || $(el).find('img').first().attr('data-src')
                 || null;
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
const SCRAPERS = { abc: scrapeABC, cnn: scrapeCNN, aljazeera: scrapeAlJazeera, nzherald: scrapeNZHerald };
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
const BOM_STATIONS = [
  { city: 'Sydney',    url: 'http://www.bom.gov.au/fwo/IDN60901/IDN60901.94768.json' },
  { city: 'Melbourne', url: 'http://www.bom.gov.au/fwo/IDV60901/IDV60901.95936.json' },
  { city: 'Brisbane',  url: 'http://www.bom.gov.au/fwo/IDQ60901/IDQ60901.94576.json' },
  { city: 'Perth',     url: 'http://www.bom.gov.au/fwo/IDW60901/IDW60901.94608.json' },
  { city: 'Adelaide',  url: 'http://www.bom.gov.au/fwo/IDS60901/IDS60901.94675.json' },
  { city: 'Darwin',    url: 'http://www.bom.gov.au/fwo/IDD60901/IDD60901.94120.json' },
  { city: 'Hobart',    url: 'http://www.bom.gov.au/fwo/IDT60901/IDT60901.94970.json' },
  { city: 'Alice Sp.', url: 'http://www.bom.gov.au/fwo/IDD60901/IDD60901.94240.json' },
];

const weatherCache = { data: null, ts: 0 };
const WEATHER_TTL  = 10 * 60 * 1000;

app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.ts < WEATHER_TTL) return res.json(weatherCache.data);
  const results = await Promise.all(BOM_STATIONS.map(async s => {
    try {
      const r   = await fetch(s.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'http://www.bom.gov.au/' },
        signal: AbortSignal.timeout(8000),
      });
      const d   = await r.json();
      const obs = d?.observations?.data?.[0];
      return {
        city:     s.city,
        temp:     obs?.air_temp      ?? null,
        feels:    obs?.apparent_t    ?? null,
        humidity: obs?.rel_hum       ?? null,
        wind:     obs?.wind_spd_kmh  ?? null,
        desc:     obs?.weather       ?? null,
        max:      obs?.max_air_temp  ?? null,
        min:      obs?.min_air_temp  ?? null,
      };
    } catch (e) {
      console.warn(`  BOM fail [${s.city}]: ${e.message}`);
      return { city: s.city, temp: null, feels: null, humidity: null, wind: null, desc: null, max: null, min: null };
    }
  }));
  weatherCache.data = results;
  weatherCache.ts   = now;
  res.json(results);
});

// ---------------------------------------------------------------------------
// Yahoo Finance stocks proxy
// ---------------------------------------------------------------------------
const stockCache = { data: null, ts: 0 };
const STOCK_TTL  = 5 * 60 * 1000;

app.get('/api/stocks', async (req, res) => {
  const now = Date.now();
  if (stockCache.data && now - stockCache.ts < STOCK_TTL) return res.json(stockCache.data);
  const symbols = ['^DJI', '^AXJO', '^NZ50', '^HSI', '^FTSE', '^IXIC'];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName`;
  try {
    const r    = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
      signal: AbortSignal.timeout(8000),
    });
    const data   = await r.json();
    const quotes = data?.quoteResponse?.result || [];
    stockCache.data = quotes;
    stockCache.ts   = now;
    res.json(quotes);
  } catch (err) {
    console.error(`  Stocks fail: ${err.message}`);
    res.status(502).json({ error: 'Failed to fetch stocks' });
  }
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
