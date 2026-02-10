const fetch = require('node-fetch');

// Using CoinGecko API (free, no key needed for basic requests)
const BASE_URL = 'https://api.coingecko.com/api/v3';

// Main coins to track
const TRACKED_COINS = ['bitcoin', 'ethereum', 'binancecoin', 'bitcoin-cash'];

async function getPrices(symbols = TRACKED_COINS) {
  try {
    const ids = symbols.join(',');
    const res = await fetch(`${BASE_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
    if (res.ok) {
      const data = await res.json();
      return data;
    }
    return {};
  } catch (err) {
    console.error('CoinGecko API error:', err.message);
    return {};
  }
}

async function getMarketOverview() {
  try {
    const res = await fetch(`${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`);
    if (res.ok) {
      const data = await res.json();
      return data.map(coin => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        priceUsd: coin.current_price,
        changePercent24Hr: coin.price_change_percentage_24h,
        marketCapUsd: coin.market_cap,
        volumeUsd24Hr: coin.total_volume,
        image: coin.image
      }));
    }
    return [];
  } catch (err) {
    console.error('CoinGecko API error:', err.message);
    return [];
  }
}

module.exports = { getPrices, getMarketOverview };
