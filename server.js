const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const Parser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Shared fetch helper — rotates user-agents, sets browser-like headers
// ---------------------------------------------------------------------------
const UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
];
let uaIndex = 0;

async function get(url, opts = {}) {
  const ua = UA[uaIndex++ % UA.length];
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
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
  const res = await get(url, opts);
  return res.text();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clean(str) {
  return (str || '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

function dedup(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (!a.title || a.title.length < 12) return false;
    const key = a.title.slice(0, 80).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeArticle(title, link, source, summary = '', published = null) {
  if (!title || !link || link === '#') return null;
  return { title: clean(title), link, summary: clean(summary), published, source };
}

// ---------------------------------------------------------------------------
// ABC News Australia
// Multiple strategies in priority order.
// ---------------------------------------------------------------------------
async function scrapeABC() {
  const articles = [];

  // Strategy 1: ABC's internal content API (JSON, very structured)
  try {
    const data = await getJSON(
      'https://www.abc.net.au/news-web/api/loader/channelrefetch?name=PaginationArticleList&documentId=13437&offset=0&size=20&total=20',
      { headers: { Referer: 'https://www.abc.net.au/news' } }
    );
    const items = data?.items || data?.data?.items || [];
    items.forEach(item => {
      const a = makeArticle(
        item.title || item.headline,
        item.link ? `https://www.abc.net.au${item.link}` : item.url,
        'ABC News AU',
        item.synopsis || item.description,
        item.updated || item.published
      );
      if (a) articles.push(a);
    });
  } catch (_) {}

  // Strategy 2: scrape Just In listing page (chronological, no JS needed)
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.abc.net.au/news/justin');
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (title.length > 20 && /\/news\/\d{4}-\d{2}-\d{2}\//.test(href)) {
          const a = makeArticle(title, `https://www.abc.net.au${href}`, 'ABC News AU');
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  // Strategy 3: scrape main news page
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.abc.net.au/news');
      const $ = cheerio.load(html);
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
// CNN removed their public RSS. We use their content API + HTML fallback.
// ---------------------------------------------------------------------------
async function scrapeCNN() {
  const articles = [];

  // Strategy 1: CNN's Arc Publishing content API
  try {
    const data = await getJSON(
      'https://www.cnn.com/data/ocs/section/index.html:homepage1-zone-1/views/zones/common/zone/t1/index.json',
      { headers: { Referer: 'https://www.cnn.com/' } }
    );
    const zones = data?.zoneContents || data?.contentElements || [];
    zones.forEach(item => {
      const headline = item?.headline?.basic || item?.headlines?.basic || item?.label?.text || item?.title;
      const url = item?.canonical_url || item?.url;
      if (headline && url) {
        const a = makeArticle(
          headline,
          url.startsWith('http') ? url : `https://www.cnn.com${url}`,
          'CNN',
          item?.description?.basic || '',
          item?.first_publish_date || null
        );
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // Strategy 2: CNN search API for latest news
  if (articles.length < 5) {
    try {
      const data = await getJSON(
        'https://search.api.cnn.io/content?q=news&size=20&from=0&page=1&sort=newest&category=us,world,politics,business',
        { headers: { Referer: 'https://www.cnn.com/' } }
      );
      const hits = data?.result || [];
      hits.forEach(item => {
        const a = makeArticle(
          item.headline,
          item.url,
          'CNN',
          item.body?.slice(0, 200) || '',
          item.firstPublishDate
        );
        if (a) articles.push(a);
      });
    } catch (_) {}
  }

  // Strategy 3: scrape the front page
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.cnn.com');
      const $ = cheerio.load(html);
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
// AJ is React/Next.js — we try their WP JSON API, then scrape /news/
// ---------------------------------------------------------------------------
async function scrapeAlJazeera() {
  const articles = [];

  // Strategy 1: WordPress REST API (AJ runs WP under the hood)
  try {
    const data = await getJSON(
      'https://www.aljazeera.com/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc&_fields=title,link,excerpt,date',
      { headers: { Referer: 'https://www.aljazeera.com/' } }
    );
    if (Array.isArray(data)) {
      data.forEach(post => {
        const title   = post.title?.rendered;
        const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '');
        const a = makeArticle(title, post.link, 'Al Jazeera', excerpt, post.date);
        if (a) articles.push(a);
      });
    }
  } catch (_) {}

  // Strategy 2: scrape /news/ listing
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.aljazeera.com/news/');
      const $ = cheerio.load(html);
      $('article, .article-card, [class*="article-card"], [class*="ArticleCard"]').each((_, el) => {
        const link  = $(el).find('a[href]').first().attr('href') || '';
        const title = $(el).find('h2, h3, h4, [class*="title"]').first().text().trim()
                   || $(el).find('a').first().text().trim();
        const summary = $(el).find('p').first().text().trim();
        if (title.length > 15 && link) {
          const full = link.startsWith('http') ? link : `https://www.aljazeera.com${link}`;
          const a = makeArticle(title, full, 'Al Jazeera', summary);
          if (a) articles.push(a);
        }
      });
    } catch (_) {}
  }

  // Strategy 3: generic anchor scrape
  if (articles.length < 5) {
    try {
      const html = await getHTML('https://www.aljazeera.com');
      const $ = cheerio.load(html);
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
// NZ Herald + Stuff.co.nz
// NZ Herald is heavily paywalled; we pull their free teasers then supplement
// with Stuff.co.nz (NZ's largest fully free news site).
// ---------------------------------------------------------------------------
async function scrapeNZHerald() {
  const articles = [];

  // NZ Herald — scrape their latest news feed page
  try {
    const html = await getHTML('https://www.nzherald.co.nz/latest-news/');
    const $ = cheerio.load(html);
    // NZ Herald article links share the pattern /nz/, /world/, /business/ etc.
    $('h2 a, h3 a, .story-card a, [class*="story"] a, [class*="article"] a').each((_, el) => {
      const href  = $(el).attr('href') || '';
      const title = $(el).text().trim()
                 || $(el).closest('[class*="card"]').find('h2,h3').text().trim();
      if (title.length > 15 && href.includes('nzherald') && !href.includes('/account')) {
        const a = makeArticle(title, href.startsWith('http') ? href : `https://www.nzherald.co.nz${href}`, 'NZ Herald');
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // Stuff.co.nz — always free, NZ's biggest site
  try {
    const html = await getHTML('https://www.stuff.co.nz');
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href  = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (title.length > 20 && /stuff\.co\.nz\/[a-z\-]+\/\d+/.test(href)) {
        const a = makeArticle(title, href.startsWith('http') ? href : `https://www.stuff.co.nz${href}`, 'Stuff NZ');
        if (a) articles.push(a);
      }
    });
  } catch (_) {}

  // RNZ (Radio New Zealand) — fully public, excellent RSS
  try {
    const rss = new Parser({ timeout: 10000, headers: { 'User-Agent': UA[0] } });
    const feed = await rss.parseURL('https://www.rnz.co.nz/rss/news.xml');
    feed.items.slice(0, 8).forEach(item => {
      const a = makeArticle(item.title, item.link, 'RNZ', item.contentSnippet, item.pubDate);
      if (a) articles.push(a);
    });
  } catch (_) {}

  return dedup(articles).slice(0, 15);
}

// ---------------------------------------------------------------------------
// RSS-based categories (still reliable for these outlets)
// ---------------------------------------------------------------------------
const rssParser = new Parser({ timeout: 10000, headers: { 'User-Agent': UA[0] } });

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
    { name: 'Reuters Biz',   url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'Bloomberg',     url: 'https://feeds.bloomberg.com/markets/news.rss' },
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
    })).filter(a => a.title.length > 10);
  } catch (err) {
    console.warn(`  RSS fail [${feed.name}]: ${err.message}`);
    return [];
  }
}

async function fetchRSSCategory(category) {
  const results = await Promise.all((RSS_FEEDS[category] || []).map(fetchRSSFeed));
  return results.flat().sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}

// ---------------------------------------------------------------------------
// Dispatch + cache
// ---------------------------------------------------------------------------
const SCRAPERS = {
  abc:       scrapeABC,
  cnn:       scrapeCNN,
  aljazeera: scrapeAlJazeera,
  nzherald:  scrapeNZHerald,
};

const ALL_CATEGORIES = [...Object.keys(SCRAPERS), ...Object.keys(RSS_FEEDS)];

const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getArticles(category) {
  const now = Date.now();
  if (cache[category] && now - cache[category].ts < CACHE_TTL) {
    return cache[category].data;
  }
  console.log(`  → fetching [${category}]`);
  let articles = [];
  try {
    articles = SCRAPERS[category]
      ? await SCRAPERS[category]()
      : await fetchRSSCategory(category);
  } catch (err) {
    console.error(`  ✗ [${category}]: ${err.message}`);
  }
  cache[category] = { ts: now, data: articles };
  return articles;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/categories', (_, res) => res.json(ALL_CATEGORIES));

app.get('/api/news/:category', async (req, res) => {
  const { category } = req.params;
  if (!ALL_CATEGORIES.includes(category))
    return res.status(404).json({ error: `Unknown category: ${category}` });
  const articles = await getArticles(category);
  res.json({ category, articles, count: articles.length, cachedAt: cache[category]?.ts });
});

app.get('/api/news', async (_, res) => {
  const results = await Promise.all(ALL_CATEGORIES.map(async cat => [cat, await getArticles(cat)]));
  res.json(Object.fromEntries(results));
});

app.post('/api/cache/clear', (_, res) => {
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ ok: true, message: 'Cache cleared' });
});

// Debug: force-refetch one category and return raw results
app.get('/api/debug/:category', async (req, res) => {
  const { category } = req.params;
  delete cache[category];
  const articles = await getArticles(category);
  res.json({ category, count: articles.length, articles });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n📰  News Dashboard Backend  →  http://localhost:${PORT}`);
  console.log(`    Scraped : ${Object.keys(SCRAPERS).join(', ')}`);
  console.log(`    RSS     : ${Object.keys(RSS_FEEDS).join(', ')}\n`);
  console.log('    Tip: GET /api/debug/:category to force-refresh & inspect any feed\n');
});
