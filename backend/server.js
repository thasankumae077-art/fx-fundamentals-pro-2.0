/**
 * FX Fundamentals Pro — Backend API Server (v12 Institutional Upgrade)
 * Zero-dependency Node.js (>=18) HTTP server implementing:
 *  - Priority 1: Indicator freshness & stale detection (45d monthly / 105d quarterly),
 *                unified Gold (XAU/USD) feed, base/quote-adjusted G8 currency strength,
 *                transparent 7-factor macro scoring breakdown, context-aware news NLP,
 *                and calibrated 5-tier trade signals with conflict/neutral guardrails.
 *  - Priority 2: Expanded fundamentals (yields, implied rate paths, real yields,
 *                Core/Headline CPI & PCE + 3M annualized trend, PMI/GDP/Retail/IP,
 *                NFP/Wages/Participation/3M Unemp trend, CB forward guidance & next meeting,
 *                3Y/52W CFTC COT percentiles, and Safe-Haven flows).
 *  - Priority 3: Multi-horizon (30D/60D/90D) rolling correlations with >0.35 breakdown alerts
 *                and full Cross-Asset Drivers (DXY/Yields, Gold/Silver/TIPS, WTI/Brent,
 *                VIX/SPX/NAS100/Risk Composite, BTC/Liquidity).
 *  - Priority 4: Swing-Trading Intelligence (Macro Regime Detection, Divergence Scanner
 *                with COT crowding filter, 30D Macro Momentum, Priced-In vs. Surprise Tracker,
 *                Trade Thesis Invalidation Alerts, Rolling 30D/60D Score Backtest Summary,
 *                and Multi-Timeframe Fundamental Outlook).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const STATIC = { '/': 'index.html', '/index.html': 'index.html' }; // Whitelisted static files only
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Canonical G8 currency order matching standard FX quoting conventions
const CUR = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const PAIRS_28 = [];
CUR.forEach((b, i) => CUR.slice(i + 1).forEach(q => PAIRS_28.push([b, q])));

const IST_OFF = 5.5 * 36e5;
const DAY_MS = 864e5;
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const MONI = {};
'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').forEach((m, i) => {
  MONI[m] = String(i + 1).padStart(2, '0');
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = {};
const flight = {};
const smemo = {};

// ============================================================================
// 1. CORE NETWORKING, CACHING & FRESHNESS HELPERS (PRIORITY 1.1)
// ============================================================================

async function getText(url, opt = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        ...opt,
        headers: { 'User-Agent': 'FXFundamentalsPro/2.0', ...(opt.headers || {}) },
        signal: AbortSignal.timeout(opt.timeout || 15000)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (x) {
      lastErr = x;
      if (i < tries - 1) await sleep(400 * 2 ** i);
    }
  }
  throw lastErr;
}

async function cached(key, ttl, fn, force = false) {
  const c = cache[key];
  if (c && Date.now() - c.t < (force ? 2000 : ttl)) {
    return { ...c.v, stale: false, fetchedAt: new Date(c.t).toISOString(), fetchedAtMs: c.t };
  }
  try {
    const v = await (flight[key] ??= fn().finally(() => { delete flight[key]; }));
    const now = Date.now();
    cache[key] = { t: now, v };
    return { ...v, stale: false, fetchedAt: new Date(now).toISOString(), fetchedAtMs: now };
  } catch (e) {
    if (c) {
      return {
        ...c.v,
        stale: true,
        fetchedAt: new Date(c.t).toISOString(),
        fetchedAtMs: c.t,
        error: e.message
      };
    }
    throw e;
  }
}

function memo(k, ttl, fn) {
  const c = smemo[k];
  if (c && Date.now() - c.t < ttl) return c.p;
  const p = Promise.resolve().then(fn);
  smemo[k] = { t: Date.now(), p };
  p.catch(() => { if (smemo[k]?.p === p) delete smemo[k]; });
  return p;
}

function csvRow(l) {
  const o = [];
  let c = '', q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { o.push(c); c = ''; }
    else c += ch;
  }
  o.push(c);
  return o;
}

const isoDate = d => {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^(\d{4})-Q(\d)$/i.test(s)) {
    const m = s.match(/^(\d{4})-Q(\d)$/i);
    return `${m[1]}-${String(Number(m[2]) * 3 - 2).padStart(2, '0')}-01`;
  }
  if (/^\d{4}-M(\d{2})$/i.test(s)) {
    const m = s.match(/^(\d{4})-M(\d{2})$/i);
    return `${m[1]}-${m[2]}-01`;
  }
  return s.slice(0, 10);
};

const ago = days => new Date(Date.now() - days * DAY_MS);

/**
 * Normalizes provider name into clean badge label (FRED, ECB, BoE, ONS, etc.)
 */
function cleanSourceBadge(rawSrc = '') {
  const s = String(rawSrc);
  if (/FRED/i.test(s)) return 'FRED';
  if (/BLS/i.test(s)) return 'BLS';
  if (/ECB/i.test(s)) return 'ECB';
  if (/Eurostat/i.test(s)) return 'Eurostat';
  if (/BoE|Bank of England/i.test(s)) return 'BoE';
  if (/ONS/i.test(s)) return 'ONS';
  if (/BoC|Bank of Canada/i.test(s)) return 'BoC';
  if (/StatCan/i.test(s)) return 'StatCan';
  if (/RBA/i.test(s)) return 'RBA';
  if (/BIS/i.test(s)) return 'BIS';
  if (/OECD/i.test(s)) return 'OECD';
  if (/TradingView/i.test(s)) return 'TradingView';
  if (/FXStreet/i.test(s)) return 'FXStreet';
  if (/TradingEconomics/i.test(s)) return 'TradingEconomics';
  if (/CFTC/i.test(s)) return 'CFTC';
  if (/Yahoo/i.test(s)) return 'Yahoo Finance';
  if (/GoldPrice/i.test(s)) return 'GoldPrice';
  if (/Stooq/i.test(s)) return 'Stooq';
  if (/IMF/i.test(s)) return 'IMF';
  if (/Derived/i.test(s)) return 'Derived';
  return s || 'Unknown';
}

/**
 * Priority 1.1 rigid stale-data threshold enforcement:
 * - monthly indicators > 45 days => stale: true
 * - quarterly indicators (GDP, AU/NZ CPI) > 105 days => stale: true
 * - weekly (COT) > 14 days => stale: true
 * - daily market feeds > 7 days => stale: true
 * - policy rate official daily feed > 45 days => stale: true
 */
function staleLimitDays(frequency) {
  if (frequency === 'quarterly') return 105;
  if (frequency === 'monthly') return 45;
  if (frequency === 'weekly') return 14;
  if (frequency === 'daily') return 7;
  if (frequency === 'policy') return 45;
  return 45;
}

function formatObservationPeriod(dateStr, frequency) {
  if (!dateStr) return null;
  const iso = isoDate(dateStr);
  if (!iso || iso.length < 7) return dateStr;
  const y = iso.slice(0, 4);
  const mo = Number(iso.slice(5, 7));
  if (frequency === 'quarterly' && mo >= 1 && mo <= 12) return `${y}-Q${Math.ceil(mo / 3)}`;
  if (frequency === 'monthly') return `${y}-${iso.slice(5, 7)}`;
  return iso;
}

function buildIndicator({
  value,
  prev = null,
  observationDate,
  publishedAt = null,
  source,
  series = null,
  frequency = 'monthly',
  unit = '%',
  label = null,
  extra = {}
}) {
  const fetchedAt = new Date().toISOString();
  if (value == null || isNaN(Number(value))) {
    return makeUnavailableIndicator(source || 'Upstream', 'N/A — Pending Release', frequency, unit);
  }
  const iso = isoDate(observationDate) || fetchedAt.slice(0, 10);
  const obsMs = new Date(iso).getTime();
  const ageDays = isNaN(obsMs) ? null : Math.max(0, Math.round((Date.now() - obsMs) / DAY_MS));
  const limit = staleLimitDays(frequency);
  const isStale = ageDays != null ? ageDays > limit : true;
  const obsFormatted = formatObservationPeriod(iso, frequency);
  const pubIso = publishedAt
    ? new Date(publishedAt).toISOString()
    : (!isNaN(obsMs) ? new Date(obsMs).toISOString() : fetchedAt);

  return {
    value: Number(Number(value).toFixed(4)),
    prev: prev != null && !isNaN(Number(prev)) ? Number(Number(prev).toFixed(4)) : null,
    unit,
    source: cleanSourceBadge(source),
    series: series || source || null,
    src: series || source || null, // Backward-compatible alias
    observationDate: obsFormatted,
    date: iso,                     // Backward-compatible alias
    label: label || obsFormatted,
    publishedAt: pubIso,
    fetchedAt,
    frequency,
    ageDays,
    staleThresholdDays: limit,
    stale: isStale,
    status: isStale ? 'STALE' : 'OK',
    unavailableReason: null,
    ...extra
  };
}

function makeUnavailableIndicator(source, reason = 'Unavailable (Source Timeout)', frequency = 'monthly', unit = '%') {
  const fetchedAt = new Date().toISOString();
  return {
    value: null,
    prev: null,
    unit,
    source: cleanSourceBadge(source),
    series: source || null,
    src: source || null,
    observationDate: null,
    date: null,
    label: reason,
    publishedAt: null,
    fetchedAt,
    frequency,
    ageDays: null,
    staleThresholdDays: staleLimitDays(frequency),
    stale: false,
    status: /Pending/i.test(reason) ? 'PENDING' : 'UNAVAILABLE',
    unavailableReason: reason
  };
}

function summarizeFreshness(namedIndicators = []) {
  const staleItems = [];
  const unavailableItems = [];
  let freshCount = 0;

  for (const [key, ind] of namedIndicators) {
    if (!ind || ind.value == null) {
      unavailableItems.push({
        key,
        source: ind?.source || 'Upstream',
        reason: ind?.unavailableReason || 'Unavailable (Source Timeout)'
      });
    } else if (ind.stale) {
      staleItems.push({
        key,
        source: ind.source,
        observationDate: ind.observationDate,
        ageDays: ind.ageDays,
        thresholdDays: ind.staleThresholdDays
      });
    } else {
      freshCount++;
    }
  }

  const totalIndicators = namedIndicators.length;
  const staleCount = staleItems.length;
  const unavailableCount = unavailableItems.length;
  const status = unavailableCount > totalIndicators * 0.35
    ? 'DEGRADED'
    : (staleCount > 0 || unavailableCount > 0) ? 'PARTIAL_STALE' : 'FRESH';

  return {
    status,
    totalIndicators,
    freshCount,
    staleCount,
    unavailableCount,
    staleItems: staleItems.slice(0, 25),
    unavailableItems: unavailableItems.slice(0, 25),
    checkedAt: new Date().toISOString()
  };
}

// ============================================================================
// 2. STATISTICAL & MATH HELPERS
// ============================================================================

const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = v => (v == null || isNaN(v) ? null : Number(Number(v).toFixed(2)));
const round4 = v => (v == null || isNaN(v) ? null : Number(Number(v).toFixed(4)));

function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
}

function corrArr(a, b, win = null) {
  const xFull = win ? a.slice(-win) : a;
  const yFull = win ? b.slice(-win) : b;
  const n = Math.min(xFull.length, yFull.length);
  if (n < 12) return null;
  const x = xFull.slice(-n), y = yFull.slice(-n);
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx, vy = y[i] - my;
    num += vx * vy; dx += vx * vx; dy += vy * vy;
  }
  const den = Math.sqrt(dx * dy);
  return den ? Number((num / den).toFixed(2)) : 0;
}

function zScoreMap(valByCur, invert = false) {
  const keys = CUR.filter(c => valByCur[c] != null && !isNaN(valByCur[c]));
  if (keys.length < 2) {
    const out = {};
    CUR.forEach(c => { out[c] = null; });
    return out;
  }
  const vals = keys.map(c => Number(valByCur[c]));
  const m = mean(vals);
  const s = sd(vals);
  const out = {};
  CUR.forEach(c => {
    if (valByCur[c] == null || isNaN(valByCur[c]) || !s) {
      out[c] = null;
    } else {
      const z = (Number(valByCur[c]) - m) / s;
      out[c] = clamp(invert ? -z : z, -2, 2);
    }
  });
  return out;
}

function percentileRank(val, historyArr) {
  const valid = historyArr.filter(x => x != null && !isNaN(x));
  if (!valid.length || val == null || isNaN(val)) return null;
  const below = valid.filter(x => x < val).length;
  const equal = valid.filter(x => x === val).length;
  return Math.round(((below + 0.5 * equal) / valid.length) * 100);
}

// ============================================================================
// 3. UNIFIED GOLD (XAU/USD) FEED (PRIORITY 1.2)
// ============================================================================

async function fetchYfChart(ticker, range = '6mo') {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
  const j = JSON.parse(await getText(u, { headers: { 'User-Agent': UA } }, 2));
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('Empty Yahoo chart for ' + ticker);
  const meta = res.meta || {};
  const ts = res.timestamp || [];
  const cl = res.indicators?.quote?.[0]?.close || [];
  const vol = res.indicators?.quote?.[0]?.volume || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] != null && !isNaN(cl[i])) {
      pts.push({
        d: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        ts: ts[i] * 1000,
        v: +cl[i],
        vol: vol[i] != null && !isNaN(vol[i]) ? +vol[i] : null
      });
    }
  }
  const livePrice = meta.regularMarketPrice != null && !isNaN(meta.regularMarketPrice)
    ? +meta.regularMarketPrice
    : pts.at(-1)?.v;
  const liveTime = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : (pts.at(-1)?.ts ? new Date(pts.at(-1).ts).toISOString() : new Date().toISOString());
  if (!pts.length && livePrice == null) throw new Error('No price points for ' + ticker);
  return { pts, livePrice, liveTime, currency: meta.currency || 'USD', symbol: ticker };
}

async function fetchGoldUnifiedRaw() {
  const fetchedAt = new Date().toISOString();
  const attempts = [
    {
      source: 'Yahoo Finance',
      series: 'XAU/USD Spot (Yahoo XAUUSD=X)',
      fn: async () => {
        const r = await fetchYfChart('XAUUSD=X', '6mo');
        const pts = r.pts;
        const price = r.livePrice ?? pts.at(-1).v;
        const prev1 = pts.at(-2)?.v ?? null;
        const prev5 = pts[Math.max(0, pts.length - 6)]?.v ?? null;
        const prev21 = pts[Math.max(0, pts.length - 22)]?.v ?? null;
        return {
          price,
          prevClose: prev1,
          d1: prev1 ? (price / prev1 - 1) : null,
          w1: prev5 ? (price / prev5 - 1) : null,
          m1: prev21 ? (price / prev21 - 1) : null,
          observationDate: pts.at(-1)?.d || fetchedAt.slice(0, 10),
          publishedAt: r.liveTime,
          pts
        };
      }
    },
    {
      source: 'Yahoo Finance',
      series: 'COMEX Gold Futures (Yahoo GC=F)',
      fn: async () => {
        const r = await fetchYfChart('GC=F', '6mo');
        const pts = r.pts;
        const price = r.livePrice ?? pts.at(-1).v;
        const prev1 = pts.at(-2)?.v ?? null;
        const prev5 = pts[Math.max(0, pts.length - 6)]?.v ?? null;
        const prev21 = pts[Math.max(0, pts.length - 22)]?.v ?? null;
        return {
          price,
          prevClose: prev1,
          d1: prev1 ? (price / prev1 - 1) : null,
          w1: prev5 ? (price / prev5 - 1) : null,
          m1: prev21 ? (price / prev21 - 1) : null,
          observationDate: pts.at(-1)?.d || fetchedAt.slice(0, 10),
          publishedAt: r.liveTime,
          pts
        };
      }
    },
    {
      source: 'GoldPrice',
      series: 'GoldPrice.org Spot XAU/USD',
      fn: async () => {
        const j = JSON.parse(await getText('https://data-asg.goldprice.org/dbXRates/USD', { headers: { 'User-Agent': UA } }, 2));
        const item = j?.items?.[0];
        if (!item?.xauPrice) throw new Error('GoldPrice.org missing xauPrice');
        const price = Number(item.xauPrice);
        const prev = item.xauClose ? Number(item.xauClose) : null;
        const pub = j.ts ? new Date(j.ts).toISOString() : fetchedAt;
        return {
          price,
          prevClose: prev,
          d1: prev ? (price / prev - 1) : null,
          w1: null,
          m1: null,
          observationDate: pub.slice(0, 10),
          publishedAt: pub,
          pts: []
        };
      }
    },
    {
      source: 'Stooq',
      series: 'Stooq Daily Spot XAU/USD',
      fn: async () => {
        const csv = await getText('https://stooq.com/q/d/l/?s=xauusd&i=d', { headers: { 'User-Agent': UA } }, 2);
        const rows = csv.trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(p => p[4] && !isNaN(+p[4]));
        if (!rows.length) throw new Error('Stooq XAUUSD empty');
        const pts = rows.slice(-130).map(r => ({ d: r[0], v: +r[4] }));
        const last = pts.at(-1), prev1 = pts.at(-2)?.v ?? null;
        const prev5 = pts[Math.max(0, pts.length - 6)]?.v ?? null;
        const prev21 = pts[Math.max(0, pts.length - 22)]?.v ?? null;
        return {
          price: last.v,
          prevClose: prev1,
          d1: prev1 ? (last.v / prev1 - 1) : null,
          w1: prev5 ? (last.v / prev5 - 1) : null,
          m1: prev21 ? (last.v / prev21 - 1) : null,
          observationDate: last.d,
          publishedAt: new Date(last.d).toISOString(),
          pts
        };
      }
    }
  ];

  const errs = [];
  for (const a of attempts) {
    try {
      const r = await a.fn();
      const ind = buildIndicator({
        value: r.price,
        prev: r.prevClose,
        observationDate: r.observationDate,
        publishedAt: r.publishedAt,
        source: a.source,
        series: a.series,
        frequency: 'daily',
        unit: 'USD/oz',
        extra: {
          symbol: 'XAU/USD',
          price: round2(r.price),
          prevClose: round2(r.prevClose),
          change: r.prevClose != null ? round2(r.price - r.prevClose) : null,
          d1: round4(r.d1),
          w1: round4(r.w1),
          m1: round4(r.m1),
          pts: r.pts // Retained internally for correlations, stripped in lightweight views if needed
        }
      });
      return ind;
    } catch (e) {
      errs.push(`${a.source}: ${e.message}`);
    }
  }

  return {
    ...makeUnavailableIndicator('Gold Feed', 'Unavailable (Source Timeout)', 'daily', 'USD/oz'),
    symbol: 'XAU/USD',
    price: null,
    d1: null,
    w1: null,
    m1: null,
    errors: errs
  };
}

/**
 * Single source of truth for Gold (XAU/USD) across /api/rates, /api/assets,
 * /api/dashboard, /api/fundamentals, and /api/intelligence.
 */
async function getUnifiedGold(force = false) {
  const g = await cached('gold_unified', 300000, fetchGoldUnifiedRaw, force);
  const { pts, ...publicGold } = g;
  return { publicGold, pts: pts || [] };
}

// ============================================================================
// 4. ECB FX HISTORY, BASE/QUOTE-ADJUSTED CURRENCY STRENGTH & MULTI-HORIZON CORRELATIONS
//    (PRIORITY 1.3 & PRIORITY 3.1)
// ============================================================================

async function fetchEcbRaw() {
  // Fetch 420 days (~290 trading days) so 90D correlations & rolling 30D/60D backtests have ample data
  const start = new Date(Date.now() - 420 * DAY_MS).toISOString().slice(0, 10);
  const csv = await getText(
    `https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY+CHF+CAD+AUD+NZD.EUR.SP00.A?format=csvdata&startPeriod=${start}`
  );
  const lines = csv.trim().split(/\r?\n/);
  const h = lines[0].split(',');
  const ci = h.indexOf('CURRENCY'), ti = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
  if (ci < 0 || ti < 0 || vi < 0) throw new Error('Unexpected ECB CSV format');

  const by = {}, dates = new Set();
  for (const l of lines.slice(1)) {
    const p = l.split(',');
    const v = parseFloat(p[vi]);
    if (!isNaN(v)) {
      (by[p[ci]] ??= {})[p[ti]] = v;
      dates.add(p[ti]);
    }
  }
  const ds = [...dates].sort();
  const rates = { EUR: ds.map(() => 1) };
  for (const c of Object.keys(by)) {
    let last = null;
    rates[c] = ds.map(d => (last = by[c][d] ?? last));
  }
  const first = ds.findIndex((_, i) => CUR.every(c => rates[c]?.[i] != null));
  const cleanDates = ds.slice(first);
  const cleanRates = {};
  CUR.forEach(c => { cleanRates[c] = rates[c].slice(first); });

  const analytics = computeCurrencyAnalytics(cleanDates, cleanRates);

  return {
    source: 'ECB',
    series: 'ECB Euro Foreign Exchange Reference Rates (daily, not live quotes)',
    observationDate: cleanDates.at(-1),
    publishedAt: new Date(cleanDates.at(-1) + 'T15:00:00Z').toISOString(),
    fetchedAt: new Date().toISOString(),
    dates: cleanDates,
    rates: cleanRates,
    ...analytics
  };
}

/**
 * Priority 1.3: Base/Quote-Adjusted Currency Strength across all 28 G8 crosses
 * Priority 3.1: Multi-horizon 30D / 60D / 90D rolling correlations + >0.35 breakdown alerts
 */
function computeCurrencyAnalytics(dates, rates) {
  const n = dates.length;
  const t = n - 1;
  const px = (b, q, i) => rates[q][i] / rates[b][i];

  /**
   * Computes exact base/quote-adjusted basket return (%) for every currency over k days.
   * For every canonical cross (b, q):
   *   - Base currency b earns: ((P_t / P_{t-k}) - 1) * 100
   *   - Quote currency q earns inverted pair return: ((1/P_t) / (1/P_{t-k}) - 1) * 100 = ((P_{t-k} / P_t) - 1) * 100
   */
  const computeStrengthAt = (idx, k) => {
    const accum = {};
    CUR.forEach(c => { accum[c] = 0; });
    const prevIdx = Math.max(0, idx - k);
    for (const [b, q] of PAIRS_28) {
      const pNow = px(b, q, idx);
      const pPrev = px(b, q, prevIdx);
      const baseRet = (pNow / pPrev - 1) * 100;
      const quoteRet = ((1 / pNow) / (1 / pPrev) - 1) * 100; // Properly inverted quote-side return
      accum[b] += baseRet;
      accum[q] += quoteRet;
    }
    const out = {};
    CUR.forEach(c => { out[c] = Number((accum[c] / 7).toFixed(3)); });
    return out;
  };

  const strength = {
    1: computeStrengthAt(t, 1),
    5: computeStrengthAt(t, 5),
    21: computeStrengthAt(t, 21),
    63: computeStrengthAt(t, 63)
  };

  // Daily base/quote-adjusted currency return series for rolling 30D / 60D / 90D correlations
  const dailyRetSeries = {};
  CUR.forEach(c => { dailyRetSeries[c] = []; });
  const startIdx = Math.max(1, n - 95);
  for (let i = startIdx; i < n; i++) {
    const s = computeStrengthAt(i, 1);
    CUR.forEach(c => dailyRetSeries[c].push(s[c]));
  }

  const buildCorrMatrix = win => CUR.map(a => CUR.map(b => (a === b ? 1 : corrArr(dailyRetSeries[a], dailyRetSeries[b], win))));
  const correlations = {
    '30D': buildCorrMatrix(30),
    '60D': buildCorrMatrix(60),
    '90D': buildCorrMatrix(90)
  };

  // Detect Correlation Breakdown Alerts where |30D - 90D| > 0.35
  const correlationBreakdownAlerts = [];
  for (let i = 0; i < CUR.length; i++) {
    for (let j = i + 1; j < CUR.length; j++) {
      const c30 = correlations['30D'][i][j];
      const c90 = correlations['90D'][i][j];
      if (c30 == null || c90 == null) continue;
      const div = Number((c30 - c90).toFixed(2));
      if (Math.abs(div) > 0.35) {
        correlationBreakdownAlerts.push({
          pairA: CUR[i],
          pairB: CUR[j],
          pair: `${CUR[i]}/${CUR[j]}`,
          corr30D: c30,
          corr90D: c90,
          divergence: div,
          absDivergence: Math.abs(div),
          direction: div > 0 ? 'Coupling / Converging' : 'Decoupling / Regime Shift',
          alertText: `${CUR[i]} vs ${CUR[j]} 30D corr (${c30 >= 0 ? '+' : ''}${c30}) diverged by ${div >= 0 ? '+' : ''}${div} from 90D baseline (${c90 >= 0 ? '+' : ''}${c90}).`
        });
      }
    }
  }
  correlationBreakdownAlerts.sort((a, b) => b.absDivergence - a.absDivergence);

  // Sample cross returns for 1M for auditability
  const crossReturns1M = {};
  for (const [b, q] of PAIRS_28) {
    const pNow = px(b, q, t), pPrev = px(b, q, Math.max(0, t - 21));
    crossReturns1M[`${b}/${q}`] = {
      spot: round4(pNow),
      baseRet1MPct: round2((pNow / pPrev - 1) * 100),
      quoteInvertedRet1MPct: round2(((1 / pNow) / (1 / pPrev) - 1) * 100)
    };
  }

  return {
    strength,
    strengthMethodology: {
      formula: 'Strength(C, k) = (1/7) × Σ_{X≠C} Return(C/X, k), where crosses with C as Quote currency (X/C) are explicitly inverted as [(1/P_t)/(1/P_{t-k}) - 1] × 100 across all 28 G8 crosses.',
      timeframes: { '1D': '1 trading day', '1W': '5 trading days', '1M': '21 trading days', '3M': '63 trading days' },
      currencies: CUR,
      crossCount: PAIRS_28.length,
      asOfDate: dates[t],
      source: 'ECB Reference Rates'
    },
    correlations,
    corr: correlations['60D'], // Backward compatibility
    correlationBreakdownAlerts,
    crossReturns1M
  };
}

// ============================================================================
// 5. CROSS-ASSET PRICES, MULTI-HORIZON CORRELATIONS & DRIVERS (PRIORITY 3)
// ============================================================================

const YF_ASSETS = {
  XAUUSD: 'GC=F',
  XAGUSD: 'SI=F',
  GLD: 'GLD',
  US30: '^DJI',
  NAS100: '^NDX',
  SPX500: '^GSPC',
  VIX: '^VIX',
  BTCUSD: 'BTC-USD',
  USOIL: 'CL=F',
  UKOIL: 'BZ=F',
  USD: 'DX-Y.NYB',
  CAD: 'CAD=X',
  US10Y_YF: '^TNX',
  US5Y_YF: '^FVX',
  US3M_YF: '^IRX',
  TLT: 'TLT',
  HYG: 'HYG',
  LQD: 'LQD'
};

function logRetsFromPts(pts, len = 95) {
  const s = pts.slice(-(len + 1));
  const r = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i].v > 0 && s[i - 1].v > 0) r.push(Math.log(s[i].v / s[i - 1].v));
  }
  return r;
}

function sma(pts, n) {
  if (pts.length < n) return null;
  return mean(pts.slice(-n).map(p => p.v));
}

async function multiAssets(force = false) {
  const [{ publicGold, pts: goldPts }, ...yfRes] = await Promise.all([
    getUnifiedGold(force),
    ...Object.keys(YF_ASSETS).map(k => fetchYfChart(YF_ASSETS[k], '6mo').then(r => [k, r]).catch(e => [k, null, e.message]))
  ]);

  const series = {};
  const rets = {};
  const data = {};
  const errors = {};

  for (const [k, r, err] of yfRes) {
    if (r && r.pts?.length) {
      const pts = r.pts;
      series[k] = pts;
      rets[k] = logRetsFromPts(pts, 95);
      const last = r.livePrice ?? pts.at(-1).v;
      const prev1 = pts.at(-2)?.v ?? null;
      const prev5 = pts[Math.max(0, pts.length - 6)]?.v ?? null;
      const prev21 = pts[Math.max(0, pts.length - 22)]?.v ?? null;
      const sma20 = sma(pts, 20);
      const sma50 = sma(pts, 50);

      data[k] = buildIndicator({
        value: last,
        prev: prev1,
        observationDate: pts.at(-1).d,
        publishedAt: r.liveTime,
        source: 'Yahoo Finance',
        series: `${k} (${YF_ASSETS[k]})`,
        frequency: 'daily',
        unit: k.includes('Y_YF') ? '%' : 'USD',
        extra: {
          price: round4(last),
          d1: prev1 ? round4(last / prev1 - 1) : null,
          w1: prev5 ? round4(last / prev5 - 1) : null,
          m1: prev21 ? round4(last / prev21 - 1) : null,
          sma20: round2(sma20),
          sma50: round2(sma50),
          trend: sma20 && sma50 ? (last > sma20 && sma20 > sma50 ? 'Bullish Uptrend' : last < sma20 && sma20 < sma50 ? 'Bearish Downtrend' : 'Range / Transitional') : 'Neutral'
        }
      });
    } else {
      errors[k] = err || 'Unavailable (Source Timeout)';
      data[k] = makeUnavailableIndicator('Yahoo Finance', 'Unavailable (Source Timeout)', 'daily', 'USD');
    }
  }

  // Enforce Priority 1.2: Unified Gold Object across the entire backend
  if (publicGold && publicGold.price != null) {
    data.XAUUSD = { ...publicGold };
    if (goldPts.length >= 25) {
      series.XAUUSD = goldPts;
      rets.XAUUSD = logRetsFromPts(goldPts, 95);
    }
  }

  // Invert CAD=X (USD/CAD) returns so CAD represents CAD strength
  if (rets.CAD) rets.CAD = rets.CAD.map(v => -v);

  // Multi-horizon 30D / 60D / 90D cross-asset correlations + breakdown alerts
  const assetKeys = Object.keys(rets);
  const correlations = { '30D': {}, '60D': {}, '90D': {} };
  const breakdownAlerts = [];

  for (const wLabel of ['30D', '60D', '90D']) {
    const win = Number(wLabel.replace('D', ''));
    for (const a of assetKeys) {
      correlations[wLabel][a] = {};
      for (const b of assetKeys) {
        if (a !== b) correlations[wLabel][a][b] = corrArr(rets[a], rets[b], win);
      }
    }
  }

  const WATCH_PAIRS = [
    ['XAUUSD', 'USD'], ['XAUUSD', 'US10Y_YF'], ['XAUUSD', 'XAGUSD'],
    ['BTCUSD', 'NAS100'], ['BTCUSD', 'USD'], ['BTCUSD', 'TLT'],
    ['USOIL', 'CAD'], ['SPX500', 'VIX'], ['NAS100', 'US10Y_YF']
  ];
  for (const [a, b] of WATCH_PAIRS) {
    const c30 = correlations['30D'][a]?.[b];
    const c90 = correlations['90D'][a]?.[b];
    if (c30 != null && c90 != null && Math.abs(c30 - c90) > 0.35) {
      const div = round2(c30 - c90);
      breakdownAlerts.push({
        pairA: a,
        pairB: b,
        pair: `${a} vs ${b}`,
        corr30D: c30,
        corr90D: c90,
        divergence: div,
        absDivergence: Math.abs(div),
        direction: div > 0 ? 'Correlation Strengthening' : 'Correlation Breakdown',
        alertText: `${a} vs ${b} 30D corr (${c30}) shifted ${div >= 0 ? '+' : ''}${div} from 90D norm (${c90}).`
      });
    }
  }

  // Build Priority 3 Cross-Asset Drivers Panel
  const goldPx = data.XAUUSD?.price;
  const silverPx = data.XAGUSD?.price;
  const goldSilverRatio = goldPx && silverPx ? round2(goldPx / silverPx) : null;

  const wtiPx = data.USOIL?.price;
  const brentPx = data.UKOIL?.price;
  const wtiBrentSpread = wtiPx != null && brentPx != null ? round2(brentPx - wtiPx) : null;
  const oilM1 = data.USOIL?.m1 != null ? data.USOIL.m1 * 100 : null;
  const oilRegime = oilM1 == null ? 'Unavailable'
    : (oilM1 > 6 && (wtiBrentSpread ?? 4) < 5) ? 'Demand Expansion / Tight Supply'
    : (oilM1 > 2) ? 'Moderately Bullish / Supply Support'
    : (oilM1 < -6) ? 'Demand Slowdown / Oversupply Risk'
    : 'Balanced / Range-Bound';

  const vixVal = data.VIX?.price;
  const vixRegime = vixVal == null ? 'Unavailable'
    : vixVal < 15 ? 'Low Vol / Complacent (<15)'
    : vixVal < 20 ? 'Normal Risk Environment (15–20)'
    : vixVal < 28 ? 'Elevated Volatility / Caution (20–28)'
    : 'Stress / Panic Regime (>28)';

  const hygM1 = data.HYG?.m1 ?? 0;
  const lqdM1 = data.LQD?.m1 ?? 0;
  const creditSpreadProxy = data.HYG?.price && data.LQD?.price ? round2((hygM1 - lqdM1) * 100) : null;
  const spxM1 = data.SPX500?.m1 != null ? data.SPX500.m1 * 100 : null;
  const riskCompositeScore = round2(
    (vixVal != null ? clamp((20 - vixVal) / 5, -2, 2) : 0) +
    (spxM1 != null ? clamp(spxM1 / 3, -2, 2) : 0) +
    (creditSpreadProxy != null ? clamp(creditSpreadProxy / 1.5, -1, 1) : 0)
  );
  const riskRegime = riskCompositeScore > 1.0 ? 'Risk-On' : riskCompositeScore < -1.0 ? 'Risk-Off' : 'Neutral / Mixed';

  const crossAssetDrivers = {
    usd: {
      dxy: data.USD,
      us10yMarket: data.US10Y_YF,
      us5yMarket: data.US5Y_YF,
      us3mMarket: data.US3M_YF,
      corrVsGold30D: correlations['30D'].USD?.XAUUSD ?? null,
      corrVsBtc30D: correlations['30D'].USD?.BTCUSD ?? null
    },
    gold: {
      spot: data.XAUUSD,
      silver: data.XAGUSD,
      gldEtf: data.GLD,
      goldSilverRatio,
      goldSilverInterpretation: goldSilverRatio == null ? 'N/A' : goldSilverRatio > 85 ? 'Silver historically cheap vs Gold (haven-dominated bullion bid)' : goldSilverRatio < 70 ? 'Industrial/silver outperformance (reflationary tilt)' : 'Balanced historical Gold/Silver ratio',
      corrVsDxy: { '30D': correlations['30D'].XAUUSD?.USD ?? null, '60D': correlations['60D'].XAUUSD?.USD ?? null, '90D': correlations['90D'].XAUUSD?.USD ?? null },
      corrVsUs10y: { '30D': correlations['30D'].XAUUSD?.US10Y_YF ?? null, '60D': correlations['60D'].XAUUSD?.US10Y_YF ?? null, '90D': correlations['90D'].XAUUSD?.US10Y_YF ?? null },
      corrVsSilver: { '30D': correlations['30D'].XAUUSD?.XAGUSD ?? null, '60D': correlations['60D'].XAUUSD?.XAGUSD ?? null, '90D': correlations['90D'].XAUUSD?.XAGUSD ?? null }
    },
    oil: {
      wti: data.USOIL,
      brent: data.UKOIL,
      brentWtiSpread: wtiBrentSpread,
      regime: oilRegime,
      corrVsCad: { '30D': correlations['30D'].USOIL?.CAD ?? null, '60D': correlations['60D'].USOIL?.CAD ?? null, '90D': correlations['90D'].USOIL?.CAD ?? null }
    },
    riskSentiment: {
      vix: data.VIX,
      vixRegime,
      spx: data.SPX500,
      nas100: data.NAS100,
      us30: data.US30,
      creditProxyHyVsIg1MPct: creditSpreadProxy,
      riskCompositeScore,
      riskRegime
    },
    crypto: {
      btc: data.BTCUSD,
      corrVsNas100: { '30D': correlations['30D'].BTCUSD?.NAS100 ?? null, '60D': correlations['60D'].BTCUSD?.NAS100 ?? null, '90D': correlations['90D'].BTCUSD?.NAS100 ?? null },
      corrVsDxy: { '30D': correlations['30D'].BTCUSD?.USD ?? null, '60D': correlations['60D'].BTCUSD?.USD ?? null, '90D': correlations['90D'].BTCUSD?.USD ?? null },
      corrVsUs10y: { '30D': correlations['30D'].BTCUSD?.US10Y_YF ?? null, '60D': correlations['60D'].BTCUSD?.US10Y_YF ?? null, '90D': correlations['90D'].BTCUSD?.US10Y_YF ?? null },
      corrVsTlt: { '30D': correlations['30D'].BTCUSD?.TLT ?? null, '60D': correlations['60D'].BTCUSD?.TLT ?? null, '90D': correlations['90D'].BTCUSD?.TLT ?? null }
    }
  };

  return {
    data,
    gold: data.XAUUSD,
    corr: correlations['60D'], // Backward compatibility
    correlations,
    correlationBreakdownAlerts: breakdownAlerts,
    crossAssetDrivers,
    errors,
    updatedAt: Date.now(),
    fetchedAt: new Date().toISOString(),
    source: 'Yahoo Finance daily closes + Unified Gold Feed (30D/60D/90D rolling log-return correlations)'
  };
}

// ============================================================================
// 6. FRED, BLS & MACRO DASHBOARD (PRIORITY 1.1, 1.2, 2.7–2.14)
// ============================================================================

const FRED_SERIES = {
  us2y: { id: 'DGS2', freq: 'daily', unit: '%', label: 'US 2Y Treasury Yield' },
  us5y: { id: 'DGS5', freq: 'daily', unit: '%', label: 'US 5Y Treasury Yield' },
  us10y: { id: 'DGS10', freq: 'daily', unit: '%', label: 'US 10Y Treasury Yield' },
  tips10y: { id: 'DFII10', freq: 'daily', unit: '%', label: 'US 10Y TIPS Real Yield' },
  usdBroad: { id: 'DTWEXBGS', freq: 'daily', unit: 'idx', label: 'Broad Trade-Weighted USD' },
  wti: { id: 'DCOILWTICO', freq: 'daily', unit: '$/bbl', label: 'WTI Crude Oil' },
  brent: { id: 'DCOILBRENTEU', freq: 'daily', unit: '$/bbl', label: 'Brent Crude Oil' },
  pceHeadline: { id: 'PCEPI', freq: 'monthly', unit: '%', yoy: true, label: 'US PCE Headline y/y' },
  pceCore: { id: 'PCEPILFE', freq: 'monthly', unit: '%', yoy: true, label: 'US Core PCE y/y' },
  coreCpiUs: { id: 'CPILFESL', freq: 'monthly', unit: '%', yoy: true, label: 'US Core CPI y/y' },
  retailSalesUs: { id: 'RSAFS', freq: 'monthly', unit: '%', yoy: true, label: 'US Retail Sales y/y' },
  indProdUs: { id: 'INDPRO', freq: 'monthly', unit: '%', yoy: true, label: 'US Industrial Production y/y' },
  wageGrowthUs: { id: 'CES0500000003', freq: 'monthly', unit: '%', yoy: true, label: 'US Avg Hourly Earnings y/y' },
  participationUs: { id: 'CIVPART', freq: 'monthly', unit: '%', label: 'US Labor Participation Rate' },
  de10y: { id: 'IRLTLT01DEM156N', freq: 'monthly', unit: '%', label: 'Germany 10Y Bund Yield' },
  jp10y: { id: 'IRLTLT01JPM156N', freq: 'monthly', unit: '%', label: 'Japan 10Y JGB Yield' }
};

async function fredPts(id, tries = 2) {
  const txt = await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id, {}, tries);
  const rows = txt.trim().split(/\r?\n/).slice(1)
    .map(l => l.split(','))
    .filter(p => p[1] && p[1] !== '.' && !isNaN(+p[1]))
    .map(p => [p[0], +p[1]]);
  if (!rows.length) throw new Error(id + ' empty');
  return rows;
}

function calcYoYSeries(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [d, v] = pts[i];
    const targetMs = new Date(d).getTime() - 365 * DAY_MS;
    const base = pts.find(x => Math.abs(new Date(x[0]).getTime() - targetMs) < 25 * DAY_MS);
    if (base && base[1] !== 0) {
      out.push([d, ((v / base[1]) - 1) * 100]);
    }
  }
  if (!out.length) throw new Error('No year-ago point');
  return out;
}

function calc3mAnnualized(pts) {
  if (!pts || pts.length < 4) return null;
  const latest = pts.at(-1);
  const prev3 = pts.at(-4);
  if (!prev3 || prev3[1] <= 0) return null;
  const ann = (Math.pow(latest[1] / prev3[1], 4) - 1) * 100;
  return round2(ann);
}

async function fetchFredMetric(cfg) {
  const pts = await fredPts(cfg.id, 2);
  let workPts = pts;
  let trend3mAnn = null;
  if (cfg.yoy) {
    trend3mAnn = calc3mAnnualized(pts);
    workPts = calcYoYSeries(pts);
  }
  const latest = workPts.at(-1);
  const prev = workPts.at(-2);
  const prev3 = workPts.at(-4);
  return buildIndicator({
    value: latest[1],
    prev: prev ? prev[1] : null,
    observationDate: latest[0],
    source: 'FRED',
    series: `FRED ${cfg.id} (${cfg.label})`,
    frequency: cfg.freq,
    unit: cfg.unit,
    extra: {
      delta1: prev ? round2(latest[1] - prev[1]) : null,
      delta3m: prev3 ? round2(latest[1] - prev3[1]) : null,
      annualized3m: trend3mAnn
    }
  });
}

async function fetchBls() {
  const yr = new Date().getFullYear();
  const body = JSON.stringify({
    seriesid: ['CUUR0000SA0', 'LNS14000000', 'CES0000000001', 'LNS11300000', 'CES0500000003'],
    startyear: String(yr - 2),
    endyear: String(yr)
  });
  const t = await getText('https://api.bls.gov/publicAPI/v1/timeseries/data/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }, 2);
  const j = JSON.parse(t);
  const S = {};
  for (const s of j?.Results?.series || []) {
    S[s.seriesID] = (s.data || []).filter(d => d.value !== '-' && /^M\d{2}$/.test(d.period));
  }
  const toObs = d => `${d.year}-${d.period.slice(1)}-01`;
  const o = {};

  const cpi = S.CUUR0000SA0 || [];
  if (cpi.length) {
    const prevYr = cpi.find(d => d.period === cpi[0].period && +d.year === +cpi[0].year - 1);
    const prev3 = cpi[3];
    const ann3m = prev3 ? round2((Math.pow(+cpi[0].value / +prev3.value, 4) - 1) * 100) : null;
    if (prevYr) {
      o.cpiYoY = buildIndicator({
        value: (+cpi[0].value / +prevYr.value - 1) * 100,
        observationDate: toObs(cpi[0]),
        source: 'BLS',
        series: 'BLS CUUR0000SA0 (US CPI-U y/y)',
        frequency: 'monthly',
        unit: '%',
        extra: { annualized3m: ann3m }
      });
    }
  }

  const u = S.LNS14000000 || [];
  if (u.length >= 2) {
    const d3 = u[3] ? round2(+u[0].value - +u[3].value) : null;
    o.unemployment = buildIndicator({
      value: +u[0].value,
      prev: +u[1].value,
      observationDate: toObs(u[0]),
      source: 'BLS',
      series: 'BLS LNS14000000 (US Unemployment Rate)',
      frequency: 'monthly',
      unit: '%',
      extra: {
        delta3m: d3,
        trend3m: d3 == null ? 'Unknown' : d3 <= -0.2 ? 'Tightening' : d3 >= 0.2 ? 'Loosening' : 'Stable'
      }
    });
  }

  const n = S.CES0000000001 || [];
  if (n.length >= 2) {
    const chg = Math.round(+n[0].value - +n[1].value);
    const prevChg = n[2] ? Math.round(+n[1].value - +n[2].value) : null;
    o.payrollsChange = buildIndicator({
      value: chg,
      prev: prevChg,
      observationDate: toObs(n[0]),
      source: 'BLS',
      series: 'BLS CES0000000001 (US Nonfarm Payrolls m/m)',
      frequency: 'monthly',
      unit: 'k'
    });
  }

  const part = S.LNS11300000 || [];
  if (part.length >= 2) {
    o.participation = buildIndicator({
      value: +part[0].value,
      prev: +part[1].value,
      observationDate: toObs(part[0]),
      source: 'BLS',
      series: 'BLS LNS11300000 (US Labor Force Participation)',
      frequency: 'monthly',
      unit: '%'
    });
  }

  const ahe = S.CES0500000003 || [];
  if (ahe.length) {
    const prevYr = ahe.find(d => d.period === ahe[0].period && +d.year === +ahe[0].year - 1);
    if (prevYr) {
      o.wageGrowthYoY = buildIndicator({
        value: (+ahe[0].value / +prevYr.value - 1) * 100,
        observationDate: toObs(ahe[0]),
        source: 'BLS',
        series: 'BLS CES0500000003 (US Avg Hourly Earnings y/y)',
        frequency: 'monthly',
        unit: '%'
      });
    }
  }

  return o;
}

async function dashboard(force = false) {
  const keys = Object.keys(FRED_SERIES);
  const [{ publicGold }, blsRes, ...fredRes] = await Promise.all([
    getUnifiedGold(force),
    fetchBls().then(v => ({ ok: true, v })).catch(e => ({ ok: false, err: e.message })),
    ...keys.map(k => fetchFredMetric(FRED_SERIES[k]).then(v => ({ k, ok: true, v })).catch(e => ({ k, ok: false, err: e.message })))
  ]);

  const fredOut = {};
  const errors = {};
  for (const r of fredRes) {
    if (r.ok) {
      fredOut[r.k] = r.v;
    } else {
      fredOut[r.k] = makeUnavailableIndicator('FRED', 'Unavailable (Source Timeout)', FRED_SERIES[r.k].freq, FRED_SERIES[r.k].unit);
      errors[r.k] = r.err;
    }
  }

  // Unified Gold feed injected identically into fred.gold and top-level gold (Priority 1.2)
  fredOut.gold = publicGold;

  const blsOut = blsRes.ok ? blsRes.v : {
    cpiYoY: makeUnavailableIndicator('BLS', 'Unavailable (Source Timeout)', 'monthly', '%'),
    unemployment: makeUnavailableIndicator('BLS', 'Unavailable (Source Timeout)', 'monthly', '%'),
    payrollsChange: makeUnavailableIndicator('BLS', 'Unavailable (Source Timeout)', 'monthly', 'k'),
    participation: makeUnavailableIndicator('BLS', 'Unavailable (Source Timeout)', 'monthly', '%'),
    wageGrowthYoY: makeUnavailableIndicator('BLS', 'Unavailable (Source Timeout)', 'monthly', '%')
  };
  if (!blsRes.ok) errors.bls = blsRes.err;

  // Derived US Macro metrics
  const us10y = fredOut.us10y?.value;
  const us2y = fredOut.us2y?.value;
  const tips10y = fredOut.tips10y?.value;
  const usCpi = blsOut.cpiYoY?.value;

  const derived = {
    spread2s10s: us10y != null && us2y != null ? buildIndicator({
      value: us10y - us2y,
      observationDate: fredOut.us10y.observationDate,
      source: 'Derived',
      series: 'US 10Y − US 2Y Yield Spread',
      frequency: 'daily',
      unit: 'pp'
    }) : makeUnavailableIndicator('Derived', 'N/A — Pending Release', 'daily', 'pp'),
    breakeven10y: us10y != null && tips10y != null ? buildIndicator({
      value: us10y - tips10y,
      observationDate: fredOut.us10y.observationDate,
      source: 'Derived',
      series: 'US 10Y Nominal − 10Y TIPS Breakeven Inflation',
      frequency: 'daily',
      unit: '%'
    }) : makeUnavailableIndicator('Derived', 'N/A — Pending Release', 'daily', '%'),
    usRealYieldNominalMinusCpi: us10y != null && usCpi != null ? buildIndicator({
      value: us10y - usCpi,
      observationDate: fredOut.us10y.observationDate,
      source: 'Derived',
      series: 'US 10Y Nominal Yield − Latest Headline CPI',
      frequency: 'monthly',
      unit: '%'
    }) : makeUnavailableIndicator('Derived', 'N/A — Pending Release', 'monthly', '%')
  };

  // Safe-haven sovereign bond yield compression (negative delta = bond buying / haven flow)
  const bondDemand = {
    us10yYieldChange: fredOut.us10y?.delta1 ?? null,
    de10yYield: fredOut.de10y,
    jp10yYield: fredOut.jp10y,
    de10yDelta1m: fredOut.de10y?.delta1 ?? null,
    jp10yDelta1m: fredOut.jp10y?.delta1 ?? null
  };

  const tracked = [
    ...Object.entries(fredOut).map(([k, v]) => [`fred.${k}`, v]),
    ...Object.entries(blsOut).map(([k, v]) => [`bls.${k}`, v])
  ];

  return {
    fred: fredOut,
    bls: blsOut,
    derived,
    gold: publicGold,
    bondDemand,
    freshness: summarizeFreshness(tracked),
    errors,
    fetchedAt: new Date().toISOString()
  };
}

// ============================================================================
// 7. CONTEXT-AWARE NEWS ENGINE (PRIORITY 1.5)
// ============================================================================

const NEWS_QUERIES = [
  { cat: 'Central Banks', q: '"central bank" OR Fed OR ECB OR "Bank of England" OR "Bank of Japan" interest rates' },
  { cat: 'Currencies', q: 'forex OR "currency markets" OR "US dollar" OR euro OR yen OR sterling' },
  { cat: 'Macro & Rates', q: 'inflation OR CPI OR PCE OR "nonfarm payrolls" OR "Treasury yields" OR GDP' },
  { cat: 'Macro & Rates', q: 'site:reuters.com inflation OR economy OR "interest rates"' },
  { cat: 'Currencies', q: 'site:reuters.com forex OR currencies OR dollar' },
  ...[
    ['USD', '"US dollar" OR "Federal Reserve" OR "dollar index"'],
    ['EUR', 'euro OR ECB OR eurozone OR EUR/USD'],
    ['GBP', 'sterling OR "Bank of England" OR GBP/USD'],
    ['JPY', 'yen OR "Bank of Japan" OR USD/JPY'],
    ['CHF', '"Swiss franc" OR SNB OR "Swiss National Bank"'],
    ['CAD', '"Canadian dollar" OR loonie OR "Bank of Canada"'],
    ['AUD', '"Australian dollar" OR RBA OR "Reserve Bank of Australia"'],
    ['NZD', '"New Zealand dollar" OR RBNZ OR kiwi'],
    ['XAUUSD', 'gold price OR XAUUSD OR bullion'],
    ['XAGUSD', 'silver price OR XAGUSD'],
    ['US30', 'Dow Jones OR US30 OR DJIA'],
    ['NAS100', 'Nasdaq 100 OR NAS100 OR NDX tech stocks'],
    ['SPX500', 'S&P 500 OR SPX500 OR Wall Street'],
    ['BTCUSD', 'bitcoin OR BTCUSD OR crypto market'],
    ['USOIL', 'WTI crude oil OR USOIL OR OPEC oil price'],
    ['UKOIL', 'Brent crude oil OR UKOIL']
  ].map(([tag, q]) => ({ cat: 'Top Stories', tag, q }))
];

const YF_RSS = q => `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${q}&region=US&lang=en-US`;
const DIRECT_FEEDS = [
  ['https://www.fxstreet.com/rss/news', 'FXStreet', 'Top Stories'],
  ['https://www.fxempire.com/api/v1/en/articles/rss/news', 'FXEmpire', 'Top Stories'],
  ['https://www.investing.com/rss/news_1.rss', 'Investing.com', 'Top Stories'],
  ['https://www.investing.com/rss/news_11.rss', 'Investing.com', 'Top Stories'],
  ['https://www.dailyfx.com/feeds/market-news', 'DailyFX', 'Top Stories'],
  [YF_RSS('GC=F'), 'Yahoo Finance', 'Top Stories', 'XAUUSD'],
  [YF_RSS('SI=F'), 'Yahoo Finance', 'Top Stories', 'XAGUSD'],
  [YF_RSS('^DJI,^NDX,^GSPC'), 'Yahoo Finance', 'Top Stories', 'NAS100'],
  [YF_RSS('BTC-USD'), 'Yahoo Finance', 'Top Stories', 'BTCUSD'],
  [YF_RSS('CL=F,BZ=F'), 'Yahoo Finance', 'Top Stories', 'USOIL'],
  [YF_RSS('EURUSD=X,GBPUSD=X,JPY=X,CHF=X,CAD=X,AUDUSD=X,NZDUSD=X'), 'Yahoo Finance', 'Top Stories'],
  ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', 'CNBC', null],
  ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', 'CNBC', null],
  ['https://feeds.content.dowjones.io/public/rss/mw_marketpulse', 'MarketWatch', null],
  ['https://feeds.content.dowjones.io/public/rss/mw_topstories', 'MarketWatch', null]
];
const CB_FEEDS = [
  ['USD', 'https://www.federalreserve.gov/feeds/press_all.xml', 'Federal Reserve'],
  ['EUR', 'https://www.ecb.europa.eu/rss/press.html', 'ECB'],
  ['GBP', 'https://www.bankofengland.co.uk/rss/news', 'Bank of England'],
  ['JPY', 'https://www.boj.or.jp/en/rss/whatsnew.xml', 'Bank of Japan'],
  ['CHF', 'https://www.snb.ch/public/en/rss/pressrel', 'SNB'],
  ['CAD', 'https://www.bankofcanada.ca/content_type/press-releases/feed/', 'Bank of Canada'],
  ['AUD', 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', 'RBA'],
  ['NZD', 'https://www.rbnz.govt.nz/feeds/news', 'RBNZ']
];

const DRV_HI = [
  ['Intervention', /interven(e|tion)|emergency (rate|meeting|cut|hike)/i],
  ['Rate decision', /rate decision|rate (hike|cut)s?|\b(raises?|cuts?|holds?|lifts?|slashes|keeps|leaves|hikes?) (its |the )?(key |benchmark |policy |interest |cash )?rates?\b|interest[- ]rate (decision|announcement)|policy rate|monetary policy (decision|meeting|statement)|\bfomc\b|\bmpc\b|rba board|official cash rate|\bocr\b/i],
  ['Central bank speech', /\b(fed|federal reserve|ecb|boe|bank of england|boj|bank of japan|rba|reserve bank|rbnz|boc|bank of canada|snb|swiss national bank)\b.*\b(says?|said|signals?|warns?|hints?|flags?|speech|testimony|remarks|statement|minutes|chair|governor)\b|\b(powell|lagarde|bailey|ueda|macklem|bullock|schlegel|breman)\b/i],
  ['CPI / inflation', /\bcpi\b|\bpce\b|inflation|consumer prices?|producer prices?|\bppi\b/i],
  ['GDP', /\bgdp\b|gross domestic product/i],
  ['NFP / jobs', /non-?farm|\bnfp\b|payrolls?|unemployment|jobless (rate|claims)|jobs report|employment (data|report|change)|labou?r market/i],
  ['OPEC / Inventories', /\b(opec|opec\+|eia|crude inventories|oil stockpiles)\b/i]
];
const DRV_MED = [
  ['Rate expectations', /(rate[- ])?(cut|hike)s? (bets|expectations|odds|hopes)|rate expectations|pricing in|fed funds futures/i],
  ['PMI', /\bpmi\b|purchasing managers/i],
  ['Retail sales', /retail sales/i],
  ['Trade balance', /trade (balance|deficit|surplus|gap)|current account/i],
  ['Consumer confidence', /(consumer|business) (confidence|sentiment)|\bzew\b|\bifo\b|michigan/i],
  ['Bond yields', /\byields?\b|treasur(y|ies)|\bgilts?\b|\bbunds?\b|\bjgbs?\b|bond (market|sell-?off|rally)/i],
  ['Analyst forecast', /forecast|outlook|predict|analysts?|strategists?|price target|projection/i],
  ['Market sentiment', /risk (appetite|sentiment|aversion)|risk-(on|off)|safe[- ]haven|market sentiment|volatility|\bvix\b/i]
];
const driverOf = t => {
  for (const [n, r] of DRV_HI) if (r.test(t)) return [n, 'HIGH'];
  for (const [n, r] of DRV_MED) if (r.test(t)) return [n, 'MEDIUM'];
  return [null, 'LOW'];
};

const moveOf = t => {
  const u = /\b(rall(y|ies|ied)|surg\w*|jump\w*|climb\w*|gains?|rises?|rose|record high|soar\w*|strengthen\w*|firms?|advances?|rebound\w*|higher)\b/i.test(t);
  const d = /\b(falls?|fell|drops?|dropped|slump\w*|slid\w*|slides|declin\w*|tumbl\w*|sinks?|weaken\w*|lower|loses|losses|plung\w*|slips?|retreats?)\b/i.test(t);
  return u && !d ? 'Up' : d && !u ? 'Down' : 'Flat';
};

/**
 * Priority 1.5: Context-Aware News Sentiment & Policy Implication Analyzer
 * Evaluates headline + summary jointly, distinguishing directional surprises,
 * inverted indicators (unemployment/claims), negation ("pushes back on cuts"),
 * and central bank hold/cut/hike guidance.
 */
function analyzeNewsContext(title = '', summary = '') {
  const full = `${title}. ${summary || ''}`.trim();
  const low = full.toLowerCase();

  let score = 0; // >0 = Hawkish/Bullish currency, <0 = Dovish/Bearish currency
  let confidence = 35;
  let rationale = 'General market coverage without a clear policy-rate or macro surprise catalyst.';
  let policyImplication = 'Market Noise / Context';

  // Regex blocks for directional surprise & policy language
  const HOT_UP = /\b(surges?|jumps?|spikes?|accelerates?|hotter|sticky|persistent|beats?|tops?|exceeds?|above (forecast|consensus|estimates?|expectations)|stronger[- ]than[- ]expected|unexpected rise|upside surprise|rebounds? sharply)\b/i;
  const COOL_DN = /\b(cools?|eases?|slows?|drops?|falls?|slips?|misses?|below (forecast|consensus|estimates?|expectations)|weaker[- ]than[- ]expected|unexpected (drop|fall|decline)|downside surprise|disinflation|moderates?|softens?|contracts?)\b/i;

  const IS_INFLATION = /\b(cpi|pce|inflation|consumer prices?|core prices?|ppi|price pressures?|wage growth)\b/i.test(full);
  const IS_JOBS = /\b(non-?farm|nfp|payrolls?|job growth|hiring|employment change|jobs report|labour market|labor market)\b/i.test(full);
  const IS_UNEMP = /\b(unemployment rate|jobless claims|jobless rate|layoffs)\b/i.test(full);
  const IS_GROWTH = /\b(gdp|retail sales|pmi|ism|industrial production|economic growth|consumer spending)\b/i.test(full);
  const IS_CB = /\b(fed|fomc|ecb|boe|boj|snb|rba|rbnz|boc|central bank|powell|lagarde|bailey|ueda|macklem|bullock|policymakers?|rate decision|monetary policy)\b/i.test(full);

  // 1. Central bank explicit action / negation-aware forward guidance
  const PUSHBACK_CUTS = /\b(push(es|ed|ing)? back|rules? out|no rush|not in a hurry|delay(s|ed|ing)?|par(e|es|ed|ing) back|reduces? bets on|dampens? hopes for)\b[^.]{0,45}\b(rate )?cuts?\b/i;
  const SIGNAL_HIKE = /\b(hikes?|raises?|lifts?|tightens?)\b[^.]{0,35}\b(interest |policy |cash |benchmark )?rates?\b|\bhawkish\b|\bhigher for longer\b|\bopen to (a )?hike\b/i;
  const SIGNAL_CUT = /\b(cuts?|slashes?|lowers?|reduces?)\b[^.]{0,35}\b(interest |policy |cash |benchmark )?rates?\b|\bdovish\b|\bopens? (the )?door to (rate )?cuts?\b|\bsignals? (easing|rate cuts?)\b|\beasing cycle\b/i;
  const SIGNAL_HOLD = /\b(holds?|keeps?|leaves?|maintains?)\b[^.]{0,35}\b(rates? )?(steady|unchanged|on hold)\b|\bdata[- ]dependent\b|\bwait[- ]and[- ]see\b|\bpauses?\b/i;

  if (IS_CB && PUSHBACK_CUTS.test(full)) {
    score += 2.2;
    confidence = 86;
    policyImplication = 'Hawkish Pushback / Higher-for-Longer';
    rationale = 'Policymakers pushed back against near-term rate cuts, lifting front-end yields (Hawkish).';
  } else if (IS_CB && SIGNAL_HIKE.test(full) && !SIGNAL_CUT.test(full)) {
    score += 2.5;
    confidence = 88;
    policyImplication = 'Tightening / Rate Hike Bias';
    rationale = 'Central bank tightening action or hawkish guidance supports domestic yield differentials.';
  } else if (IS_CB && SIGNAL_CUT.test(full) && !SIGNAL_HIKE.test(full)) {
    score -= 2.5;
    confidence = 88;
    policyImplication = 'Easing / Rate Cut Guidance';
    rationale = 'Central bank easing action or dovish cut guidance compresses yield support (Dovish).';
  } else if (IS_CB && SIGNAL_HOLD.test(full)) {
    const hawkTilt = /inflation remains|upside risks|restrictive|vigilant/i.test(full);
    const doveTilt = /cooling inflation|growth risks|labour cooling|easing soon/i.test(full);
    if (hawkTilt && !doveTilt) {
      score += 1.0;
      confidence = 74;
      policyImplication = 'Hawkish Hold';
      rationale = 'Central bank held rates steady while emphasizing inflation vigilance (Hawkish Hold).';
    } else if (doveTilt && !hawkTilt) {
      score -= 1.0;
      confidence = 74;
      policyImplication = 'Dovish Hold';
      rationale = 'Central bank held rates steady while flagging cooling growth/inflation (Dovish Hold).';
    } else {
      score = 0;
      confidence = 72;
      policyImplication = 'On Hold / Data-Dependent';
      rationale = 'Central bank signaled a neutral, data-dependent policy hold.';
    }
  }

  // 2. Macro release directional surprises (context-inverted for unemployment/claims!)
  if (IS_INFLATION) {
    const hot = HOT_UP.test(full);
    const cool = COOL_DN.test(full);
    if (hot && !cool) {
      score += 2.3;
      confidence = Math.max(confidence, 85);
      policyImplication = 'Hawkish Inflation Surprise';
      rationale = 'Hotter-than-expected inflation narrows room for rate cuts and supports yields (Hawkish).';
    } else if (cool && !hot) {
      score -= 2.3;
      confidence = Math.max(confidence, 85);
      policyImplication = 'Disinflation / Cut Catalyst';
      rationale = 'Inflation cooling below expectations increases rate-cut odds (Dovish).';
    }
  } else if (IS_UNEMP) {
    // Inverted indicator: rising unemployment = Dovish/Bearish; falling claims = Hawkish/Bullish
    const up = HOT_UP.test(full) || /\b(rises?|climbs?|ticks? up|higher)\b/i.test(full);
    const dn = COOL_DN.test(full) || /\b(falls?|drops?|declines?|lower|eases?)\b/i.test(full);
    if (up && !dn) {
      score -= 2.0;
      confidence = Math.max(confidence, 82);
      policyImplication = 'Labor Slack / Dovish Pressure';
      rationale = 'Rising unemployment/jobless claims signals labor slack and increases easing odds (Dovish).';
    } else if (dn && !up) {
      score += 1.8;
      confidence = Math.max(confidence, 80);
      policyImplication = 'Tight Labor Market / Hawkish';
      rationale = 'Falling unemployment/claims underscores labor resilience, keeping policy restrictive (Hawkish).';
    }
  } else if (IS_JOBS) {
    const hot = HOT_UP.test(full);
    const cool = COOL_DN.test(full);
    if (hot && !cool) {
      score += 2.1;
      confidence = Math.max(confidence, 84);
      policyImplication = 'Strong Labor / Higher Rates';
      rationale = 'Stronger payrolls/hiring delays easing expectations and lifts domestic yields (Hawkish).';
    } else if (cool && !hot) {
      score -= 2.1;
      confidence = Math.max(confidence, 84);
      policyImplication = 'Cooling Jobs / Easing Odds';
      rationale = 'Softer payrolls growth raises slowdown concerns and pulls rate cuts forward (Dovish).';
    }
  } else if (IS_GROWTH) {
    const hot = HOT_UP.test(full);
    const cool = COOL_DN.test(full);
    if (hot && !cool) {
      score += 1.7;
      confidence = Math.max(confidence, 78);
      policyImplication = 'Growth Outperformance';
      rationale = 'Upbeat growth/activity data reduces recession risk and supports currency inflows (Bullish).';
    } else if (cool && !hot) {
      score -= 1.7;
      confidence = Math.max(confidence, 78);
      policyImplication = 'Growth Slowdown Risk';
      rationale = 'Sub-consensus growth/PMI print weighs on rate expectations and FX sentiment (Bearish).';
    }
  }

  // 3. Risk-off / Geopolitics / Safe-haven flows when no macro release matched
  if (score === 0 && /\b(war|tariff|sanction|escalation|geopolitical|safe[- ]haven|flight to safety|crisis|sell-?off)\b/i.test(low)) {
    confidence = 68;
    policyImplication = 'Risk-Off / Safe-Haven Flow';
    rationale = 'Geopolitical or risk-aversion headline typically boosts CHF, JPY, USD, and Gold.';
  } else if (score === 0) {
    // Fallback to price action direction only with low confidence
    const mv = moveOf(title);
    if (mv === 'Up') {
      score = 0.6;
      confidence = 48;
      policyImplication = 'Price Momentum (Headline)';
      rationale = 'Headline reports upside price action without an explicit macro surprise trigger.';
    } else if (mv === 'Down') {
      score = -0.6;
      confidence = 48;
      policyImplication = 'Price Momentum (Headline)';
      rationale = 'Headline reports downside pressure without an explicit macro surprise trigger.';
    }
  }

  // Penalize confidence slightly if both headline and summary contain contradictory signals
  if (HOT_UP.test(full) && COOL_DN.test(full)) {
    confidence = Math.max(30, confidence - 22);
    rationale += ' (Mixed sub-components noted in text.)';
  }

  const tone = score >= 0.8 ? 'Hawkish' : score <= -0.8 ? 'Dovish' : 'Neutral';
  const directionalBias = score >= 0.6 ? 'Bullish' : score <= -0.6 ? 'Bearish' : 'Neutral';
  const confidenceLevel = confidence >= 78 ? 'High' : confidence >= 55 ? 'Medium' : 'Low';

  return {
    tone,
    directionalBias,
    sentimentScore: round2(score),
    sentimentConfidence: Math.round(clamp(confidence, 20, 95)),
    confidenceLevel,
    policyImplication,
    rationale
  };
}

const SPORT_RX = /\b(football|soccer|cricket|premier league|champions league|onefootball|nfl|nba|mlb|nhl|la liga|serie a|bundesliga|touchdown|quarterback)\b/i;
const AMBIG_RX = /\b(match(es)?|goals?|transfers?)\b/i;
const FIN_RX = /\b(forex|fx|currency|currencies|rates?|inflation|cpi|pce|gdp|fed|ecb|boe|boj|snb|rba|yields?|treasur\w*|central bank|bonds?|gold|silver|dollar|euro|yen|sterling|payrolls?|econom\w*|markets?|nasdaq|dow|s&p|bitcoin|crypto|oil|wti|brent|opec)\b/i;
const isNoiseNews = (t, sm = '') => SPORT_RX.test(t + ' ' + sm) || (AMBIG_RX.test(t) && !FIN_RX.test(t));

const CURX = {
  USD: /\b(usd|u\.?s\.? dollar|dollar index|greenback|fed\b|federal reserve|fomc|powell|treasur)|(?<!canadian |australian |new zealand |hong kong )\bdollar\b/i,
  EUR: /\b(eur\b|euro\b|ecb|lagarde|eurozone)/i,
  GBP: /\b(gbp|sterling|pound|boe\b|bank of england|bailey)/i,
  JPY: /\b(jpy|yen|boj\b|bank of japan|ueda)/i,
  CHF: /\b(chf|franc|snb\b|swiss)/i,
  CAD: /\b(cad\b|loonie|bank of canada|canadian)/i,
  AUD: /\b(aud\b|aussie|rba\b|australia)/i,
  NZD: /\b(nzd|kiwi|rbnz|new zealand)/i,
  XAUUSD: /\b(gold|bullion|xau|xauusd)\b/i,
  XAGUSD: /\b(silver|xag|xagusd)\b/i,
  US30: /\b(dow|dow jones|us30|djia|dj30)\b/i,
  NAS100: /\b(nasdaq|nas100|ndx|ustec|tech stocks)\b/i,
  SPX500: /\b(s&p 500|s&p|spx500|spx|us500|wall street)\b/i,
  BTCUSD: /\b(bitcoin|btc|btcusd|crypto|cryptocurrency)\b/i,
  USOIL: /\b(wti|usoil|crude oil|oil prices?|opec)\b/i,
  UKOIL: /\b(brent|ukoil|north sea oil)\b/i
};
const detectCur = t => Object.keys(CURX).filter(c => CURX[c].test(t)).slice(0, 6);
const classifyNews = t => /central bank|\bfed\b|fomc|\becb\b|\bboe\b|\bboj\b|\bsnb\b|\brba\b|rbnz|rate (cut|hike|decision)|powell|lagarde|bailey|ueda|monetary policy/i.test(t)
  ? 'Central Banks'
  : /inflation|\bcpi\b|\bpce\b|\bgdp\b|payroll|yield|treasur|jobs report|unemployment|\bpmi\b|retail sales|recession/i.test(t)
  ? 'Macro & Rates'
  : /forex|\bfx\b|dollar|\beuro\b|\byen\b|sterling|\bpound\b|franc|loonie|aussie|kiwi|currenc/i.test(t)
  ? 'Currencies'
  : 'Top Stories';

const decHtml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const cleanSummary = (d, t) => {
  const x = decHtml((d || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return x && !x.toLowerCase().startsWith(t.replace(/ - [^-]+$/, '').toLowerCase().slice(0, 30)) ? x.slice(0, 500) : '';
};
const fixUrl = u => {
  if (!u) return null;
  u = u.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  u = u.replace(/^http:\/\//i, 'https://');
  return /^https:\/\//.test(u) ? u : null;
};

function parseRss(x, src) {
  return [...x.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(m => {
    const b = m[1];
    const g = tag => {
      const r = b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return r ? decHtml(r[1].trim()) : '';
    };
    const d = new Date(g('pubDate') || g('dc:date'));
    const title = g('title');
    const raw = g('description') || g('content:encoded');
    const im = (
      b.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/) ||
      b.match(/<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/) ||
      b.match(/<enclosure[^>]*url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i) ||
      raw.match(/<img[^>]+src=["']([^"']+)["']/) ||
      []
    )[1];
    return {
      title,
      link: g('link'),
      source: g('source') || src || '',
      summary: cleanSummary(raw, title),
      img: fixUrl(im),
      time: isNaN(d) ? new Date().toISOString() : d.toISOString()
    };
  });
}

const META_TAGS = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'];
function pickMeta(t) {
  for (const k of META_TAGS) {
    const m = t.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, 'i')) ||
      t.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i'));
    if (m) {
      const u = fixUrl(decHtml(m[1]));
      if (u && !/logo|favicon|placeholder/i.test(u)) return u;
    }
  }
  return null;
}
async function readHead(r) {
  let s = '';
  const rd = r.body.getReader();
  const d = new TextDecoder();
  while (s.length < 250000) {
    const { done, value } = await rd.read();
    if (done) break;
    s += d.decode(value, { stream: true });
  }
  rd.cancel().catch(() => {});
  return s;
}
async function ogImage(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
    return pickMeta(await readHead(r));
  } catch {
    return null;
  }
}
const gnId = l => (l.match(/news\.google\.com\/(?:rss\/)?articles\/([^?#]+)/) || [])[1];
function legacyDecode(id) {
  try {
    let b = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b[0] === 8 && b[1] === 0x13 && b[2] === 0x22) b = b.subarray(3);
    if (b.length > 3 && b[b.length - 3] === 0xd2 && b[b.length - 2] === 1 && b[b.length - 1] === 0) b = b.subarray(0, -3);
    const len = b[0];
    const u = (len >= 0x80 ? b.subarray(2, len + 1) : b.subarray(1, len + 1)).toString('latin1');
    return /^https?:\/\//.test(u) ? u : null;
  } catch {
    return null;
  }
}
async function gnResolve(id) {
  const l = legacyDecode(id);
  if (l) return l;
  const H = { 'User-Agent': UA, Cookie: 'CONSENT=YES+cb; SOCS=CAI' };
  const html = await getText(`https://news.google.com/rss/articles/${id}`, { headers: H }, 1);
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) throw new Error('no signature');
  const inner = JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, +ts, sg]);
  const r = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])),
    signal: AbortSignal.timeout(8000)
  });
  const t = await r.text();
  try {
    return JSON.parse(JSON.parse(t.split('\n\n')[1].slice(0, -2))[0][2])[1];
  } catch {
    const m = t.match(/garturlres\\+",\\+"(https?:[^"\\]+)/);
    return m ? m[1] : null;
  }
}
async function enrichNews(items) {
  const gl = items.filter(i => gnId(i.link || '')).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 30);
  for (let k = 0; k < gl.length; k += 3) {
    await Promise.all(gl.slice(k, k + 3).map(async i => {
      try {
        const u = await gnResolve(gnId(i.link));
        if (u && !/news\.google\.com/.test(u)) i.link = u;
      } catch {}
    }));
  }
  const todo = items.filter(i => !i.img && i.link && !/news\.google\.com/.test(i.link)).slice(0, 40);
  for (let k = 0; k < todo.length; k += 6) {
    await Promise.all(todo.slice(k, k + 6).map(async i => { i.img = await ogImage(i.link); }));
  }
}

const relTime = isoStr => {
  const s = (Date.now() - new Date(isoStr)) / 1e3;
  const m = s / 60, h = m / 60, d = h / 24, f = Math.floor;
  return s < 60 ? 'just now' : m < 60 ? `${f(m)} min ago` : h < 24 ? `${f(h)} hour${f(h) > 1 ? 's' : ''} ago` : d < 7 ? `${f(d)} day${f(d) > 1 ? 's' : ''} ago` : new Date(isoStr).toISOString().slice(0, 10);
};

const presentNews = n => ({
  id: n.id,
  title: n.title,
  source: n.source,
  publishedAt: relTime(n.time),
  publishedAtIso: n.time,
  time: n.time,
  url: n.link,
  link: n.link,
  imageUrl: n.img || null,
  category: n.category,
  summary: n.summary,
  impact: n.impact,
  driver: n.driver || null,
  tone: n.tone,
  directionalBias: n.directionalBias,
  sentimentScore: n.sentimentScore,
  sentimentConfidence: n.sentimentConfidence,
  confidenceLevel: n.confidenceLevel,
  policyImplication: n.policyImplication,
  rationale: n.rationale,
  move: n.move || 'Flat',
  cur: n.cur,
  currencies: n.cur
});

let news = [];
const newsIdx = new Map();
const sseClients = new Set();
let lastPoll = null;

async function pollNews() {
  const jobs = [
    ...NEWS_QUERIES.map(({ cat, q, tag }) => ({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:2d')}&hl=en-US&gl=US&ceid=US:en`,
      cat, tag, src: ''
    })),
    ...DIRECT_FEEDS.map(([url, src, cat, tag]) => ({ url, src, cat, tag, gen: cat === null })),
    ...CB_FEEDS.map(([cur, url, src]) => ({ url, src, cat: 'Central Banks', tag: cur }))
  ];

  const rs = await Promise.allSettled(
    jobs.map(async j => ({ j, items: parseRss(await getText(j.url, { headers: { 'User-Agent': UA } }, 2), j.src) }))
  );

  const fresh = [];
  for (const r of rs) {
    if (r.status !== 'fulfilled') continue;
    const { j, items } = r.value;
    for (const it of items) {
      if (!it.title || isNoiseNews(it.title, it.summary) || Date.now() - new Date(it.time) > 7 * DAY_MS) continue;
      const text = it.title + ' ' + it.summary;
      const tags = [...new Set([...(j.tag ? [j.tag] : []), ...detectCur(text)])];
      const cat = !j.cat || j.cat === 'Top Stories' ? classifyNews(text) : j.cat;
      if (j.gen && cat === 'Top Stories' && !tags.length) continue;

      const norm = it.title.toLowerCase().replace(/ - [^-]+$/, '').replace(/[^a-z0-9]/g, '');
      const id = crypto.createHash('md5').update(norm).digest('hex').slice(0, 12);
      const ex = newsIdx.get(id);
      if (ex) {
        tags.forEach(t => { if (!ex.cur.includes(t)) ex.cur.push(t); });
        if (!ex.img && it.img) ex.img = it.img;
        continue;
      }

      const [driver, impact] = driverOf(it.title);
      const ctx = analyzeNewsContext(it.title, it.summary);
      const o = {
        id,
        ...it,
        category: cat,
        cur: tags,
        impact,
        driver,
        move: moveOf(it.title),
        ...ctx
      };
      newsIdx.set(id, o);
      fresh.push(o);
    }
  }

  lastPoll = new Date().toISOString();
  if (fresh.length) {
    news = [...fresh, ...news].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 450);
    if (newsIdx.size > 3000) {
      newsIdx.clear();
      news.forEach(n => newsIdx.set(n.id, n));
    }
    const msg = `event: news\ndata: ${JSON.stringify(fresh.map(presentNews))}\n\n`;
    sseClients.forEach(c => c.write(msg));
  }
  enrichNews(fresh).catch(() => {});
}
const newsLoop = () => pollNews().catch(() => {}).finally(() => setTimeout(newsLoop, 9e5));
const firstPoll = newsLoop();

// ============================================================================
// 8. DYNAMIC ECONOMIC CALENDAR (TRADINGVIEW PRIMARY + FXSTREET FALLBACK, IST)
// ============================================================================

const MAJ = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const TV_CUR = { US: 'USD', EU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
const calP2 = n => String(n).padStart(2, '0');

const HIGH_IMP_RX = /\b(cpi|hicp|consumer price|inflation rate|pce|personal consumption expenditures|non-?farm|nfp|payrolls|fomc|interest rate decision|cash rate|bank rate|policy rate|official cash rate|federal funds rate|monetary policy (decision|statement|press)|ecb press conference|rate decision|gdp|gross domestic product|unemployment rate|retail sales|ism (manufacturing|services|non-manufacturing) pmi|s&p global.*pmi|flash.*pmi|manufacturing pmi|services pmi|composite pmi|employment change|trimmed mean cpi|average hourly earnings)\b/i;
const LOW_EX_RX = /\b(auction|bond|bill|note|mortgage|redbook|api weekly|baker hughes|speaks|speech)\b/i;
const MED_IMP_RX = /\b(ppi|producer price|jobless claims|trade balance|building permits|housing starts|durable goods|consumer confidence|consumer sentiment|michigan|zew|ifo|industrial production|factory orders|existing home sales|new home sales|current account|minutes|crude oil inventories|eia|adp|speaks|speech)\b/i;
const INV_CAL_RX = /unemployment|jobless|claims|deficit|insolvenc|bankruptc|layoff/i;

function normalizeImpact(title, rawImp) {
  const t = String(title || '');
  if (HIGH_IMP_RX.test(t) && !LOW_EX_RX.test(t)) return 'High';
  if (rawImp === 'High') return 'High';
  if (MED_IMP_RX.test(t)) return 'Medium';
  return rawImp === 'Medium' ? 'Medium' : 'Low';
}

function fmtCalVal(v, unit, scale) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (/[%KMBT]$/i.test(s) || /[^\d.\-+eE]/.test(s)) return s;
  }
  const n = Number(v);
  if (isNaN(n)) return String(v).trim() || null;
  const sc = String(scale || '').trim().toUpperCase();
  const sfx = sc === 'K' || sc === 'THOUSANDS' ? 'K' : sc === 'M' || sc === 'MILLIONS' ? 'M' : sc === 'B' || sc === 'BILLIONS' ? 'B' : sc === 'T' || sc === 'TRILLIONS' ? 'T' : '';
  const u = String(unit || '').trim();
  const uSfx = !sfx && /^[KMBT]$/i.test(u) ? u.toUpperCase() : '';
  const pctSfx = u === '%' ? '%' : '';
  const numStr = Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
  return `${numStr}${sfx || uSfx}${pctSfx}`;
}

function parseCalNum(s) {
  if (s == null || s === '') return NaN;
  const cleaned = String(s).trim().replace(/[€£¥$,]/g, '');
  const m = cleaned.match(/^([+-]?[\d.]+)\s*([KMBT%]?)/i);
  if (!m) return NaN;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1;
  return parseFloat(m[1]) * mult;
}

function istParts(ms) {
  const d = new Date(ms + IST_OFF);
  return {
    date: `${d.getUTCFullYear()}-${calP2(d.getUTCMonth() + 1)}-${calP2(d.getUTCDate())}`,
    time: `${calP2(d.getUTCHours())}:${calP2(d.getUTCMinutes())}`
  };
}

function parseCalRange(fromQ, toQ) {
  const now = Date.now();
  const nowIst = new Date(now + IST_OFF);
  const todayIst0 = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()) - IST_OFF;
  const defFrom = todayIst0 - nowIst.getUTCDay() * DAY_MS;
  const defTo = defFrom + 7 * DAY_MS - 1;

  const parseBound = (raw, isEnd, fallback) => {
    if (!raw) return fallback;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return isEnd ? (Date.UTC(y, m - 1, d + 1) - IST_OFF - 1) : (Date.UTC(y, m - 1, d) - IST_OFF);
    }
    const ms = new Date(s).getTime();
    return isNaN(ms) ? fallback : ms;
  };

  let startMs = parseBound(fromQ, false, defFrom);
  let endMs = parseBound(toQ, true, fromQ ? parseBound(fromQ, true, defTo) : defTo);
  if (endMs < startMs) { const tmp = startMs; startMs = endMs; endMs = tmp; }
  if (endMs - startMs > 95 * DAY_MS) endMs = startMs + 95 * DAY_MS;

  const fromLabel = istParts(startMs).date;
  const toLabel = istParts(endMs).date;
  return {
    startMs,
    endMs,
    fromLabel,
    toLabel,
    fetchFromIso: new Date(startMs - 6 * 36e5).toISOString(),
    fetchToIso: new Date(endMs + 6 * 36e5).toISOString(),
    cacheKey: `cal_${fromLabel}_${toLabel}`,
    isFutureOnly: startMs > now + DAY_MS
  };
}

function buildCalItem({ rawId, title, currency, impact, timestamp, actual, forecast, previous, detail, src }) {
  const ms = new Date(timestamp).getTime();
  const { date, time } = istParts(ms);
  const id = rawId ? String(rawId) : crypto.createHash('md5').update(`${currency}|${timestamp}|${title}`).digest('hex').slice(0, 12);
  const actStr = actual != null && String(actual).trim() !== '' ? String(actual).trim() : null;
  const fcstStr = forecast != null && String(forecast).trim() !== '' ? String(forecast).trim() : null;
  const aNum = parseCalNum(actStr), fNum = parseCalNum(fcstStr);
  let surpriseDir = 0;
  if (!isNaN(aNum) && !isNaN(fNum) && aNum !== fNum) {
    surpriseDir = ((aNum > fNum) !== INV_CAL_RX.test(title)) ? 1 : -1;
  }

  return {
    id,
    date,
    time,
    timestamp,
    currency,
    impact: normalizeImpact(title, impact),
    title,
    actual: actStr,
    forecast: fcstStr,
    previous: previous != null && String(previous).trim() !== '' ? String(previous).trim() : null,
    surpriseDir, // +1 bullish beat, -1 bearish miss, 0 inline/pending
    detail: detail || null,
    actualSource: actStr ? src : null
  };
}

async function tvCalendar(fromIso, toIso) {
  const u = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&countries=US,EU,DE,FR,IT,ES,GB,JP,CH,CA,AU,NZ`;
  const j = JSON.parse(await getText(u, {
    headers: { 'User-Agent': UA, Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/', Accept: 'application/json' }
  }, 2));
  const arr = Array.isArray(j?.result) ? j.result : Array.isArray(j) ? j : [];
  return arr.map(e => {
    const cc = String(e.country || '').toUpperCase();
    const cur = MAJ.includes(e.currency) ? e.currency : TV_CUR[cc];
    if (!cur || !e.date) return null;
    const d = new Date(e.date);
    if (isNaN(d)) return null;
    const title = String(e.title || e.indicator || '').trim();
    if (!title) return null;
    const imp = Number(e.importance) >= 1 ? 'High' : Number(e.importance) === 0 ? 'Medium' : 'Low';
    return buildCalItem({
      rawId: e.id ? `tv_${e.id}` : null,
      title,
      currency: cur,
      impact: imp,
      timestamp: d.toISOString(),
      actual: fmtCalVal(e.actual, e.unit, e.scale),
      forecast: fmtCalVal(e.forecast, e.unit, e.scale),
      previous: fmtCalVal(e.previous, e.unit, e.scale),
      detail: e.comment ? String(e.comment).trim() : null,
      src: 'TradingView'
    });
  }).filter(Boolean);
}

async function fxsCalendar(fromIso, toIso) {
  const f = fromIso.slice(0, 19).replace(/\.\d+$/, '') + 'Z';
  const t = toIso.slice(0, 19).replace(/\.\d+$/, '') + 'Z';
  const urls = [
    `https://calendar-api.fxsstatic.com/en/api/v1/eventDates/${f}/${t}`,
    `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${f}/${t}`
  ];
  let j = null, err = null;
  for (const u of urls) {
    try {
      j = JSON.parse(await getText(u, {
        headers: { 'User-Agent': UA, Origin: 'https://www.fxstreet.com', Referer: 'https://www.fxstreet.com/', Accept: 'application/json' }
      }, 2));
      break;
    } catch (e) { err = e; }
  }
  if (!j) throw err || new Error('FXStreet calendar unavailable');
  const arr = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
  return arr.map(e => {
    const cur = String(e.currencyCode || e.currency || '').toUpperCase();
    if (!MAJ.includes(cur) || !e.dateUtc) return null;
    const d = new Date(e.dateUtc);
    if (isNaN(d)) return null;
    const title = String(e.name || e.title || '').trim();
    if (!title) return null;
    const v = String(e.volatility || '').toUpperCase();
    const imp = v === 'HIGH' ? 'High' : v === 'MEDIUM' ? 'Medium' : 'Low';
    const pot = String(e.potency || '').toUpperCase();
    const scale = (pot === 'ZERO' || pot === 'NONE') ? '' : pot;
    return buildCalItem({
      rawId: e.id ? `fxs_${e.id}` : null,
      title,
      currency: cur,
      impact: imp,
      timestamp: d.toISOString(),
      actual: fmtCalVal(e.actual, e.unit, scale),
      forecast: fmtCalVal(e.consensus ?? e.forecast, e.unit, scale),
      previous: fmtCalVal(e.previous, e.unit, scale),
      detail: e.description ? String(e.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null,
      src: 'FXStreet'
    });
  }).filter(Boolean);
}

function dedupeCal(list) {
  const seen = new Set(), out = [];
  for (const e of list) {
    const k = `${e.currency}|${e.timestamp.slice(0, 16)}|${e.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

async function calendar(range) {
  const calKeys = Object.keys(cache).filter(k => k.startsWith('cal_'));
  if (calKeys.length > 60) {
    calKeys.sort((a, b) => (cache[a]?.t || 0) - (cache[b]?.t || 0)).slice(0, calKeys.length - 40).forEach(k => delete cache[k]);
  }
  const now = Date.now();
  let raw = [], activeSource = 'TradingView';
  let tvErr = null, fxsErr = null;
  try {
    raw = await tvCalendar(range.fetchFromIso, range.fetchToIso);
  } catch (e) { tvErr = e; }
  if (!raw.length) {
    try {
      const fxs = await fxsCalendar(range.fetchFromIso, range.fetchToIso);
      if (fxs.length) { raw = fxs; activeSource = 'FXStreet'; }
    } catch (e) { fxsErr = e; }
  }
  if (!raw.length && tvErr && fxsErr) {
    throw new Error(`Calendar feeds unavailable (TV: ${tvErr.message}; FXStreet: ${fxsErr.message})`);
  }
  const items = dedupeCal(raw)
    .filter(e => {
      const ms = new Date(e.timestamp).getTime();
      return ms >= range.startMs && ms <= range.endMs && MAJ.includes(e.currency);
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const actualsCount = items.filter(e => e.actual != null && e.actual !== '').length;
  return {
    items,
    actualsCount,
    from: range.fromLabel,
    to: range.toLabel,
    provider: activeSource,
    updatedAt: now,
    fetchedAt: new Date(now).toISOString(),
    source: `Dynamic schedule & live actuals powered by ${activeSource} (TradingView primary, FXStreet fallback).`
  };
}

/**
 * Fetches a 35-day backward + 55-day forward macro calendar window used internally to extract:
 * - Latest Manufacturing & Services PMI, Retail Sales, NFP, Wages, GDP surprises
 * - Upcoming Central Bank Rate Decision dates
 * - Priced-In vs. Economic Surprise scores
 */
async function getMacroCalendarWindow(force = false) {
  return cached('cal_macro_window', 900000, async () => {
    const fromD = istParts(Date.now() - 35 * DAY_MS).date;
    const toD = istParts(Date.now() + 55 * DAY_MS).date;
    const range = parseCalRange(fromD, toD);
    return calendar(range);
  }, force).catch(() => ({ items: [], provider: 'Unavailable' }));
}

// ============================================================================
// 9. EXPANDED CFTC COT POSITIONING (52W & 3Y PERCENTILES, NET/OI %) (PRIORITY 2.13)
// ============================================================================

const COT_MK = {
  EUR: '099741', GBP: '096742', JPY: '097741', CHF: '092741',
  CAD: '090741', AUD: '232741', NZD: '112741', USD: '098662'
};

async function cot() {
  const codes = Object.values(COT_MK).map(c => `'${c}'`).join(',');
  // Fetch ~3 years of weekly rows across 8 contracts (8 * 165 = 1320)
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${encodeURIComponent(`cftc_contract_market_code in(${codes})`)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=1400`;
  const rows = JSON.parse(await getText(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 3));
  if (!Array.isArray(rows) || !rows.length) throw new Error('CFTC returned no rows');

  const n = x => (x == null || x === '' ? NaN : +String(x).replace(/,/g, ''));
  const pickF = (r, ...ks) => { for (const f of ks) if (r[f] != null) return n(r[f]); return NaN; };
  const by = {};
  for (const r of rows) {
    const k = Object.keys(COT_MK).find(c => COT_MK[c] === String(r.cftc_contract_market_code).trim());
    if (k) (by[k] ??= []).push(r);
  }

  const getNet = r => pickF(r, 'noncomm_positions_long_all', 'lev_money_positions_long_all', 'lev_money_positions_long') -
    pickF(r, 'noncomm_positions_short_all', 'lev_money_positions_short_all', 'lev_money_positions_short');

  const data = {};
  const fetchedAt = new Date().toISOString();

  for (const cur of Object.keys(COT_MK)) {
    const rs = (by[cur] || []).sort((a, b) => String(b.report_date_as_yyyy_mm_dd).localeCompare(String(a.report_date_as_yyyy_mm_dd)));
    if (!rs.length) {
      data[cur] = makeUnavailableIndicator('CFTC', 'Unavailable (Source Timeout)', 'weekly', 'contracts');
      continue;
    }

    const r = rs[0];
    const pv = rs[1];
    const pv4 = rs[4]; // ~1 month ago for 30D momentum
    const L = pickF(r, 'noncomm_positions_long_all', 'lev_money_positions_long_all', 'lev_money_positions_long');
    const S = pickF(r, 'noncomm_positions_short_all', 'lev_money_positions_short_all', 'lev_money_positions_short');
    const oi = pickF(r, 'open_interest_all');
    if (isNaN(L) || isNaN(S)) {
      data[cur] = makeUnavailableIndicator('CFTC', 'N/A — Pending Release', 'weekly', 'contracts');
      continue;
    }

    const net = L - S;
    let wowChange = pickF(r, 'change_in_noncomm_long_all', 'change_in_lev_money_long_all', 'change_in_lev_money_long') -
      pickF(r, 'change_in_noncomm_short_all', 'change_in_lev_money_short_all', 'change_in_lev_money_short');
    if (isNaN(wowChange) && pv) wowChange = net - getNet(pv);
    const change4w = pv4 && !isNaN(getNet(pv4)) ? net - getNet(pv4) : null;

    const netSeriesAll = rs.map(getNet).filter(v => !isNaN(v));
    const netSeries52w = netSeriesAll.slice(0, 52);
    const netSeries3y = netSeriesAll.slice(0, 156);

    const pct52w = percentileRank(net, netSeries52w);
    const pct3y = percentileRank(net, netSeries3y);
    const netPctOi = oi && !isNaN(oi) ? round2((net / oi) * 100) : null;

    const crowdingState = pct52w == null ? 'Unknown'
      : pct52w >= 85 ? 'Crowded Long'
      : pct52w <= 15 ? 'Crowded Short'
      : 'Neutral';

    const obsDate = String(r.report_date_as_yyyy_mm_dd).slice(0, 10);
    const baseInd = buildIndicator({
      value: net,
      prev: pv ? getNet(pv) : null,
      observationDate: obsDate,
      source: 'CFTC',
      series: `CFTC COT Legacy Futures (${r.market_and_exchange_names || cur})`,
      frequency: 'weekly',
      unit: 'contracts'
    });

    data[cur] = {
      ...baseInd,
      long: L,
      short: S,
      net,
      change: isNaN(wowChange) ? null : wowChange,
      wowNetChange: isNaN(wowChange) ? null : wowChange,
      change4w,
      oi: isNaN(oi) ? null : oi,
      netPctOi,
      percentile52w: pct52w,
      percentile3y: pct3y,
      historyWeeks: netSeriesAll.length,
      crowdingState,
      isCrowdedExtreme: pct52w != null && (pct52w >= 85 || pct52w <= 15),
      market: r.market_and_exchange_names || null
    };
  }

  return {
    data,
    missing: Object.keys(COT_MK).filter(k => data[k]?.value == null),
    fetchedAt,
    freshness: summarizeFreshness(Object.entries(data).map(([k, v]) => [`cot.${k}`, v])),
    source: 'CFTC Commitments of Traders (futures only, 3-year history). Net = non-commercial long − short; Net/OI %; 52W & 3Y percentiles. USD = ICE US Dollar Index.'
  };
}

// ============================================================================
// 10. EXPANDED G8 FUNDAMENTALS & TRANSPARENT 7-FACTOR SCORING (PRIORITY 1.4 & 2)
// ============================================================================

const BIS = { USD: 'US', EUR: 'XM', GBP: 'GB', JPY: 'JP', CHF: 'CH', CAD: 'CA', AUD: 'AU', NZD: 'NZ' };
const CCs = { USD: ['US'], EUR: ['EZ', 'EA19'], GBP: ['GB'], JPY: ['JP'], CHF: ['CH'], CAD: ['CA'], AUD: ['AU'], NZD: ['NZ'] };
const I3 = { USD: 'USA', GBP: 'GBR', JPY: 'JPN', CHF: 'CHE', CAD: 'CAN', AUD: 'AUS', NZD: 'NZL' };
const FQ = { AUD: 'Q', NZD: 'Q' };
const IMFC = { USD: 'USA', EUR: 'EURO', GBP: 'GBR', JPY: 'JPN', CHF: 'CHE', CAD: 'CAN', AUD: 'AUS', NZD: 'NZL' };
const TEN = { USD: 'united states', EUR: 'euro area', GBP: 'united kingdom', JPY: 'japan', CHF: 'switzerland', CAD: 'canada', AUD: 'australia', NZD: 'new zealand' };
const TEC = { rate: /^interest rate$/i, cpi: /^inflation rate$/i, gdp: /^gdp annual growth rate$/i, unemp: /^unemployment rate$/i };

// Official yield series on FRED (10Y sovereign yields & 3M interbank short rates)
const YIELD10_FRED = {
  USD: 'DGS10', EUR: 'IRLTLT01EZM156N', GBP: 'IRLTLT01GBM156N', JPY: 'IRLTLT01JPM156N',
  CHF: 'IRLTLT01CHM156N', CAD: 'IRLTLT01CAM156N', AUD: 'IRLTLT01AUM156N', NZD: 'IRLTLT01NZM156N'
};
const SHORT_RATE_FRED = {
  USD: 'DGS2', EUR: 'IR3TIB01EZM156N', GBP: 'IR3TIB01GBM156N', JPY: 'IR3TIB01JPM156N',
  CHF: 'IR3TIB01CHM156N', CAD: 'IR3TIB01CAM156N', AUD: 'IR3TIB01AUM156N', NZD: 'IR3TIB01NZM156N'
};

// Official data fetchers
const compound4Q = p => {
  if (p.length < 4) throw new Error('<4 quarters');
  return [[p.at(-1)[0], (p.slice(-4).reduce((a, x) => a * (1 + x[1] / 100), 1) - 1) * 100]];
};
async function eurostat(ds, q) {
  const j = JSON.parse(await getText(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${ds}?format=JSON&lang=EN&${q}&lastTimePeriod=18`, {}, 2));
  const ix = j.dimension.time.category.index;
  const o = [];
  for (const t of Object.keys(ix)) {
    const v = j.value[ix[t]];
    if (v != null) o.push([isoDate(t), v]);
  }
  o.sort((a, b) => a[0].localeCompare(b[0]));
  if (!o.length) throw new Error(ds + ' empty');
  return o;
}
async function boc(id) {
  const j = JSON.parse(await getText(`https://www.bankofcanada.ca/valet/observations/${id}/json?start_date=${ago(540).toISOString().slice(0, 10)}`, {}, 2));
  return j.observations.map(o => [o.d, +o[id].v]).filter(p => !isNaN(p[1]));
}
async function boe() {
  const f = ago(320);
  const t = await getText(
    `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${String(f.getDate()).padStart(2, '0')}/${MON[f.getMonth()]}/${f.getFullYear()}&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FXFundamentalsPro/2.0)' } },
    2
  );
  const o = t.trim().split(/\r?\n/).slice(1).map(csvRow)
    .map(p => [new Date(p[0].trim() + ' UTC'), +p[1]])
    .filter(p => !isNaN(p[0]) && !isNaN(p[1]))
    .map(([d, v]) => [d.toISOString().slice(0, 10), v]);
  if (!o.length) throw new Error('BoE empty');
  return o;
}
async function ecbDfr() {
  const t = await getText(`https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=${ago(320).toISOString().slice(0, 10)}`, {}, 2);
  const L = t.trim().split(/\r?\n/), h = L[0].split(','), ti = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
  const o = L.slice(1).map(l => l.split(',')).map(p => [p[ti], +p[vi]]).filter(p => !isNaN(p[1]));
  if (!o.length) throw new Error('ECB DFR empty');
  return o;
}
async function ons(pStr) {
  const j = JSON.parse(await getText(`https://www.ons.gov.uk/${pStr}/data`, {}, 2));
  const o = (j.months || []).map(m => {
    const [y, mo] = m.date.split(' ');
    return [`${y}-${MONI[mo.toUpperCase()]}-01`, +m.value];
  }).filter(p => !isNaN(p[1]));
  if (!o.length) throw new Error('ONS empty');
  return o;
}
async function onsQ(pStr) {
  const j = JSON.parse(await getText(`https://www.ons.gov.uk/${pStr}/data`, {}, 2));
  const o = (j.quarters || []).map(m => {
    const [y, q] = m.date.split(' ');
    return [`${y}-${String(+q.slice(1) * 3 - 2).padStart(2, '0')}-01`, +m.value];
  }).filter(p => !isNaN(p[1]));
  if (!o.length) throw new Error('ONS quarters empty');
  return o;
}
async function bisFetch(freq, n) {
  const a = Object.values(BIS).join('+');
  const urls = [
    `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/${freq}.${a}?lastNObservations=${n}&format=csv`,
    `https://stats.bis.org/api/v1/data/WS_CBPOL/${freq}.${a}?lastNObservations=${n}&format=csv`
  ];
  let err;
  for (const u of urls) {
    for (const ac of ['text/csv', 'application/vnd.sdmx.data+csv;version=1.0.0']) {
      try {
        const L = (await getText(u, { headers: { Accept: ac } }, 1)).trim().split(/\r?\n/);
        const h = csvRow(L[0]).map(x => x.split(':')[0].trim());
        const ai = h.indexOf('REF_AREA'), ti = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
        if (ai < 0 || ti < 0 || vi < 0) throw new Error('unexpected BIS cols');
        const by = {};
        for (const l of L.slice(1)) {
          const p = csvRow(l), v = parseFloat(p[vi]);
          if (!isNaN(v)) (by[p[ai].split(':')[0].trim()] ??= []).push([isoDate(p[ti]), v]);
        }
        if (!Object.keys(by).length) throw new Error('BIS no rows');
        for (const k in by) by[k].sort((x, y) => x[0].localeCompare(y[0]));
        return by;
      } catch (e) { err = e.message; }
    }
  }
  throw new Error(err || 'BIS unavailable');
}
const bis = f => memo('bis_' + f, 18e5, () => bisFetch(f, f === 'D' ? 240 : 12));
async function imf(ind, code) {
  const j = JSON.parse(await getText(`https://www.imf.org/external/datamapper/api/v1/${ind}/${code}`, { headers: { 'User-Agent': UA } }, 2));
  const o = j.values?.[ind]?.[code] || {};
  const y = new Date().getFullYear();
  const ks = Object.keys(o).map(Number).filter(k => k <= y && o[k] != null).sort();
  if (!ks.length) throw new Error('IMF empty');
  return ks.map(k => [`${k}-01-01`, +o[k]]);
}
function rbaDate(x) {
  const m = (x || '').trim().match(/^(\d{1,2})[-\/ ]([A-Za-z]{3}|\d{1,2})[-\/ ](\d{4})$/);
  if (!m) return null;
  const mo = isNaN(m[2]) ? MON.findIndex(n => n.toLowerCase() === m[2].toLowerCase()) + 1 : +m[2];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
async function rbaCsv(tbl, sid, rx) {
  const L = (await memo('rba_' + tbl, 36e5, () => getText(`https://www.rba.gov.au/statistics/tables/csv/${tbl}-data.csv`, { headers: { 'User-Agent': UA } }, 2))).split(/\r?\n/).map(csvRow);
  const si = L.findIndex(r => /^series id$/i.test((r[0] || '').trim()));
  const ti = L.findIndex(r => /^title$/i.test((r[0] || '').trim()));
  if (si < 0) throw new Error(`RBA ${tbl}: Series ID row missing`);
  let col = L[si].findIndex(x => x.trim() === sid);
  if (col < 0 && rx && ti >= 0) col = L[ti].findIndex(x => rx.test(x));
  if (col < 0) throw new Error(`RBA ${tbl}: col ${sid} missing`);
  const o = [];
  for (const r of L.slice(si + 1)) {
    const d = rbaDate(r[0]), v = parseFloat(r[col]);
    if (d && !isNaN(v)) o.push([d, v]);
  }
  if (!o.length) throw new Error(`RBA ${tbl}: no rows`);
  return o;
}
async function statcan(vec, n = 18) {
  const j = JSON.parse(await getText('https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify([{ vectorId: vec, latestN: n }])
  }, 2));
  const p = j?.[0]?.object?.vectorDataPoint;
  if (!p?.length) throw new Error('StatCan empty');
  return p.map(x => [x.refPer, +x.value]).filter(x => !isNaN(x[1]));
}
async function oecdCpi(area, freq) {
  const t = await memo(`oecd_${area}_${freq}`, 216e5, () => getText(
    `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/${area}.${freq}.N.CPI.PA._T.N.GY?startPeriod=${new Date().getFullYear() - 2}&dimensionAtObservation=AllDimensions&format=csvfilewithlabels`,
    { headers: { 'User-Agent': UA } }, 1
  ));
  const L = t.trim().split(/\r?\n/), h = csvRow(L[0]), ti = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
  if (ti < 0 || vi < 0) throw new Error('OECD bad cols');
  const o = L.slice(1).map(csvRow).map(r => [isoDate(r[ti]), parseFloat(r[vi])]).filter(p => !isNaN(p[1]));
  if (!o.length) throw new Error('OECD empty');
  return o;
}
async function te(c, m) {
  const j = await memo('te_' + c, 216e5, async () => JSON.parse(await getText(`https://api.tradingeconomics.com/country/${encodeURIComponent(TEN[c])}?c=guest:guest&f=json`, { headers: { 'User-Agent': UA } }, 1)));
  const r = Array.isArray(j) && j.find(x => TEC[m].test(x.Category || x.Title || ''));
  if (!r || r.LatestValue == null || !r.LatestValueDate) throw new Error('TE unavailable');
  return [[String(r.LatestValueDate).slice(0, 10), +r.LatestValue]];
}

const ptsAgeDays = p => (Date.now() - new Date(p.at(-1)[0]).getTime()) / DAY_MS;

async function pickSeries(chain, diag, label, maxFreshAge) {
  let best = null, imfR = null;
  for (const [src, fn] of chain) {
    try {
      let p = await fn();
      if (!p?.length) { diag.push(`${label} ${src}: empty`); continue; }
      p = [...p].sort((a, b) => a[0].localeCompare(b[0]));
      if (/IMF/.test(src)) { imfR ??= { pts: p, src }; continue; }
      if (ptsAgeDays(p) <= maxFreshAge) return { pts: p, src };
      diag.push(`${label} ${src}: latest ${p.at(-1)[0]} > ${maxFreshAge}d`);
      if (!best || p.at(-1)[0] > best.pts.at(-1)[0]) best = { pts: p, src };
    } catch (e) {
      diag.push(`${label} ${src}: ${e.message}`);
    }
  }
  return best || (imfR && ptsAgeDays(imfR.pts) <= 450 ? imfR : null);
}

const EU = (ds, q) => () => eurostat(ds, q);
const UNQ = g => `geo=${g}&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT`;
const GDQ = g => `geo=${g}&unit=CLV_PCH_SM&s_adj=SCA&na_item=B1GQ`;
const CPQ = (g, coicop = 'CP00') => `geo=${g}&coicop=${coicop}&unit=RCH_A`;
const EAG = ['EA', 'EA20', 'EA21'];

const PRI = {
  rate: {
    USD: [['FRED DFEDTARU', () => fredPts('DFEDTARU', 1)], ['FRED FEDFUNDS', () => fredPts('FEDFUNDS', 1)]],
    EUR: [['ECB deposit facility rate', ecbDfr]],
    GBP: [['BoE Bank Rate', boe]],
    CAD: [['BoC target rate', () => boc('V39079')]],
    AUD: [['RBA cash rate target (F1)', () => rbaCsv('f1', 'FIRMMCRT', /cash rate target/i)]]
  },
  cpi: {
    USD: [['FRED CPIAUCSL (y/y)', async () => calcYoYSeries(await fredPts('CPIAUCSL', 1))]],
    EUR: EAG.map(g => [`Eurostat HICP ${g}`, EU('prc_hicp_manr', CPQ(g))]),
    GBP: [['ONS CPI D7G7', () => ons('economy/inflationandpriceindices/timeseries/d7g7/mm23')], ['Eurostat HICP UK', EU('prc_hicp_manr', CPQ('UK'))]],
    JPY: [['OECD CPI JPN (monthly)', () => oecdCpi('JPN', 'M')]],
    CHF: [['Eurostat HICP CH', EU('prc_hicp_manr', CPQ('CH'))], ['OECD CPI CHE (monthly)', () => oecdCpi('CHE', 'M')]],
    CAD: [['StatCan CPI v41690973 (y/y)', async () => calcYoYSeries(await statcan(41690973, 18))], ['BoC CPI index (y/y)', async () => calcYoYSeries(await boc('V41690973'))]],
    AUD: [['RBA G1 year-ended CPI (quarterly)', () => rbaCsv('g1', 'GCPIAGYP', /all groups.*(year|annual)/i)], ['OECD CPI AUS (quarterly)', () => oecdCpi('AUS', 'Q')]],
    NZD: [['OECD CPI NZL (quarterly)', () => oecdCpi('NZL', 'Q')]]
  },
  coreCpi: {
    USD: [['FRED CPILFESL Core CPI (y/y)', async () => calcYoYSeries(await fredPts('CPILFESL', 1))]],
    EUR: EAG.map(g => [`Eurostat Core HICP ${g}`, EU('prc_hicp_manr', CPQ(g, 'TOT_X_NRG_FOOD'))]),
    GBP: [['ONS Core CPI DKO8', () => ons('economy/inflationandpriceindices/timeseries/dko8/mm23')]],
    AUD: [['RBA G1 Trimmed Mean CPI', () => rbaCsv('g1', 'GCPIAGSAQP', /trimmed mean.*(year|annual)/i)]],
    CAD: [['BoC CPI-Trim V108785715', () => boc('CPI_TRIM')]]
  },
  unemp: {
    USD: [['FRED UNRATE', () => fredPts('UNRATE', 1)], ['Eurostat une_rt_m US', EU('une_rt_m', UNQ('US'))]],
    EUR: EAG.map(g => [`Eurostat une_rt_m ${g}`, EU('une_rt_m', UNQ(g))]),
    GBP: [['ONS MGSX', () => ons('employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms')]],
    JPY: [['Eurostat une_rt_m JP', EU('une_rt_m', UNQ('JP'))]],
    CHF: [['Eurostat une_rt_m CH', EU('une_rt_m', UNQ('CH'))]],
    CAD: [['StatCan LFS v2062815', () => statcan(2062815, 18)]],
    AUD: [['RBA H5 unemployment rate', () => rbaCsv('h5', 'GLFSURSA', /unemployment rate.*season/i)]]
  },
  gdp: {
    USD: [['FRED GDPC1 (y/y)', async () => calcYoYSeries(await fredPts('GDPC1', 1))]],
    EUR: EAG.map(g => [`Eurostat GDP ${g}`, EU('namq_10_gdp', GDQ(g))]),
    GBP: [['ONS ABMI quarterly (y/y)', async () => calcYoYSeries(await onsQ('economy/grossdomesticproductgdp/timeseries/abmi/ukea'))]],
    CHF: [['Eurostat GDP CH', EU('namq_10_gdp', GDQ('CH'))]],
    CAD: [['StatCan real GDP v65201210 (y/y)', async () => calcYoYSeries(await statcan(65201210, 18))]],
    AUD: [['RBA H1 GDP year-ended', () => rbaCsv('h1', 'GGDPECCVPSYP', /(gross domestic product|gdp).*(year|through)/i)]]
  }
};

const TAIL = {
  rate: c => [
    ['BIS daily policy rate', async () => { const s = (await bis('D'))[BIS[c]]; if (!s) throw new Error('missing'); return s; }],
    ['BIS monthly policy rate', async () => { const s = (await bis('M'))[BIS[c]]; if (!s) throw new Error('missing'); return s; }],
    ['TradingEconomics (guest)', () => te(c, 'rate')],
    ...CCs[c].flatMap(k => ['IRSTCB01', 'IRSTCI01', 'IR3TIB01'].map(p => [`OECD ${p} rate proxy`, () => fredPts(`${p}${k}M156N`, 1)]))
  ],
  cpi: c => {
    const f = FQ[c] || 'M';
    return [
      ['TradingEconomics (guest)', () => te(c, 'cpi')],
      ...(I3[c] ? [[`FRED ${I3[c]}CPIALL${f}INMEI (y/y)`, async () => calcYoYSeries(await fredPts(`${I3[c]}CPIALL${f}INMEI`, 1))]] : []),
      ...CCs[c].map(k => [`OECD CPALTT01${k}`, () => fredPts(`CPALTT01${k}${f}659N`, 1)]),
      ['IMF WEO annual estimate', () => imf('PCPIPCH', IMFC[c])]
    ];
  },
  coreCpi: c => [
    ...CCs[c].map(k => [`OECD Core CPI ${k}`, () => fredPts(`CPGRLE01${k}M659N`, 1)])
  ],
  unemp: c => [
    ['TradingEconomics (guest)', () => te(c, 'unemp')],
    ...CCs[c].flatMap(k => ['M', 'Q'].flatMap(f => [['LRHUTTTT', '156S'], ['LRUNTTTT', '156S']].map(([p, x]) => [`OECD ${p}${k}${f}`, () => fredPts(`${p}${k}${f}${x}`, 1)]))),
    ['IMF WEO annual estimate', () => imf('LUR', IMFC[c])]
  ],
  gdp: c => [
    ['TradingEconomics (guest)', () => te(c, 'gdp')],
    ...CCs[c].flatMap(k => [
      [`OECD NAEXKP01${k} y/y`, () => fredPts(`NAEXKP01${k}Q659S`, 1)],
      [`OECD NAEXKP01${k} 4q compounded`, async () => compound4Q(await fredPts(`NAEXKP01${k}Q657S`, 1))]
    ]),
    ['IMF WEO annual estimate', () => imf('NGDP_RPCH', IMFC[c])]
  ]
};

const isQtrMetric = (m, c) => m === 'gdp' || ((m === 'cpi' || m === 'coreCpi') && FQ[c]) || (m === 'unemp' && c === 'NZD');

/**
 * Extracts latest actuals (PMI, Retail Sales, NFP, Wages, Industrial Production, Next CB Meeting)
 * from the dynamic TradingView/FXStreet calendar window to enrich G8 fundamentals.
 */
function extractCalendarMacroSignals(calItems = []) {
  const now = Date.now();
  const past = calItems.filter(e => new Date(e.timestamp).getTime() <= now && e.actual != null);
  const future = calItems.filter(e => new Date(e.timestamp).getTime() > now);
  const byCur = {};

  for (const c of CUR) {
    const cPast = past.filter(e => e.currency === c).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const cFut = future.filter(e => e.currency === c).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const findLatest = (rx, unit = '') => {
      const hit = cPast.find(e => rx.test(e.title));
      if (!hit) return makeUnavailableIndicator('TradingView', 'N/A — Pending Release', 'monthly', unit);
      const val = parseCalNum(hit.actual);
      const fcst = parseCalNum(hit.forecast);
      const prev = parseCalNum(hit.previous);
      return buildIndicator({
        value: isNaN(val) ? null : val,
        prev: isNaN(prev) ? null : prev,
        observationDate: hit.date,
        publishedAt: hit.timestamp,
        source: hit.actualSource || 'TradingView',
        series: hit.title,
        frequency: 'monthly',
        unit,
        extra: {
          rawActual: hit.actual,
          forecast: hit.forecast,
          surprise: !isNaN(val) && !isNaN(fcst) ? round2(val - fcst) : null,
          surpriseDir: hit.surpriseDir
        }
      });
    };

    const nextCb = cFut.find(e => /interest rate decision|rate decision|fomc|ecb press|bank rate|cash rate|policy rate|official cash rate|monetary policy/i.test(e.title));

    byCur[c] = {
      manufacturingPmi: findLatest(/\b(ism manufacturing pmi|manufacturing pmi|flash manufacturing pmi)\b/i, 'idx'),
      servicesPmi: findLatest(/\b(ism services pmi|ism non-manufacturing|services pmi|flash services pmi)\b/i, 'idx'),
      retailSales: findLatest(/\bretail sales\b/i, '%'),
      industrialProd: findLatest(/\bindustrial production\b/i, '%'),
      employmentChange: findLatest(/\b(non-?farm|payrolls|employment change)\b/i, 'k'),
      wageGrowth: findLatest(/\b(average hourly earnings|average weekly earnings|wage|earnings)\b/i, '%'),
      gdpCalendar: findLatest(/\bgdp\b/i, '%'),
      nextMeeting: nextCb ? {
        date: nextCb.date,
        timeIst: nextCb.time,
        timestamp: nextCb.timestamp,
        title: nextCb.title,
        daysAway: Math.max(0, Math.ceil((new Date(nextCb.timestamp).getTime() - now) / DAY_MS)),
        source: 'TradingView/FXStreet Calendar'
      } : null
    };
  }
  return byCur;
}

/**
 * Priority 1.4: Transparent 7-Factor Macro Scoring Breakdown
 * Weights sum strictly to 1.00 (100%):
 *   rateDiff: 0.20, realYield: 0.20, inflationTrend: 0.12,
 *   growthMomentum: 0.14, laborHealth: 0.12, centralBankStance: 0.14, cotPositioning: 0.08
 */
const MACRO_WEIGHTS = {
  rateDiff: 0.20,
  realYield: 0.20,
  inflationTrend: 0.12,
  growthMomentum: 0.14,
  laborHealth: 0.12,
  centralBankStance: 0.14,
  cotPositioning: 0.08
};

function computeMacroScores(fundData, cotData) {
  const rateRaw = {}, realYieldRaw = {}, inflRaw = {}, growthRaw = {}, laborRaw = {}, cbRaw = {}, cotRaw = {};

  for (const c of CUR) {
    const d = fundData[c] || {};
    rateRaw[c] = d.rate?.value ?? null;
    realYieldRaw[c] = d.realYield10y?.value ?? d.realPolicyRate?.value ?? null;

    // Inflation factor: moderate above-target inflation (2.2–3.5%) + accelerating trend = hawkish currency support;
    // cooling below 2% = dovish. Very high (>5%) dampened for macro instability.
    const cpiV = d.coreCpi?.value ?? d.cpi?.value;
    const inflBonus = d.inflationSuite?.direction === 'Accelerating' ? 0.35 : d.inflationSuite?.direction === 'Cooling' ? -0.35 : 0;
    inflRaw[c] = cpiV != null ? (cpiV > 5 ? 5 - (cpiV - 5) * 0.5 : cpiV) + inflBonus : null;

    // Growth momentum: blend GDP y/y + PMI deviation from 50
    const gdpV = d.gdp?.value;
    const mPmi = d.growthSuite?.manufacturingPmi?.value;
    const sPmi = d.growthSuite?.servicesPmi?.value;
    const pmiAvg = (mPmi != null && sPmi != null) ? (mPmi + sPmi) / 2 : (mPmi ?? sPmi ?? null);
    growthRaw[c] = gdpV != null ? gdpV + (pmiAvg != null ? (pmiAvg - 50) * 0.15 : 0) : (pmiAvg != null ? (pmiAvg - 50) * 0.2 : null);

    // Labor health: lower unemployment + tightening 3M trend = healthier
    const unempV = d.unemp?.value;
    const uTrendBonus = d.employmentSuite?.unempTrend3m === 'Tightening' ? -0.3 : d.employmentSuite?.unempTrend3m === 'Loosening' ? 0.3 : 0;
    laborRaw[c] = unempV != null ? unempV + uTrendBonus : null;

    // Central bank stance (-2..+2) adjusted by implied next-meeting bps
    const stV = d.stance?.value ?? 0;
    const bpsV = d.centralBank?.impliedNextMeetingBps ?? 0;
    cbRaw[c] = clamp(stV + (bpsV / 50), -2, 2);

    // COT positioning: Net / OI % dampened when crowded (>85th / <15th pct)
    const cotC = cotData?.[c];
    if (cotC?.netPctOi != null) {
      const dampen = cotC.isCrowdedExtreme ? 0.4 : 1.0;
      cotRaw[c] = clamp((cotC.netPctOi / 20) * dampen, -2, 2);
    } else {
      cotRaw[c] = null;
    }
  }

  const zRate = zScoreMap(rateRaw, false);
  const zReal = zScoreMap(realYieldRaw, false);
  const zInfl = zScoreMap(inflRaw, false);
  const zGrowth = zScoreMap(growthRaw, false);
  const zLabor = zScoreMap(laborRaw, true); // Lower unemployment = higher score

  const scores = {};
  for (const c of CUR) {
    const d = fundData[c] || {};
    const cotC = cotData?.[c];

    const makeFactor = (key, rawVal, unit, zVal, rationale, metaInd) => {
      const w = MACRO_WEIGHTS[key];
      const contrib = zVal != null ? Number((zVal * w * 5).toFixed(3)) : 0;
      return {
        key,
        rawValue: rawVal != null ? round2(rawVal) : null,
        unit,
        normalizedScore: zVal != null ? round2(zVal) : null,
        weight: w,
        weightPct: Math.round(w * 100),
        contribution: contrib,
        available: zVal != null,
        rationale,
        source: metaInd?.source || 'Derived',
        observationDate: metaInd?.observationDate || null,
        stale: !!metaInd?.stale
      };
    };

    const contributions = {
      rateDiff: makeFactor(
        'rateDiff',
        d.rate?.value,
        '%',
        zRate[c],
        `Policy rate ${d.rate?.value != null ? d.rate.value + '%' : 'N/A'} relative to G8 mean; 2Y/10Y curve ${d.yieldCurve?.spread != null ? d.yieldCurve.spread + 'pp' : 'N/A'}.`,
        d.rate
      ),
      realYield: makeFactor(
        'realYield',
        realYieldRaw[c],
        '%',
        zReal[c],
        `Real yield (${d.realYield10y?.value != null ? '10Y Nominal − CPI = ' + d.realYield10y.value + '%' : 'Policy − CPI'}) drives carry attraction.`,
        d.realYield10y || d.realPolicyRate
      ),
      inflationTrend: makeFactor(
        'inflationTrend',
        d.coreCpi?.value ?? d.cpi?.value,
        '%',
        zInfl[c],
        `Inflation ${d.inflationSuite?.direction || 'Sticky'} (CPI ${d.cpi?.value ?? 'N/A'}%, 3M trend ${d.inflationSuite?.trend3mAnnualized ?? 'N/A'}%).`,
        d.coreCpi || d.cpi
      ),
      growthMomentum: makeFactor(
        'growthMomentum',
        d.gdp?.value,
        '%',
        zGrowth[c],
        `GDP y/y ${d.gdp?.value ?? 'N/A'}% with PMI/activity momentum composite.`,
        d.gdp
      ),
      laborHealth: makeFactor(
        'laborHealth',
        d.unemp?.value,
        '%',
        zLabor[c],
        `Unemployment ${d.unemp?.value ?? 'N/A'}% (3M trend: ${d.employmentSuite?.unempTrend3m || 'Stable'}).`,
        d.unemp
      ),
      centralBankStance: makeFactor(
        'centralBankStance',
        cbRaw[c],
        'pts',
        cbRaw[c],
        `Guidance: ${d.centralBank?.guidance || 'Data-Dependent'} (${d.centralBank?.impliedNextMeetingBps ?? 0} bps priced next meeting).`,
        d.rate
      ),
      cotPositioning: makeFactor(
        'cotPositioning',
        cotC?.netPctOi ?? null,
        '% OI',
        cotRaw[c],
        cotC?.netPctOi != null
          ? `Non-comm net ${cotC.netPctOi}% of OI (${cotC.percentile52w ?? 'N/A'}th 52W pct — ${cotC.crowdingState}).`
          : 'CFTC COT positioning unavailable.',
        cotC
      )
    };

    const factorList = Object.values(contributions);
    const totalScore = Number(sum(factorList.map(f => f.contribution)).toFixed(2));
    const availableCount = factorList.filter(f => f.available).length;

    scores[c] = {
      currency: c,
      totalScore,
      weights: { ...MACRO_WEIGHTS },
      contributions,
      inputsAvailable: availableCount,
      totalInputs: 7,
      dataCompletenessPct: Math.round((availableCount / 7) * 100),
      formula: 'TotalScore = Σ (NormalizedFactor_i × Weight_i × 5), where each factor is bounded in [-2, +2] using G8 cross-sectional z-scores and policy/COT calibration.'
    };
  }

  return scores;
}

async function fundamentals(force = false) {
  const diag = [];
  const prevData = cache.f?.v?.data || null;
  const now = Date.now();

  // Fetch unified gold, macro calendar window, dashboard (for US PCE/TIPS/BLS), and COT in parallel
  const [{ publicGold }, calWin, cotRes] = await Promise.all([
    getUnifiedGold(force),
    getMacroCalendarWindow(false),
    cached('cot', 432e5, cot).catch(() => null)
  ]);

  const calSignals = extractCalendarMacroSignals(calWin?.items || []);

  const rows = await Promise.all(CUR.map(async c => {
    const coreMetrics = ['rate', 'cpi', 'gdp', 'unemp', 'coreCpi'];
    const [rRate, rCpi, rGdp, rUnemp, rCoreCpi, rY10, rShort] = await Promise.all([
      pickSeries([...(PRI.rate[c] || []), ...TAIL.rate(c)], diag, `${c} rate`, 45),
      pickSeries([...(PRI.cpi[c] || []), ...TAIL.cpi(c)], diag, `${c} cpi`, isQtrMetric('cpi', c) ? 105 : 45),
      pickSeries([...(PRI.gdp[c] || []), ...TAIL.gdp(c)], diag, `${c} gdp`, 105),
      pickSeries([...(PRI.unemp[c] || []), ...TAIL.unemp(c)], diag, `${c} unemp`, isQtrMetric('unemp', c) ? 105 : 45),
      pickSeries([...(PRI.coreCpi[c] || []), ...TAIL.coreCpi(c)], diag, `${c} coreCpi`, isQtrMetric('coreCpi', c) ? 105 : 45),
      fredPts(YIELD10_FRED[c], 1).then(pts => ({ pts, src: `FRED ${YIELD10_FRED[c]}` })).catch(() => null),
      fredPts(SHORT_RATE_FRED[c], 1).then(pts => ({ pts, src: `FRED ${SHORT_RATE_FRED[c]}` })).catch(() => null)
    ]);

    const wrap = (m, r, freqOverride = null) => {
      const freq = freqOverride || (m === 'rate' ? 'policy' : isQtrMetric(m, c) ? 'quarterly' : 'monthly');
      if (!r || !r.pts?.length) {
        return makeUnavailableIndicator('Official Feed', 'Unavailable (Source Timeout)', freq, '%');
      }
      const [d, v] = r.pts.at(-1);
      const prevPt = r.pts.at(-2);
      const prev3Pt = r.pts.at(-4);
      const ind = buildIndicator({
        value: v,
        prev: prevPt ? prevPt[1] : null,
        observationDate: d,
        source: r.src,
        series: r.src,
        frequency: freq,
        unit: '%',
        extra: {
          delta1: prevPt ? round2(v - prevPt[1]) : null,
          delta3m: prev3Pt ? round2(v - prev3Pt[1]) : null
        }
      });
      const oldSaved = prevData?.[c]?.[m];
      if (oldSaved && oldSaved.value != null) {
        const changed = oldSaved.observationDate !== ind.observationDate || oldSaved.value !== ind.value;
        ind.since = changed ? now : oldSaved.since;
        ind.isNew = !!ind.since && (now - ind.since) < 48 * 36e5;
      }
      return ind;
    };

    const rate = wrap('rate', rRate, 'policy');
    const cpi = wrap('cpi', rCpi);
    const coreCpi = wrap('coreCpi', rCoreCpi);
    const gdp = wrap('gdp', rGdp, 'quarterly');
    const unemp = wrap('unemp', rUnemp);
    const yield10y = wrap('yield10y', rY10, c === 'USD' ? 'daily' : 'monthly');
    const yieldShort = wrap('yieldShort', rShort, c === 'USD' ? 'daily' : 'monthly');

    // Stance derived from 6M rate trajectory
    let stanceVal = 0;
    let stanceBasis = 'No recent policy-rate history available';
    if (rRate?.pts?.length) {
      const last = rRate.pts.at(-1);
      const cutMs = new Date(last[0]).getTime() - 190 * DAY_MS;
      const old = rRate.pts.find(p => new Date(p[0]).getTime() >= cutMs) || rRate.pts[0];
      const delta = last[1] - old[1];
      stanceVal = delta >= 0.5 ? 2 : delta > 0.05 ? 1 : delta <= -0.5 ? -2 : delta < -0.05 ? -1 : 0;
      stanceBasis = `Policy-rate change ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp since ${old[0]}`;
    }

    // Priority 2.7: Market-implied future rate expectations & next-meeting priced bps
    const shortSpread = (yieldShort.value != null && rate.value != null) ? (yieldShort.value - rate.value) : null;
    const implied12mBps = shortSpread != null ? Math.round(shortSpread * 100) : Math.round(stanceVal * 25);
    const impliedNextMeetingBps = Math.round(clamp(implied12mBps * 0.35, -50, 50));
    const hikeProb = impliedNextMeetingBps > 5 ? clamp(Math.round((impliedNextMeetingBps / 25) * 100), 10, 95) : 5;
    const cutProb = impliedNextMeetingBps < -5 ? clamp(Math.round((Math.abs(impliedNextMeetingBps) / 25) * 100), 10, 95) : 5;
    const holdProb = Math.max(0, 100 - hikeProb - cutProb);

    const yieldCurveSpread = (yield10y.value != null && yieldShort.value != null)
      ? round2(yield10y.value - yieldShort.value)
      : null;

    // Priority 2.8: Real Yields (Nominal 10Y − CPI, and Policy − CPI)
    const realYield10y = (yield10y.value != null && cpi.value != null)
      ? buildIndicator({
          value: yield10y.value - cpi.value,
          observationDate: yield10y.date,
          source: 'Derived',
          series: `${c} 10Y Yield − Latest CPI`,
          frequency: yield10y.frequency,
          unit: '%'
        })
      : makeUnavailableIndicator('Derived', 'N/A — Pending Release', 'monthly', '%');

    const realPolicyRate = (rate.value != null && cpi.value != null)
      ? buildIndicator({
          value: rate.value - cpi.value,
          observationDate: cpi.date,
          source: 'Derived',
          series: `${c} Policy Rate − Latest CPI`,
          frequency: cpi.frequency,
          unit: '%'
        })
      : makeUnavailableIndicator('Derived', 'N/A — Pending Release', 'monthly', '%');

    // Priority 2.9: Inflation Suite (Headline, Core, 3M Annualized Trend, Direction)
    const cpiDelta3m = cpi.delta3m;
    const trend3mAnnualized = cpi.value != null && cpiDelta3m != null
      ? round2(cpi.value + cpiDelta3m * 1.2)
      : cpi.value;
    const inflDir = cpiDelta3m == null
      ? (cpi.value != null && cpi.value > 2.8 ? 'Sticky' : 'Stable')
      : cpiDelta3m >= 0.25 ? 'Accelerating'
      : cpiDelta3m <= -0.25 ? 'Cooling'
      : 'Sticky';

    // Priority 2.10 & 2.11: Growth & Employment Suites (combining official feeds + calendar actuals)
    const cs = calSignals[c] || {};
    const unempDelta3m = unemp.delta3m;
    const unempTrend3m = unempDelta3m == null ? 'Stable'
      : unempDelta3m <= -0.15 ? 'Tightening'
      : unempDelta3m >= 0.15 ? 'Loosening'
      : 'Stable';

    // Priority 2.12: Central Bank Forward Guidance
    const recentCbNews = news.filter(n => n.cur?.includes(c) && (n.category === 'Central Banks' || n.driver === 'Rate decision') && (now - new Date(n.time).getTime() < 7 * DAY_MS));
    const newsScoreAvg = recentCbNews.length ? mean(recentCbNews.map(n => n.sentimentScore || 0)) : 0;
    const combinedGuidanceScore = stanceVal + (impliedNextMeetingBps / 25) + newsScoreAvg * 0.5;
    const guidance = combinedGuidanceScore >= 0.75 ? 'Hawkish' : combinedGuidanceScore <= -0.75 ? 'Dovish' : 'Data-Dependent';

    const entry = {
      rate,
      cpi,
      coreCpi,
      gdp,
      unemp,
      yield10y,
      yieldShort,
      realYield10y,
      realPolicyRate,
      stance: { value: stanceVal, label: guidance, basis: stanceBasis },
      yieldCurve: {
        shortRate: yieldShort.value,
        tenYear: yield10y.value,
        spread: yieldCurveSpread,
        inverted: yieldCurveSpread != null ? yieldCurveSpread < 0 : null,
        source: yield10y.source
      },
      inflationSuite: {
        headlineCpi: cpi,
        coreCpi,
        pce: c === 'USD' ? (cache.d?.v?.fred?.pceCore || makeUnavailableIndicator('FRED', 'N/A — Pending Release', 'monthly', '%')) : null,
        trend3mAnnualized,
        delta3m: cpiDelta3m,
        direction: inflDir
      },
      growthSuite: {
        gdp,
        gdpTrend: gdp.delta1 == null ? 'Stable' : gdp.delta1 > 0.15 ? 'Accelerating' : gdp.delta1 < -0.15 ? 'Slowing' : 'Stable',
        gdpSurprise: cs.gdpCalendar?.surprise ?? null,
        manufacturingPmi: cs.manufacturingPmi,
        servicesPmi: cs.servicesPmi,
        retailSales: cs.retailSales,
        industrialProd: cs.industrialProd
      },
      employmentSuite: {
        unemployment: unemp,
        unempDelta3m,
        unempTrend3m,
        employmentChange: cs.employmentChange,
        wageGrowth: cs.wageGrowth,
        participation: c === 'USD' ? (cache.d?.v?.bls?.participation || makeUnavailableIndicator('BLS', 'N/A — Pending Release', 'monthly', '%')) : makeUnavailableIndicator('National Stats', 'N/A — Pending Release', 'quarterly', '%')
      },
      centralBank: {
        guidance,
        stanceScore: stanceVal,
        nextMeeting: cs.nextMeeting,
        implied12mBps,
        impliedNextMeetingBps,
        probabilities: { hikePct: hikeProb, holdPct: holdProb, cutPct: cutProb },
        basis: `${stanceBasis}; short-end rate spread implies ${impliedNextMeetingBps >= 0 ? '+' : ''}${impliedNextMeetingBps} bps.`
      }
    };

    return [c, entry];
  }));

  const data = Object.fromEntries(rows);
  const scores = computeMacroScores(data, cotRes?.data || null);

  // Real-yield differential matrix vs USD and across G8
  const realYieldDiffVsUsd = {};
  const usReal = data.USD?.realYield10y?.value;
  CUR.forEach(c => {
    const v = data[c]?.realYield10y?.value;
    realYieldDiffVsUsd[c] = (v != null && usReal != null) ? round2(v - usReal) : null;
  });

  // Collect all core indicators for global freshness audit
  const freshnessList = [];
  for (const c of CUR) {
    ['rate', 'cpi', 'coreCpi', 'gdp', 'unemp', 'yield10y'].forEach(m => {
      freshnessList.push([`${c}.${m}`, data[c][m]]);
    });
  }

  return {
    data,
    scores,
    scoreWeights: MACRO_WEIGHTS,
    realYieldDiffVsUsd,
    gold: publicGold,
    freshness: summarizeFreshness(freshnessList),
    updatedAt: now,
    fetchedAt: new Date(now).toISOString(),
    missing: freshnessList.filter(([, v]) => v?.value == null).map(([k]) => k),
    errors: { detail: [...new Set(diag)].slice(0, 40) },
    sources: 'Official feeds first (FRED, BLS, ECB, BoE, ONS, BoC, StatCan, RBA, Eurostat), enriched with BIS/OECD, CFTC COT, and TradingView/FXStreet actuals.'
  };
}

// ============================================================================
// 11. SWING-TRADING INTELLIGENCE & NUANCED SIGNAL ENGINE (PRIORITY 1.6 & 4)
// ============================================================================

// Maintain in-memory 30D macro score history snapshots for Macro Momentum tracking
const scoreHistorySnapshots = [];

function recordScoreSnapshot(scores) {
  const day = new Date().toISOString().slice(0, 10);
  const existing = scoreHistorySnapshots.find(s => s.day === day);
  const snap = {};
  CUR.forEach(c => { snap[c] = scores[c]?.totalScore ?? 0; });
  if (existing) existing.scores = snap;
  else {
    scoreHistorySnapshots.push({ day, ts: Date.now(), scores: snap });
    if (scoreHistorySnapshots.length > 90) scoreHistorySnapshots.shift();
  }
}

/**
 * Priority 1.6: Nuanced 5-Tier Calibrated Trade Signal Engine
 * Outputs STRONG LONG | LONG | NEUTRAL / NO TRADE | SHORT | STRONG SHORT
 * Forces NEUTRAL / NO TRADE on weak spread (< 1.5) or severe macro/momentum/COT conflicts.
 */
function buildPairSignal(b, q, { hist, fund, cotData, calItems }) {
  const scB = fund.scores[b];
  const scQ = fund.scores[q];
  const spread = round2((scB?.totalScore ?? 0) - (scQ?.totalScore ?? 0));
  const dir = Math.sign(spread);

  const pxArr = hist.rates;
  const t = hist.dates.length - 1;
  const spot = pxArr[q][t] / pxArr[b][t];
  const p1d = pxArr[q][t - 1] / pxArr[b][t - 1];
  const p5d = pxArr[q][Math.max(0, t - 5)] / pxArr[b][Math.max(0, t - 5)];
  const p21d = pxArr[q][Math.max(0, t - 21)] / pxArr[b][Math.max(0, t - 21)];

  const momSpread = round2((hist.strength[21][b] ?? 0) - (hist.strength[21][q] ?? 0));
  const realDiff = (fund.data[b]?.realYield10y?.value != null && fund.data[q]?.realYield10y?.value != null)
    ? round2(fund.data[b].realYield10y.value - fund.data[q].realYield10y.value)
    : null;
  const rateDiff = (fund.data[b]?.rate?.value != null && fund.data[q]?.rate?.value != null)
    ? round2(fund.data[b].rate.value - fund.data[q].rate.value)
    : null;

  const cotB = cotData?.[b];
  const cotQ = cotData?.[q];
  const cotSpread = (cotB?.netPctOi != null && cotQ?.netPctOi != null) ? round2(cotB.netPctOi - cotQ.netPctOi) : null;

  // Crowded COT check (prevents chasing overcrowded positioning in the trade direction)
  const crowdedAgainstEntry = (dir > 0 && (cotB?.percentile52w >= 85 || cotQ?.percentile52w <= 15)) ||
    (dir < 0 && (cotB?.percentile52w <= 15 || cotQ?.percentile52w >= 85));

  const conflicts = [];
  const momConflict = dir !== 0 && Math.abs(momSpread) >= 0.75 && Math.sign(momSpread) !== dir;
  const cotConflict = dir !== 0 && cotSpread != null && Math.abs(cotSpread) >= 12 && Math.sign(cotSpread) !== dir;
  const realYieldConflict = dir !== 0 && realDiff != null && Math.abs(realDiff) >= 0.6 && Math.sign(realDiff) !== dir;

  if (momConflict) {
    conflicts.push(`1M price momentum (${momSpread >= 0 ? '+' : ''}${momSpread}%) opposes macro bias.`);
  }
  if (cotConflict) {
    conflicts.push(`Institutional CFTC COT spread (${cotSpread >= 0 ? '+' : ''}${cotSpread}% OI) diverges from macro bias.`);
  }
  if (crowdedAgainstEntry) {
    conflicts.push(`Crowded CFTC positioning extreme (>85th/<15th 52W pct) increases squeeze/mean-reversion risk.`);
  }
  if (realYieldConflict) {
    conflicts.push(`Real yield differential (${realDiff >= 0 ? '+' : ''}${realDiff}%) runs counter to headline score.`);
  }

  const completeness = Math.min(scB?.dataCompletenessPct ?? 0, scQ?.dataCompletenessPct ?? 0);
  if (completeness < 65) {
    conflicts.push(`Low macro data completeness (${completeness}%) — signal reliability reduced.`);
  }

  // Calibrated Confidence % (0–95)
  let conf = 42;
  conf += clamp(Math.abs(spread) * 14, 0, 34);
  if (!momConflict && Math.abs(momSpread) > 0.5 && Math.sign(momSpread) === dir) conf += 10;
  if (!cotConflict && cotSpread != null && Math.sign(cotSpread) === dir) conf += 7;
  if (realDiff != null && Math.sign(realDiff) === dir) conf += 6;
  conf -= conflicts.length * 14;
  if (completeness < 75) conf -= 10;
  const confidencePct = Math.round(clamp(conf, 15, 95));

  // Rigid Neutral / No Trade Guardrails (Priority 1.6)
  let signal = 'NEUTRAL / NO TRADE';
  let neutralReason = null;

  if (Math.abs(spread) < 1.5) {
    signal = 'NEUTRAL / NO TRADE';
    neutralReason = `Weak fundamental spread (${spread >= 0 ? '+' : ''}${spread}, threshold ±1.50).`;
  } else if (momConflict && cotConflict) {
    signal = 'NEUTRAL / NO TRADE';
    neutralReason = 'Macro bias conflicts with both 1M momentum and CFTC positioning.';
  } else if (momConflict && Math.abs(spread) < 2.2) {
    signal = 'NEUTRAL / NO TRADE';
    neutralReason = 'Moderate macro spread contradicted by opposing 1M FX momentum.';
  } else if (spread >= 2.6 && confidencePct >= 72 && conflicts.length === 0) {
    signal = 'STRONG LONG';
  } else if (spread >= 1.5) {
    signal = 'LONG';
  } else if (spread <= -2.6 && confidencePct >= 72 && conflicts.length === 0) {
    signal = 'STRONG SHORT';
  } else if (spread <= -1.5) {
    signal = 'SHORT';
  }

  // Multi-Timeframe Fundamental Outlook (Priority 4.7)
  const stScore = round2((momSpread * 0.6) + ((realDiff ?? 0) * 0.2));
  const mtScore = round2(((rateDiff ?? 0) * 0.5) + ((scB?.contributions?.centralBankStance?.contribution ?? 0) - (scQ?.contributions?.centralBankStance?.contribution ?? 0)) + ((cotSpread ?? 0) * 0.03));
  const ltScore = round2(((realDiff ?? 0) * 0.7) + ((fund.data[b]?.gdp?.value ?? 0) - (fund.data[q]?.gdp?.value ?? 0)) * 0.4);
  const labelBias = v => (v > 0.45 ? 'Bullish' : v < -0.45 ? 'Bearish' : 'Neutral');

  // Composite divergence score for Priority 4.2 Divergence Scanner
  const divergenceScore = round2(
    Math.abs(spread) * 0.55 +
    Math.abs(realDiff ?? 0) * 0.25 +
    Math.abs(momSpread) * 0.20 -
    (crowdedAgainstEntry ? 1.2 : 0)
  );

  // Upcoming high-impact catalysts in next 7 days
  const now = Date.now();
  const catalysts = (calItems || [])
    .filter(e => e.impact === 'High' && (e.currency === b || e.currency === q) && new Date(e.timestamp).getTime() > now && new Date(e.timestamp).getTime() < now + 7 * DAY_MS)
    .slice(0, 4)
    .map(e => ({ currency: e.currency, title: e.title, date: e.date, timeIst: e.time }));

  return {
    pair: `${b}/${q}`,
    name: `${b}${q}`,
    base: b,
    quote: q,
    spot: round4(spot),
    d1: round4(spot / p1d - 1),
    w1: round4(spot / p5d - 1),
    m1: round4(spot / p21d - 1),
    spread,
    rateDiff,
    realYieldDiff: realDiff,
    momentumSpread1M: momSpread,
    cotSpreadOiPct: cotSpread,
    crowdedCotExtreme: crowdedAgainstEntry,
    divergenceScore,
    signal,
    neutralReason,
    confidencePct,
    hasConflict: conflicts.length > 0,
    conflicts,
    conflictWarning: conflicts.length ? conflicts.join(' ') : null,
    dataCompletenessPct: completeness,
    multiTimeframe: {
      shortTerm: { horizon: '1–2W (Surprises + Momentum)', bias: labelBias(stScore), score: stScore },
      mediumTerm: { horizon: '1–3M (Rate Path + Positioning)', bias: labelBias(mtScore), score: mtScore },
      longTerm: { horizon: '3–12M (Real Yields + Growth)', bias: labelBias(ltScore), score: ltScore }
    },
    upcomingCatalysts: catalysts,
    lastCalculated: new Date().toISOString()
  };
}

/**
 * Priority 4.1: Global Macro Regime Detection
 */
function detectMacroRegime({ fund, assets, hist, dash }) {
  const gdps = CUR.map(c => fund.data[c]?.gdp?.value).filter(v => v != null);
  const cpis = CUR.map(c => fund.data[c]?.cpi?.value).filter(v => v != null);
  const accelCount = CUR.filter(c => fund.data[c]?.inflationSuite?.direction === 'Accelerating').length;
  const coolCount = CUR.filter(c => fund.data[c]?.inflationSuite?.direction === 'Cooling').length;

  const avgGdp = gdps.length ? round2(mean(gdps)) : null;
  const avgCpi = cpis.length ? round2(mean(cpis)) : null;
  const vix = assets?.crossAssetDrivers?.riskSentiment?.vix?.price ?? null;
  const spxM1 = assets?.crossAssetDrivers?.riskSentiment?.spx?.m1 != null ? round2(assets.crossAssetDrivers.riskSentiment.spx.m1 * 100) : null;
  const haven1M = round2(((hist.strength[21].CHF ?? 0) + (hist.strength[21].JPY ?? 0)) / 2);
  const riskFx1M = round2(((hist.strength[21].AUD ?? 0) + (hist.strength[21].NZD ?? 0)) / 2);
  const goldM1 = assets?.gold?.m1 != null ? round2(assets.gold.m1 * 100) : null;

  const criteria = [];
  let regime = 'Disinflationary Soft Landing';
  let confidencePct = 65;
  let playbook = 'Favor high-carry quality currencies & risk-on equities; sell low-yield funding currencies on dips.';

  if ((vix != null && vix >= 24) || (spxM1 != null && spxM1 <= -4.5 && haven1M > 0.8)) {
    regime = 'Risk-Off';
    confidencePct = 84;
    criteria.push(`Elevated VIX (${vix ?? 'N/A'}) and defensive CHF/JPY safe-haven bid (${haven1M >= 0 ? '+' : ''}${haven1M}% 1M).`);
    playbook = 'Long CHF, JPY, USD, and Gold; reduce high-beta AUD/NZD and cyclical equity exposure.';
  } else if (avgGdp != null && avgGdp < 0.7 && avgCpi != null && avgCpi >= 3.0) {
    regime = 'Stagflation';
    confidencePct = 80;
    criteria.push(`Sluggish G8 GDP avg (${avgGdp}%) paired with elevated inflation (${avgCpi}%).`);
    playbook = 'Favor Gold (XAU/USD), energy-linked CAD, and defensive CHF; avoid rate-sensitive equities.';
  } else if (avgGdp != null && avgGdp < 0.6 && (avgCpi == null || avgCpi < 2.8)) {
    regime = 'Recessionary';
    confidencePct = 78;
    criteria.push(`Sub-trend G8 growth (${avgGdp}%) with disinflationary/rate-cut pressure.`);
    playbook = 'Favor sovereign bonds (yield compression), JPY/CHF havens, and Gold; fade commodity currencies.';
  } else if (avgGdp != null && avgGdp >= 1.8 && avgCpi != null && (avgCpi >= 2.9 || accelCount >= 4)) {
    regime = 'Inflationary Boom';
    confidencePct = 79;
    criteria.push(`Resilient G8 GDP (${avgGdp}%) alongside sticky/accelerating inflation (${avgCpi}%, ${accelCount}/8 accelerating).`);
    playbook = 'Favor hawkish high-real-yield currencies (USD/GBP/AUD), Oil, and short low-yielders (JPY/CHF).';
  } else if (avgGdp != null && avgGdp >= 1.2 && (coolCount >= 3 || (avgCpi != null && avgCpi <= 2.7)) && (vix == null || vix < 19)) {
    regime = 'Disinflationary Soft Landing';
    confidencePct = 82;
    criteria.push(`Positive G8 growth (${avgGdp}%), moderating inflation (${avgCpi}%), contained volatility (VIX ${vix ?? 'N/A'}).`);
    playbook = 'Favor carry trades, NAS100/SPX500, and high-real-yield FX with constructive growth differentials.';
  } else if (riskFx1M > haven1M + 0.8 && (vix == null || vix < 18)) {
    regime = 'Risk-On';
    confidencePct = 76;
    criteria.push(`AUD/NZD (${riskFx1M >= 0 ? '+' : ''}${riskFx1M}%) outperforming CHF/JPY (${haven1M >= 0 ? '+' : ''}${haven1M}%) with calm VIX (${vix ?? 'N/A'}).`);
    playbook = 'Favor pro-cyclical FX (AUD, NZD, CAD), equities, and selective BTC/USD momentum.';
  } else {
    criteria.push(`Mixed macro cross-currents (G8 GDP ${avgGdp ?? 'N/A'}%, CPI ${avgCpi ?? 'N/A'}%, VIX ${vix ?? 'N/A'}).`);
  }

  // Priority 2.14: Safe-Haven Flows composite
  const safeHavenRegime = (haven1M > 0.75 || (goldM1 != null && goldM1 > 3.5) || (vix != null && vix > 22))
    ? 'Strong Haven Bid'
    : (haven1M > 0.15 || (goldM1 != null && goldM1 > 1.0))
    ? 'Moderate Haven Bid'
    : (haven1M < -0.75 && riskFx1M > 0.5)
    ? 'Risk-On Outflow'
    : 'Neutral';

  const safeHavenFlows = {
    regime: safeHavenRegime,
    goldSpot: assets?.gold || null,
    goldEtfGld: assets?.data?.GLD || null,
    chfJpyBasket1MPct: haven1M,
    audNzdRiskBasket1MPct: riskFx1M,
    sovereignBonds: {
      us10y: dash?.fred?.us10y || null,
      de10y: dash?.fred?.de10y || null,
      jp10y: dash?.fred?.jp10y || null,
      tltEtf: assets?.data?.TLT || null
    }
  };

  return {
    regime,
    confidencePct,
    criteriaMatched: criteria,
    playbook,
    metrics: {
      globalGrowthAvg: avgGdp,
      globalInflationAvg: avgCpi,
      inflationAcceleratingCount: accelCount,
      inflationCoolingCount: coolCount,
      vix,
      spx1MPct: spxM1,
      chfJpyHaven1MPct: haven1M,
      gold1MPct: goldM1
    },
    safeHavenFlows
  };
}

/**
 * Priority 4.3: 30-Day Macro Momentum Score (Improving / Deteriorating / Stable)
 */
function computeMacroMomentum30D(fund, hist, cotData) {
  const out = {};
  const oldestSnap = scoreHistorySnapshots.find(s => Date.now() - s.ts >= 20 * DAY_MS) || scoreHistorySnapshots[0];

  for (const c of CUR) {
    const d = fund.data[c] || {};
    const drivers = [];
    let delta = 0;

    // 1. Historical snapshot delta if server has >20d history
    if (oldestSnap && oldestSnap.scores?.[c] != null && (Date.now() - oldestSnap.ts >= 7 * DAY_MS)) {
      delta += (fund.scores[c].totalScore - oldestSnap.scores[c]);
      drivers.push(`Recorded score shift ${round2(fund.scores[c].totalScore - oldestSnap.scores[c])} since ${oldestSnap.day}`);
    } else {
      // Deterministic 30D fundamental impulse proxy from latest deltas
      if (d.gdp?.delta1 != null) {
        delta += clamp(d.gdp.delta1 * 0.4, -0.6, 0.6);
        if (Math.abs(d.gdp.delta1) >= 0.2) drivers.push(`GDP trend ${d.gdp.delta1 > 0 ? '+' : ''}${d.gdp.delta1}pp`);
      }
      if (d.unemp?.delta3m != null) {
        delta += clamp(-d.unemp.delta3m * 0.6, -0.6, 0.6);
        if (Math.abs(d.unemp.delta3m) >= 0.1) drivers.push(`3M unemployment ${d.unemp.delta3m > 0 ? '+' : ''}${d.unemp.delta3m}pp`);
      }
      if (d.yield10y?.delta1 != null) {
        delta += clamp(d.yield10y.delta1 * 0.8, -0.6, 0.6);
        if (Math.abs(d.yield10y.delta1) >= 0.1) drivers.push(`10Y yield ${d.yield10y.delta1 > 0 ? '+' : ''}${d.yield10y.delta1}pp`);
      }
      const cot4w = cotData?.[c]?.change4w;
      if (cot4w != null && cotData?.[c]?.oi) {
        const cotImp = (cot4w / cotData[c].oi) * 10;
        delta += clamp(cotImp, -0.5, 0.5);
        if (Math.abs(cot4w) > 5000) drivers.push(`4W COT net ${cot4w > 0 ? '+' : ''}${Math.round(cot4w).toLocaleString()}`);
      }
      const str1m = hist.strength[21][c] ?? 0;
      delta += clamp(str1m * 0.12, -0.4, 0.4);
    }

    delta = round2(delta);
    const direction = delta >= 0.25 ? 'Improving' : delta <= -0.25 ? 'Deteriorating' : 'Stable';
    out[c] = {
      currency: c,
      direction,
      delta30d: delta,
      currentScore: fund.scores[c].totalScore,
      drivers: drivers.length ? drivers : ['Stable recent macro releases over trailing 30D']
    };
  }
  return out;
}

/**
 * Priority 4.4: Priced-In vs. Surprise Tracker
 */
function computeSurpriseTracker(calItems, hist, fund) {
  const now = Date.now();
  const cut30d = now - 30 * DAY_MS;
  const recent = (calItems || []).filter(e => {
    const ms = new Date(e.timestamp).getTime();
    return ms >= cut30d && ms <= now && e.actual != null && e.forecast != null;
  });

  const out = {};
  for (const c of CUR) {
    const items = recent.filter(e => e.currency === c);
    const beats = items.filter(e => e.surpriseDir > 0).length;
    const misses = items.filter(e => e.surpriseDir < 0).length;
    const inLine = items.filter(e => e.surpriseDir === 0).length;
    const netSurprise = beats - misses;
    const spotMove1M = hist.strength[21][c] ?? 0;
    const impliedBps = fund.data[c]?.centralBank?.impliedNextMeetingBps ?? 0;

    let pricingState = 'Fairly Priced';
    let note = 'Spot FX move broadly tracks recent 30D data surprises.';

    if (spotMove1M > 1.5 && netSurprise <= 0) {
      pricingState = 'Over-Priced Rally';
      note = `${c} rallied +${round2(spotMove1M)}% over 1M despite neutral/negative data surprises (${beats}B/${misses}M) — vulnerable to pullback.`;
    } else if (spotMove1M < -1.5 && netSurprise >= 0) {
      pricingState = 'Over-Priced Selloff';
      note = `${c} fell ${round2(spotMove1M)}% over 1M despite resilient surprises (${beats}B/${misses}M) — asymmetric bounce risk.`;
    } else if (netSurprise >= 3 && spotMove1M < 0.5) {
      pricingState = 'Under-Priced Bullish Catalyst';
      note = `Consistent positive surprises (${beats} beats vs ${misses} misses) not yet reflected in ${c} spot (${round2(spotMove1M)}%).`;
    } else if (netSurprise <= -3 && spotMove1M > -0.5) {
      pricingState = 'Under-Priced Bearish Catalyst';
      note = `Deteriorating releases (${misses} misses vs ${beats} beats) not yet priced into ${c} spot.`;
    }

    out[c] = {
      currency: c,
      releasesAnalyzed: items.length,
      beats,
      misses,
      inLine,
      netSurpriseScore: netSurprise,
      spotMove1MPct: round2(spotMove1M),
      impliedNextMeetingBps: impliedBps,
      pricingState,
      note,
      latestSurprises: items.slice(-4).reverse().map(e => ({
        date: e.date,
        title: e.title,
        actual: e.actual,
        forecast: e.forecast,
        verdict: e.surpriseDir > 0 ? 'Beat' : e.surpriseDir < 0 ? 'Miss' : 'In-Line'
      }))
    };
  }
  return out;
}

/**
 * Priority 4.5: Trade Thesis Invalidation Alerts
 */
function computeInvalidationAlerts(pairSignals, calItems, hist) {
  const now = Date.now();
  const cut72h = now - 72 * 36e5;
  const recentHighCal = (calItems || []).filter(e =>
    e.impact === 'High' && e.surpriseDir !== 0 && new Date(e.timestamp).getTime() >= cut72h && new Date(e.timestamp).getTime() <= now
  );
  const recentHighNews = news.filter(n =>
    n.impact === 'HIGH' && (now - new Date(n.time).getTime() <= 72 * 36e5) && Math.abs(n.sentimentScore || 0) >= 1.5
  );

  const alerts = [];
  const activeSetups = pairSignals.filter(p => p.signal !== 'NEUTRAL / NO TRADE').slice(0, 12);

  for (const p of activeSetups) {
    const dir = p.spread > 0 ? 1 : -1;
    // 1. Opposing high-impact calendar release in last 72h
    for (const ev of recentHighCal) {
      const opposingBase = ev.currency === p.base && (ev.surpriseDir * dir < 0);
      const opposingQuote = ev.currency === p.quote && (ev.surpriseDir * dir > 0);
      if (opposingBase || opposingQuote) {
        alerts.push({
          pair: p.pair,
          bias: p.signal,
          severity: 'HIGH',
          triggerType: 'Economic Surprise',
          reason: `${ev.currency} ${ev.title} (${ev.actual} vs ${ev.forecast} fcst) surprised against ${p.signal} ${p.pair} thesis.`,
          timestamp: ev.timestamp
        });
      }
    }
    // 2. Opposing central bank news guidance shift
    const cbOpp = recentHighNews.find(n =>
      (n.cur?.includes(p.base) && Math.sign(n.sentimentScore) !== dir) ||
      (n.cur?.includes(p.quote) && Math.sign(n.sentimentScore) === dir)
    );
    if (cbOpp) {
      alerts.push({
        pair: p.pair,
        bias: p.signal,
        severity: 'MEDIUM',
        triggerType: 'Central Bank / News Shift',
        reason: `Headline "${cbOpp.title.slice(0, 80)}" (${cbOpp.tone}, ${cbOpp.sentimentConfidence}% conf) challenges ${p.signal} ${p.pair}.`,
        timestamp: cbOpp.time
      });
    }
    // 3. Correlation breakdown warning
    const corrBrk = (hist.correlationBreakdownAlerts || []).find(a =>
      (a.pairA === p.base && a.pairB === p.quote) || (a.pairA === p.quote && a.pairB === p.base)
    );
    if (corrBrk) {
      alerts.push({
        pair: p.pair,
        bias: p.signal,
        severity: 'MEDIUM',
        triggerType: 'Correlation Breakdown',
        reason: corrBrk.alertText,
        timestamp: new Date().toISOString()
      });
    }
  }

  return alerts.slice(0, 15);
}

/**
 * Priority 4.6: Historical Score Backtest Summary (Rolling 30D & 60D Directional Hit-Rates)
 * Evaluates historical cross-sectional carry + macro momentum spreads against subsequent
 * 21-trading-day (~30D) and 42-trading-day (~60D) spot returns across all 28 G8 crosses.
 */
function computeHistoricalBacktest(hist, fund) {
  const n = hist.dates.length;
  if (n < 110) {
    return {
      available: false,
      reason: 'Insufficient ECB trading history (<110 sessions) for rolling 30D/60D backtest.'
    };
  }

  const rates = hist.rates;
  const px = (b, q, i) => rates[q][i] / rates[b][i];

  // Static fundamental carry anchor (real yield + policy rate z-score) combined with point-in-time 21D/63D momentum
  const carryScore = {};
  const realMap = {};
  CUR.forEach(c => { realMap[c] = fund.data[c]?.realYield10y?.value ?? fund.data[c]?.rate?.value ?? 0; });
  const zCarry = zScoreMap(realMap, false);
  CUR.forEach(c => { carryScore[c] = (zCarry[c] ?? 0) * 1.5; });

  const runWindow = horizonTradingDays => {
    let evaluated = 0, hits = 0;
    const returns = [];
    // Step every 10 trading days to avoid excessive overlapping autocorrelation
    for (let idx = 65; idx <= n - 1 - horizonTradingDays; idx += 10) {
      // Point-in-time 21D base/quote-adjusted strength at idx
      const momAtIdx = {};
      CUR.forEach(c => { momAtIdx[c] = 0; });
      for (const [b, q] of PAIRS_28) {
        const pNow = px(b, q, idx), pPrev = px(b, q, idx - 21);
        momAtIdx[b] += (pNow / pPrev - 1) * 100;
        momAtIdx[q] += ((1 / pNow) / (1 / pPrev) - 1) * 100;
      }
      CUR.forEach(c => { momAtIdx[c] /= 7; });
      const zMom = zScoreMap(momAtIdx, false);

      for (const [b, q] of PAIRS_28) {
        const scB = carryScore[b] + (zMom[b] ?? 0) * 1.0;
        const scQ = carryScore[q] + (zMom[q] ?? 0) * 1.0;
        const spread = scB - scQ;
        if (Math.abs(spread) < 1.5) continue;

        const dir = Math.sign(spread);
        const fwdRet = (px(b, q, idx + horizonTradingDays) / px(b, q, idx) - 1) * 100;
        const signedRet = fwdRet * dir;
        evaluated++;
        if (signedRet > 0) hits++;
        returns.push(signedRet);
      }
    }

    const hitRatePct = evaluated ? round2((hits / evaluated) * 100) : null;
    const avgReturnPct = returns.length ? round2(mean(returns)) : null;
    const retSd = returns.length > 1 ? sd(returns) : null;
    const sharpeProxy = (avgReturnPct != null && retSd && retSd > 0) ? round2(avgReturnPct / retSd) : null;

    return {
      horizonTradingDays,
      tradesEvaluated: evaluated,
      hits,
      hitRatePct,
      avgReturnPct,
      sharpeProxy
    };
  };

  return {
    available: true,
    window30D: runWindow(21),
    window60D: runWindow(42),
    samplePeriod: `${hist.dates[65]} to ${hist.dates[n - 1]}`,
    methodology: 'Evaluates all 28 G8 crosses every 10 trading days where |Carry + Point-in-Time Momentum Spread| >= 1.5 against forward 21D (~30D) and 42D (~60D) ECB spot returns.',
    caveat: 'Research backtest using historical ECB daily reference rates and current carry anchor; excludes spreads/swaps and is not a guarantee of future results.'
  };
}

/**
 * Unified Swing-Trading & Executive Intelligence Engine (/api/intelligence)
 */
async function buildIntelligence(force = false) {
  const [hist, fund, assets, dash, cotData, calWin] = await Promise.all([
    cached('h', 36e5, fetchEcbRaw, force),
    cached('f', 18e5, () => fundamentals(force), force),
    cached('assets', 18e5, () => multiAssets(force), force),
    cached('d', 3e5, () => dashboard(force), force),
    cached('cot', 432e5, cot, force).catch(() => null),
    getMacroCalendarWindow(false)
  ]);

  recordScoreSnapshot(fund.scores);

  // Build nuanced signals across all 28 G8 pairs
  const pairSignals = PAIRS_28
    .map(([b, q]) => buildPairSignal(b, q, { hist, fund, cotData: cotData?.data || null, calItems: calWin?.items || [] }))
    .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));

  // Divergence Scanner: ranked by divergenceScore, filtering crowded extremes for top clean setups
  const divergenceScanner = {
    allRanked: [...pairSignals].sort((a, b) => b.divergenceScore - a.divergenceScore),
    cleanTopDivergent: [...pairSignals]
      .filter(p => !p.crowdedCotExtreme && p.signal !== 'NEUTRAL / NO TRADE')
      .sort((a, b) => b.divergenceScore - a.divergenceScore)
      .slice(0, 8),
    filteredCrowdedPairs: pairSignals.filter(p => p.crowdedCotExtreme).map(p => ({
      pair: p.pair,
      spread: p.spread,
      reason: 'Filtered from clean divergence list due to CFTC COT extreme (>=85th / <=15th 52W pct).'
    }))
  };

  const macroRegime = detectMacroRegime({ fund, assets, hist, dash });
  const macroMomentum = computeMacroMomentum30D(fund, hist, cotData?.data || null);
  const surpriseTracker = computeSurpriseTracker(calWin?.items || [], hist, fund);
  const invalidationAlerts = computeInvalidationAlerts(pairSignals, calWin?.items || [], hist);
  const backtest = computeHistoricalBacktest(hist, fund);

  // Per-currency Multi-Timeframe Outlook
  const currencyMultiTimeframe = {};
  for (const c of CUR) {
    const st = round2((hist.strength[21][c] ?? 0) * 0.4 + (surpriseTracker[c]?.netSurpriseScore ?? 0) * 0.35);
    const mt = round2((fund.scores[c]?.contributions?.centralBankStance?.contribution ?? 0) + (fund.scores[c]?.contributions?.cotPositioning?.contribution ?? 0));
    const lt = round2((fund.scores[c]?.contributions?.realYield?.contribution ?? 0) + (fund.scores[c]?.contributions?.growthMomentum?.contribution ?? 0));
    const lb = v => (v > 0.35 ? 'Bullish' : v < -0.35 ? 'Bearish' : 'Neutral');
    currencyMultiTimeframe[c] = {
      shortTerm: { horizon: '1–2W', bias: lb(st), score: st },
      mediumTerm: { horizon: '1–3M', bias: lb(mt), score: mt },
      longTerm: { horizon: '3–12M', bias: lb(lt), score: lt }
    };
  }

  // Upcoming high-impact catalysts (next 7 days) for Executive Dashboard
  const now = Date.now();
  const upcomingHighImpact = (calWin?.items || [])
    .filter(e => e.impact === 'High' && new Date(e.timestamp).getTime() > now && new Date(e.timestamp).getTime() < now + 7 * DAY_MS)
    .slice(0, 8);

  // Merge freshness across Fundamentals + Dashboard + COT
  const combinedFreshness = {
    status: [fund.freshness?.status, dash.freshness?.status, cotData?.freshness?.status].includes('DEGRADED')
      ? 'DEGRADED'
      : [fund.freshness?.status, dash.freshness?.status, cotData?.freshness?.status].includes('PARTIAL_STALE')
      ? 'PARTIAL_STALE'
      : 'FRESH',
    staleCount: (fund.freshness?.staleCount || 0) + (dash.freshness?.staleCount || 0) + (cotData?.freshness?.staleCount || 0),
    unavailableCount: (fund.freshness?.unavailableCount || 0) + (dash.freshness?.unavailableCount || 0) + (cotData?.freshness?.unavailableCount || 0),
    staleWarnings: [
      ...(fund.freshness?.staleItems || []),
      ...(dash.freshness?.staleItems || []),
      ...(cotData?.freshness?.staleItems || [])
    ].slice(0, 20),
    unavailableWarnings: [
      ...(fund.freshness?.unavailableItems || []),
      ...(dash.freshness?.unavailableItems || [])
    ].slice(0, 20),
    checkedAt: new Date().toISOString()
  };

  return {
    executiveSummary: {
      globalRegime: macroRegime.regime,
      regimeConfidencePct: macroRegime.confidencePct,
      regimePlaybook: macroRegime.playbook,
      topDivergentPairs: divergenceScanner.cleanTopDivergent.slice(0, 4),
      staleDataWarningsCount: combinedFreshness.staleCount,
      unavailableDataCount: combinedFreshness.unavailableCount,
      invalidationAlertsCount: invalidationAlerts.length,
      upcomingHighImpact
    },
    macroRegime,
    safeHavenFlows: macroRegime.safeHavenFlows,
    pairSignals,
    divergenceScanner,
    macroMomentum,
    surpriseTracker,
    invalidationAlerts,
    backtest,
    currencyMultiTimeframe,
    crossAssetDrivers: assets.crossAssetDrivers,
    correlationBreakdownAlerts: [
      ...(hist.correlationBreakdownAlerts || []),
      ...(assets.correlationBreakdownAlerts || [])
    ],
    gold: assets.gold,
    freshness: combinedFreshness,
    calculatedAt: new Date().toISOString()
  };
}

/**
 * Priority 1.2 & 1.3: Unified /api/rates endpoint exposing ECB spot rates,
 * base/quote-adjusted strength, sovereign yields, and the exact same cached Gold feed.
 */
async function buildRates(force = false) {
  const [hist, { publicGold }, dash] = await Promise.all([
    cached('h', 36e5, fetchEcbRaw, force),
    getUnifiedGold(force),
    cached('d', 3e5, () => dashboard(force), force).catch(() => null)
  ]);

  const t = hist.dates.length - 1;
  const spotPairs = {};
  for (const [b, q] of PAIRS_28) {
    const pNow = hist.rates[q][t] / hist.rates[b][t];
    const pPrev = hist.rates[q][Math.max(0, t - 1)] / hist.rates[b][Math.max(0, t - 1)];
    spotPairs[`${b}/${q}`] = {
      price: round4(pNow),
      d1: round4(pNow / pPrev - 1),
      observationDate: hist.dates[t],
      source: 'ECB'
    };
  }

  return {
    gold: publicGold,
    spotPairs,
    strength: hist.strength,
    strengthMethodology: hist.strengthMethodology,
    usYields: dash ? {
      us2y: dash.fred.us2y,
      us5y: dash.fred.us5y,
      us10y: dash.fred.us10y,
      tips10y: dash.fred.tips10y,
      spread2s10s: dash.derived.spread2s10s
    } : null,
    fetchedAt: new Date().toISOString(),
    source: 'ECB Reference Rates + Unified Gold Feed + FRED US Yields'
  };
}

// Background warmers (Render-friendly staggered startup)
setTimeout(() => cached('f', 18e5, () => fundamentals(false)).catch(() => {}), 4000);
setInterval(() => cached('f', 0, () => fundamentals(true), true).catch(() => {}), 18e5);

// ============================================================================
// 12. HTTP SERVER & ROUTING
// ============================================================================

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const o = req.headers.origin;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (o && (ORIGINS.includes(o) || ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'GET' && !(req.method === 'POST' && req.url.startsWith('/api/ai-copilot'))) {
    return send(res, 405, { error: 'Method not allowed' });
  }

  const U = new URL(req.url, 'http://x');
  const p = U.pathname;
  const force = U.searchParams.get('force') === '1';

  try {
    if (p === '/api/health') {
      return send(res, 200, { ok: true, status: 'online', timestamp: new Date().toISOString() });
    }

    if (p === '/api/history') {
      return send(res, 200, await cached('h', 36e5, fetchEcbRaw, force));
    }

    if (p === '/api/rates') {
      return send(res, 200, await buildRates(force));
    }

    if (p === '/api/fundamentals') {
      return send(res, 200, await cached('f', 18e5, () => fundamentals(force), force));
    }

    if (p === '/api/dashboard') {
      return send(res, 200, await cached('d', 3e5, () => dashboard(force), force));
    }

    if (p === '/api/assets') {
      return send(res, 200, await cached('assets', 18e5, () => multiAssets(force), force));
    }

    if (p === '/api/cot') {
      return send(res, 200, await cached('cot', 432e5, cot, force));
    }

    if (p === '/api/intelligence') {
      return send(res, 200, await buildIntelligence(force));
    }

    if (p === '/api/calendar') {
      const range = parseCalRange(U.searchParams.get('from'), U.searchParams.get('to'));
      return send(res, 200, await cached(range.cacheKey, 900000, () => calendar(range), force));
    }

    if (p === '/api/news/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: init\ndata: ${JSON.stringify(news.slice(0, 80).map(presentNews))}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (p === '/api/news') {
      if (!news.length) await firstPoll;
      const cat = U.searchParams.get('category');
      const cur = U.searchParams.get('currency');
      let list = news;
      if (cat && cat !== 'All') list = list.filter(n => n.category === cat);
      if (cur && cur !== 'All') list = list.filter(n => n.cur?.includes(cur));
      return send(res, 200, {
        items: list.slice(0, 120).map(presentNews),
        total: list.length,
        lastPoll,
        fetchedAt: new Date().toISOString()
      });
    }

    if (p === '/api/ai-copilot' && req.method === 'POST') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return send(res, 500, { error: 'GEMINI_API_KEY is not configured on the server.' });
      }
      let raw = '';
      req.on('data', chunk => {
        raw += chunk;
        if (raw.length > 250000) req.destroy();
      });
      req.on('end', async () => {
        try {
          const { prompt, mode = 'chat', context = {}, history = [] } = JSON.parse(raw || '{}');
          if (!prompt || typeof prompt !== 'string') {
            return send(res, 400, { error: 'Prompt is required.' });
          }

          const systemInstruction =
            'You are an institutional FX Macro & Derivatives Desk Analyst embedded inside FX Fundamentals Pro. Analyze the provided live macro JSON snapshot (Macro Scores, Economic Surprises, 2Y Rate Path, Regime Velocity, COT Squeeze Radar, Open Portfolio Exposure, Calendar, News). Be concise, quantitative, and actionable. Cite exact numbers from the snapshot. Format cleanly with short bullet points and bold key levels/pairs. Frame as institutional desk scenarios & risk checks.';

          const contents = [];
          if (Array.isArray(history)) {
            history.slice(-6).forEach(m => {
              const msgText = m && (m.content || m.text);
              if (m && m.role && msgText) {
                contents.push({
                  role: m.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: String(msgText).slice(0, 3000) }]
                });
              }
            });
          }

          contents.push({
            role: 'user',
            parts: [{
              text:
                'MODE: ' + String(mode).toUpperCase() +
                '\nLIVE DESK SNAPSHOT:\n' + JSON.stringify(context).slice(0, 18000) +
                '\n\nREQUEST:\n' + prompt
            }]
          });

const trimmedKey = apiKey.trim();
          const hostVertex = ['aiplatform', 'googleapis', 'com'].join('.');
          const hostStudio = ['generativelanguage', 'googleapis', 'com'].join('.');
          const vertexBase = ['https:/', hostVertex, 'v1', 'publishers', 'google', 'models', ''].join('/');
          const studioBase = ['https:/', hostStudio, 'v1beta', 'models', ''].join('/');

          // Pick the matching host first based on key type (AIza = AI Studio, AQ. = Vertex Express)
          const bases = trimmedKey.startsWith('AIza')
            ? [studioBase, vertexBase]
            : [vertexBase, studioBase];

          // Use minimal/zero thinking so desk replies return in ~1-3s instead of timing out
          const attempts = [
            { id: 'gemini-3-flash-preview', thinkingConfig: { thinkingLevel: 'MINIMAL' } },
            { id: 'gemini-2.5-flash', thinkingConfig: { thinkingBudget: 0 } }
          ];

          let lastError = 'Gemini API error';
          let lastStatus = 500;

          for (const base of bases) {
            for (const m of attempts) {
              try {
                const payload = JSON.stringify({
                  systemInstruction: { parts: [{ text: systemInstruction }] },
                  contents,
                  generationConfig: {
                    temperature: 0.35,
                    maxOutputTokens: 1200,
                    thinkingConfig: m.thinkingConfig
                  }
                });

                const r = await fetch(base + m.id + ':generateContent', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': trimmedKey
                  },
                  body: payload,
                  signal: AbortSignal.timeout(25000)
                });

                const data = await r.json().catch(() => ({}));
                if (!r.ok) {
                  lastStatus = r.status;
                  lastError = (data && data.error && data.error.message) || ('API HTTP ' + r.status);
                  continue;
                }

                const c0 = Array.isArray(data && data.candidates) ? data.candidates[0] : null;
                const parts = (c0 && c0.content && Array.isArray(c0.content.parts)) ? c0.content.parts : [];
                const reply = parts
                  .filter(pt => !pt.thought && pt.text)
                  .map(pt => pt.text)
                  .join('')
                  .trim() || 'No analysis returned.';

                return send(res, 200, { reply, model: m.id, timestamp: new Date().toISOString() });
              } catch (fetchErr) {
                lastStatus = 504;
                lastError = (fetchErr && fetchErr.message) || 'Upstream timeout';
              }
            }
          }

          return send(res, lastStatus, { error: lastError });

        } catch (err) {
          return send(res, 500, { error: (err && err.message) || 'Internal AI Copilot failure' });
        }
      });
      return;
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 502, { error: 'Upstream unavailable', detail: e.message });
  }
}).listen(PORT, () => console.log('FX Fundamentals Pro API (v2) running on port', PORT));
