const fetch = require('node-fetch');

// Cache for market data
let cryptoCache = { data: [], lastFetch: 0 };
let tradfiCache = { data: [], lastFetch: 0 };
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

// CoinGecko IDs for portfolio coins + major assets
// We fetch these specifically instead of just top-20 by market cap
const PORTFOLIO_COINS = [
  'bitcoin', 'ethereum', 'binancecoin', 'bitcoin-cash',
  'sonic-3', 'litecoin', 'dogecoin', 'nexacoin'
];

// Additional top coins for the ticker (not stablecoins)
const TICKER_COINS = [
  'solana', 'ripple', 'cardano', 'avalanche-2',
  'polkadot', 'chainlink', 'near'
];

// CoinGecko for crypto — fetch portfolio coins + top assets, skip stablecoins
async function getCryptoMarket() {
  const now = Date.now();
  if (cryptoCache.data.length > 0 && (now - cryptoCache.lastFetch) < CACHE_TTL) {
    return cryptoCache.data;
  }

  try {
    const allIds = [...PORTFOLIO_COINS, ...TICKER_COINS].join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${allIds}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`,
      { timeout: 10000 }
    );
    if (res.ok) {
      const data = await res.json();
      cryptoCache.data = data.map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change24h: coin.price_change_percentage_24h,
        marketCap: coin.market_cap,
        volume: coin.total_volume,
        image: coin.image
      }));
      cryptoCache.lastFetch = now;
    }
  } catch (err) {
    console.error('CoinGecko error:', err.message);
  }
  return cryptoCache.data;
}

// Finnhub for TradFi
async function getTradFiMarket() {
  const now = Date.now();
  if (tradfiCache.data.length > 0 && (now - tradfiCache.lastFetch) < CACHE_TTL) {
    return tradfiCache.data;
  }

  if (!FINNHUB_KEY) {
    return [];
  }

  const symbols = [
    { symbol: 'SPY', name: 'S&P 500 ETF' },
    { symbol: 'QQQ', name: 'NASDAQ ETF' },
    { symbol: 'DIA', name: 'Dow Jones ETF' },
    { symbol: 'IWM', name: 'Russell 2000' },
    { symbol: 'GLD', name: 'Gold ETF' },
    { symbol: 'SLV', name: 'Silver ETF' },
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'META', name: 'Meta' },
    { symbol: 'MSTR', name: 'MicroStrategy' }
  ];

  try {
    const promises = symbols.map(async ({ symbol, name }) => {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`, {
          timeout: 5000
        });
        if (res.ok) {
          const data = await res.json();
          if (data.c && data.c > 0) {
            return {
              symbol, name,
              price: data.c,
              change24h: data.dp,
              changeAbs: data.d,
              high: data.h,
              low: data.l,
              open: data.o,
              prevClose: data.pc
            };
          }
        }
      } catch (e) {
        console.error(`Finnhub error for ${symbol}:`, e.message);
      }
      return null;
    });

    const resolved = await Promise.all(promises);
    tradfiCache.data = resolved.filter(r => r !== null);
    tradfiCache.lastFetch = now;
  } catch (err) {
    console.error('Finnhub fetch error:', err.message);
  }

  return tradfiCache.data;
}

// Get top prices for ticker
async function getTickerPrices() {
  const crypto = await getCryptoMarket();
  const tradfi = await getTradFiMarket();
  return { crypto: crypto.slice(0, 8), tradfi: tradfi.slice(0, 4) };
}

module.exports = { getCryptoMarket, getTradFiMarket, getTickerPrices };
