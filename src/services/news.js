const fetch = require('node-fetch');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

// Cache with 2-hour TTL to avoid rate limiting
const NEWS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
let newsCache = {
  cfd: { data: [], lastFetch: 0 },
  crypto: { data: [], lastFetch: 0 },
  ordinals: { data: [], lastFetch: 0 }
};

async function fetchPubMedCFD() {
  const now = Date.now();
  if (newsCache.cfd.data.length > 0 && (now - newsCache.cfd.lastFetch) < NEWS_CACHE_TTL) {
    return newsCache.cfd.data;
  }

  try {
    const searchUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=cerebral+folate+deficiency&retmax=10&sort=date&retmode=json';
    const searchRes = await fetch(searchUrl, { timeout: 10000 });
    const searchData = await searchRes.json();

    const ids = searchData.esearchresult?.idlist || [];
    if (ids.length === 0) return newsCache.cfd.data;

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl, { timeout: 10000 });
    const summaryData = await summaryRes.json();

    const articles = [];
    for (const id of ids) {
      const article = summaryData.result?.[id];
      if (article) {
        articles.push({
          title: article.title,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          source: 'PubMed',
          published: article.pubdate,
          authors: article.authors?.map(a => a.name).join(', ')
        });
      }
    }

    newsCache.cfd.data = articles;
    newsCache.cfd.lastFetch = now;
    return articles;
  } catch (err) {
    console.error('PubMed fetch error:', err.message);
    return newsCache.cfd.data; // Return stale cache on error
  }
}

async function fetchBraveNews(query, count = 5, cacheKey = null) {
  if (!BRAVE_API_KEY) return [];

  // Check cache if a cache key is provided
  if (cacheKey && newsCache[cacheKey]) {
    const now = Date.now();
    if (newsCache[cacheKey].data.length > 0 && (now - newsCache[cacheKey].lastFetch) < NEWS_CACHE_TTL) {
      return newsCache[cacheKey].data;
    }
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: { 'X-Subscription-Token': BRAVE_API_KEY },
        timeout: 10000
      }
    );
    if (res.ok) {
      const data = await res.json();
      const results = (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        source: r.meta_url?.hostname || 'Unknown',
        published: r.age,
        description: r.description
      }));

      // Update cache
      if (cacheKey && newsCache[cacheKey]) {
        newsCache[cacheKey].data = results;
        newsCache[cacheKey].lastFetch = Date.now();
      }

      return results;
    }

    // On rate limit or error, return stale cache
    if (cacheKey && newsCache[cacheKey]) {
      return newsCache[cacheKey].data;
    }
    return [];
  } catch (err) {
    console.error('Brave news error:', err.message);
    // Return stale cache on error
    if (cacheKey && newsCache[cacheKey]) {
      return newsCache[cacheKey].data;
    }
    return [];
  }
}

async function getAllNews() {
  // Fetch with cache keys so each category is independently cached
  const [cfd, crypto, ordinals] = await Promise.all([
    fetchPubMedCFD(),
    fetchBraveNews('cryptocurrency bitcoin market', 8, 'crypto'),
    fetchBraveNews('bitcoin ordinals inscriptions NFT', 5, 'ordinals')
  ]);

  return { cfd, crypto, ordinals };
}

module.exports = { getAllNews, fetchPubMedCFD, fetchBraveNews };
