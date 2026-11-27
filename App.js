/**
 * FX Fundamentals Pro — React Native / Expo Web Client (v12 Institutional Upgrade)
 * Connects to backend/server.js v2.0-pro implementing:
 *  - Priority 1: Global freshness status bar, source/obsDate/STALE badges & explicit
 *                unavailable strings, unified Gold (XAU/USD) feed, base/quote-adjusted
 *                currency strength + methodology modal, clickable 7-factor macro score
 *                breakdown drawer, context-aware news rationales & confidence badges,
 *                and calibrated 5-tier trade signals with confidence meters & conflict callouts.
 *  - Priority 2: Expanded G8 fundamentals (Rates/Implied bps/Curve, Real Yields,
 *                Core/Headline CPI & PCE + 3M trend, Growth/PMI/Retail/IP,
 *                Employment/Wages/Participation, CB Guidance + Next Meeting,
 *                52W & 3Y CFTC COT percentiles + Net/OI %, Safe-Haven Flows).
 *  - Priority 3: Switchable 30D/60D/90D rolling correlation matrix + >0.35 Breakdown Alerts
 *                and full Cross-Asset Drivers Panel (USD, Gold, Oil, Risk/VIX, BTC).
 *  - Priority 4: Swing-Trading Intelligence tab (Macro Regime Detection, Divergence Scanner
 *                with COT crowding filter, 30D Macro Momentum, Priced-In vs. Surprise Tracker,
 *                Trade Thesis Invalidation Alerts, Rolling 30D/60D Backtest Summary,
 *                Multi-Timeframe Fundamental Outlooks).
 *  - Priority 5: Consolidated Macro Executive Dashboard, Sorting & Filtering on Weekly Top Picks
 *                and Pair Scanner, and full source/timestamp/missing-data transparency.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl,
  Linking, Share, StatusBar, Platform, Image, Modal, useWindowDimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// ============================================================================
// 1. CONSTANTS, THEME & STORAGE HELPERS
// ============================================================================

const API = process.env.EXPO_PUBLIC_API_URL || 'https://fx-fundamentals-pro.onrender.com';
const CUR = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const PAIRS = [];
CUR.forEach((b, i) => CUR.slice(i + 1).forEach(q => PAIRS.push([b, q])));

const C = {
  bg: '#0a1128',
  bgDeep: '#070d20',
  card: '#111a3a',
  cardAlt: '#0e1733',
  line: '#1e2a52',
  tx: '#e6ebff',
  mut: '#8a96c4',
  up: '#22c55e',
  upBg: '#14532d',
  upTx: '#bbf7d0',
  dn: '#ef4444',
  dnBg: '#7f1d1d',
  dnTx: '#fecaca',
  warn: '#f59e0b',
  warnBg: '#78350f',
  warnTx: '#fde68a',
  ac: '#3b82f6',
  acBg: '#1d4ed8'
};

const BANKS = {
  USD: ['Fed', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'],
  EUR: ['ECB', 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html'],
  GBP: ['BoE', 'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates'],
  JPY: ['BoJ', 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm'],
  CHF: ['SNB', 'https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy'],
  CAD: ['BoC', 'https://www.bankofcanada.ca/core-functions/monetary-policy/'],
  AUD: ['RBA', 'https://www.rba.gov.au/monetary-policy/rba-board-meetings/'],
  NZD: ['RBNZ', 'https://www.rbnz.govt.nz/monetary-policy']
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

const store = {
  get: async (k, d) => {
    try {
      const v = await AsyncStorage.getItem('fx2:' + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set: (k, v) => AsyncStorage.setItem('fx2:' + k, JSON.stringify(v)).catch(() => {})
};

async function loadEndpoint(path, key, set) {
  try {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    set(j);
    store.set(key, j);
    return true;
  } catch {
    const cached = await store.get(key, null);
    if (cached) set(cached);
    return false;
  }
}

// ============================================================================
// 2. TIME (IST) & FORMATTING HELPERS
// ============================================================================

const IST = 5.5 * 36e5;
const DAY_MS = 864e5;
const p2 = n => String(n).padStart(2, '0');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ist = t => {
  const d = new Date(t + IST);
  return {
    h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(),
    wd: d.getUTCDay(), day: d.getUTCDate(), mon: d.getUTCMonth(), y: d.getUTCFullYear(),
    md: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
};

const fmtIstTime = iso => {
  if (!iso) return 'Unavailable';
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return String(iso);
  const d = ist(ms);
  return `${d.day} ${MN[d.mon]} ${p2(d.h)}:${p2(d.m)} IST`;
};

const SESS = [['Tokyo', 330, 870], ['London', 810, 1350], ['New York', 1110, 210]];
const inR = (m, s, e) => (s < e ? m >= s && m < e : m >= s || m < e);
const closedWk = i => (i.wd === 6 && i.md >= 210) || i.wd === 0 || (i.wd === 1 && i.md < 210);
const actSess = (s, t) => { const i = ist(t); return !closedWk(i) && inR(i.md, s[1], s[2]); };
const nextOpen = t => {
  const t0 = Math.floor(t / 6e4) * 6e4;
  for (let k = 1; k <= 8200; k++) {
    const x = t0 + k * 6e4;
    for (const s of SESS) if (actSess(s, x) && !actSess(s, x - 6e4)) return { name: s[0], t: x };
  }
  return null;
};
const fmtCd = ms => {
  const s = Math.max(0, Math.floor(ms / 1e3));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${p2(h)}h` : h ? `${p2(h)}h ${p2(m)}m` : `${p2(m)}m ${p2(s % 60)}s`;
};
const hm = m => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const useNow = () => {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  return t;
};

const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const cor = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 10) return 0;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y), s = sd(x) * sd(y);
  return s ? mean(x.map((v, i) => (v - mx) * (y[i] - my))) / s : 0;
};
const okN = x => x != null && !isNaN(x);
const pct = x => (x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%');
const pctRaw = x => (x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '') + Number(x).toFixed(2) + '%');
const col = x => (x > 0 ? C.up : x < 0 ? C.dn : C.mut);
const f2 = (x, d = 2) => (x == null || isNaN(x) ? '—' : Number(x).toFixed(d));
const signedF2 = (x, d = 2) => (x == null || isNaN(x) ? '—' : `${x >= 0 ? '+' : ''}${Number(x).toFixed(d)}`);

// ============================================================================
// 3. ANALYTICS FALLBACK (BASE/QUOTE-ADJUSTED) & MULTI-ASSET RESOLVER
// ============================================================================

function computeClientAnalytics(h) {
  if (!h?.dates || h.dates.length < 35) return null;
  const n = h.dates.length;
  const t = n - 1;
  const px = (b, q, i) => h.rates[q][i] / h.rates[b][i];

  // Prefer server-computed base/quote-adjusted strength; otherwise compute identically on client
  const calcStrength = (idx, k) => {
    const acc = {};
    CUR.forEach(c => { acc[c] = 0; });
    const prev = Math.max(0, idx - k);
    for (const [b, q] of PAIRS) {
      const pNow = px(b, q, idx), pPrev = px(b, q, prev);
      acc[b] += (pNow / pPrev - 1) * 100;
      acc[q] += ((1 / pNow) / (1 / pPrev) - 1) * 100; // Explicitly inverted quote side
    }
    const o = {};
    CUR.forEach(c => { o[c] = Number((acc[c] / 7).toFixed(3)); });
    return o;
  };

  const str = h.strength || {
    1: calcStrength(t, 1),
    5: calcStrength(t, 5),
    21: calcStrength(t, 21),
    63: calcStrength(t, 63)
  };

  let correlations = h.correlations;
  if (!correlations) {
    const ser = {};
    CUR.forEach(c => { ser[c] = []; });
    for (let i = Math.max(1, n - 92); i < n; i++) {
      const s = calcStrength(i, 1);
      CUR.forEach(c => ser[c].push(s[c]));
    }
    const mk = win => CUR.map(a => CUR.map(b => (a === b ? 1 : Number(cor(ser[a].slice(-win), ser[b].slice(-win)).toFixed(2)))));
    correlations = { '30D': mk(30), '60D': mk(60), '90D': mk(90) };
  }

  return {
    str,
    strengthMethodology: h.strengthMethodology || {
      formula: 'Strength(C, k) = (1/7) × Σ_{X≠C} Return(C/X, k), with quote-side crosses inverted as [(1/P_t)/(1/P_{t-k}) - 1] × 100 across all 28 G8 crosses.',
      timeframes: { '1D': '1 trading day', '1W': '5 trading days', '1M': '21 trading days', '3M': '63 trading days' },
      crossCount: 28,
      asOfDate: h.dates[t],
      source: 'ECB Reference Rates'
    },
    correlations,
    corr: correlations['60D'],
    breakdownAlerts: h.correlationBreakdownAlerts || [],
    price: (b, q) => px(b, q, t),
    chg: (b, q, k) => px(b, q, t) / px(b, q, Math.max(0, t - k)) - 1,
    date: h.dates[t],
    series: (b, q) => {
      const o = [];
      for (let i = Math.max(0, n - 60); i < n; i++) o.push(px(b, q, i));
      return o;
    }
  };
}

function getUnifiedGoldFromState(intel, rates, dash, assets, fx) {
  const candidates = [intel?.gold, rates?.gold, assets?.gold, dash?.gold, dash?.fred?.gold, fx?.gold, assets?.data?.XAUUSD];
  const valid = candidates.find(g => g && (g.price != null || g.value != null));
  if (valid) {
    return {
      ...valid,
      price: valid.price ?? valid.value,
      value: valid.value ?? valid.price
    };
  }
  return {
    value: null,
    price: null,
    source: 'Gold Feed',
    observationDate: null,
    fetchedAt: null,
    stale: false,
    unavailableReason: 'Unavailable (Source Timeout)'
  };
}

const ASSET_ALIASES = {
  XAUUSD: 'XAU/USD', GOLD: 'XAU/USD', XAU: 'XAU/USD',
  XAGUSD: 'XAG/USD', SILVER: 'XAG/USD', XAG: 'XAG/USD',
  XAUEUR: 'XAU/EUR', XAUJPY: 'XAU/JPY',
  US30: 'US30', DJ30: 'US30', DOW: 'US30', DJI: 'US30',
  NAS100: 'NAS100', USTEC: 'NAS100', NDX: 'NAS100', NASDAQ: 'NAS100',
  SPX500: 'SPX500', US500: 'SPX500', SP500: 'SPX500', SPX: 'SPX500',
  BTCUSD: 'BTC/USD', BTC: 'BTC/USD', BITCOIN: 'BTC/USD',
  USOIL: 'USOIL', WTI: 'USOIL', CL: 'USOIL', OIL: 'USOIL', CRUDE: 'USOIL',
  UKOIL: 'UKOIL', BRENT: 'UKOIL', BZ: 'UKOIL'
};
const QUICK_PILLS = ['EUR/USD', 'USD/JPY', 'GBP/USD', 'XAU/USD', 'XAG/USD', 'US30', 'NAS100', 'BTC/USD', 'USOIL'];

function resolveSymbol(raw) {
  const clean = (raw || '').trim().toUpperCase();
  const compact = clean.replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  if (ASSET_ALIASES[compact]) {
    const sym = ASSET_ALIASES[compact];
    if (sym === 'XAU/USD') return { type: 'METAL', sym, key: 'XAUUSD', base: 'XAU', quote: 'USD', dp: 2, newsTags: ['XAUUSD', 'USD'], calCurs: ['USD'] };
    if (sym === 'XAG/USD') return { type: 'METAL', sym, key: 'XAGUSD', base: 'XAG', quote: 'USD', dp: 2, newsTags: ['XAGUSD', 'USD'], calCurs: ['USD'] };
    if (sym === 'XAU/EUR') return { type: 'METAL_CROSS', sym, key: 'XAUEUR', base: 'XAU', quote: 'EUR', dp: 2, newsTags: ['XAUUSD', 'EUR'], calCurs: ['EUR', 'USD'] };
    if (sym === 'XAU/JPY') return { type: 'METAL_CROSS', sym, key: 'XAUJPY', base: 'XAU', quote: 'JPY', dp: 0, newsTags: ['XAUUSD', 'JPY'], calCurs: ['JPY', 'USD'] };
    if (['US30', 'NAS100', 'SPX500'].includes(sym)) return { type: 'INDEX', sym, key: sym, base: sym, quote: 'USD', dp: 1, newsTags: [sym, 'USD'], calCurs: ['USD'] };
    if (sym === 'BTC/USD') return { type: 'CRYPTO', sym, key: 'BTCUSD', base: 'BTC', quote: 'USD', dp: 0, newsTags: ['BTCUSD', 'NAS100', 'USD'], calCurs: ['USD'] };
    if (sym === 'USOIL') return { type: 'OIL', sym, key: 'USOIL', base: 'USOIL', quote: 'USD', dp: 2, newsTags: ['USOIL', 'CAD', 'USD'], calCurs: ['USD', 'CAD'] };
    if (sym === 'UKOIL') return { type: 'OIL', sym, key: 'UKOIL', base: 'UKOIL', quote: 'USD', dp: 2, newsTags: ['UKOIL', 'USOIL', 'GBP', 'USD'], calCurs: ['USD', 'GBP'] };
  }
  const letters = clean.replace(/[^A-Z]/g, '');
  if (letters.length === 6) {
    const b = letters.slice(0, 3), q = letters.slice(3, 6);
    if (CUR.includes(b) && CUR.includes(q) && b !== q) {
      return { type: 'FX', sym: `${b}/${q}`, key: b + q, base: b, quote: q, dp: q === 'JPY' ? 3 : 5, newsTags: [b, q], calCurs: [b, q] };
    }
  }
  return null;
}

// ============================================================================
// 4. REUSABLE UI PRIMITIVES & TRANSPARENCY COMPONENTS
// ============================================================================

const Card = ({ title, right, children, style, onLayout }) => (
  <View
    onLayout={onLayout}
    style={{
      backgroundColor: C.card,
      borderRadius: 12,
      padding: 13,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.line,
      ...style
    }}
  >
    {(title || right) && (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        {!!title && <Text style={{ color: C.mut, fontSize: 11, fontWeight: '800', letterSpacing: 0.9 }}>{title.toUpperCase()}</Text>}
        {right || null}
      </View>
    )}
    {children}
  </View>
);

const T = ({ c = C.tx, s = 14, w = '400', children, style, numberOfLines }) => (
  <Text numberOfLines={numberOfLines} style={{ color: c, fontSize: s, fontWeight: w, ...style }}>
    {children}
  </Text>
);

const Row = ({ children, style }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...style }}>
    {children}
  </View>
);

const Btn = ({ t, on, primary, style, small }) => (
  <TouchableOpacity
    onPress={on}
    style={{
      backgroundColor: primary ? C.ac : C.line,
      paddingVertical: small ? 5 : 9,
      paddingHorizontal: small ? 10 : 14,
      borderRadius: 8,
      ...style
    }}
  >
    <T w='700' s={small ? 11 : 13}>{t}</T>
  </TouchableOpacity>
);

const Inp = ({ label, v, set, flex = 1, kb = 'numbers-and-punctuation', ph }) => (
  <View style={{ flex, marginRight: 6 }}>
    {label && <T c={C.mut} s={10} style={{ marginBottom: 2 }}>{label}</T>}
    <TextInput
      value={v}
      onChangeText={set}
      keyboardType={kb}
      placeholder={ph}
      placeholderTextColor={C.mut}
      style={{
        color: C.tx,
        backgroundColor: C.bg,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.line,
        paddingHorizontal: 9,
        paddingVertical: 6,
        fontSize: 13
      }}
    />
  </View>
);

const Pills = ({ opts, val, set, style }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, ...style }}>
    {opts.map(([k, l]) => (
      <TouchableOpacity
        key={String(k)}
        onPress={() => set(k)}
        style={{
          paddingHorizontal: 11,
          paddingVertical: 6,
          borderRadius: 16,
          marginRight: 6,
          backgroundColor: val === k ? C.ac : C.line
        }}
      >
        <T s={12} w='600' c={val === k ? '#fff' : C.tx}>{l}</T>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

const Tag = ({ text, bg = C.line, fg = C.tx, border, style }) => (
  <View
    style={{
      backgroundColor: bg,
      borderWidth: border ? 1 : 0,
      borderColor: border || 'transparent',
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
      marginRight: 5,
      marginBottom: 4,
      ...style
    }}
  >
    <T s={10} w='800' c={fg}>{text}</T>
  </View>
);

const Wait = ({ msg }) => (
  <Card>
    <T c={C.mut}>{msg || 'Loading live market feeds… Pull down or click Refresh (free Render instances may take ~25s to wake up).'}</T>
  </Card>
);

const Note = ({ children }) => <T c={C.mut} s={11} style={{ marginBottom: 10, lineHeight: 16 }}>{children}</T>;

/**
 * Priority 1.1: Source + Observation Date + Explicit Amber STALE badge on every metric
 */
function IndicatorRow({ label, ind, unit = '', decimals = 2, subNote }) {
  const hasVal = ind && okN(ind.value);
  const u = unit || (ind?.unit && ind.unit !== 'idx' ? ind.unit : '');
  const uDisplay = u === '%' ? '%' : u ? ` ${u}` : '';
  const missingText = ind?.unavailableReason || 'Unavailable (Source Timeout)';

  return (
    <View style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: 'rgba(30,42,82,0.55)' }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <T c={C.mut} s={12}>{label}</T>
          {!!subNote && <T c={C.mut} s={10}>{subNote}</T>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Row style={{ justifyContent: 'flex-end' }}>
            {hasVal ? (
              <T s={13} w='700'>{f2(ind.value, decimals)}{uDisplay}</T>
            ) : (
              <T s={11} w='700' c={C.warn}>{missingText}</T>
            )}
            {!!ind?.isNew && (
              <Tag text='NEW' bg={C.upBg} fg={C.upTx} style={{ marginLeft: 6, marginRight: 0, marginBottom: 0 }} />
            )}
            {!!ind?.stale && (
              <Tag text='STALE' bg={C.warnBg} fg={C.warnTx} border={C.warn} style={{ marginLeft: 6, marginRight: 0, marginBottom: 0 }} />
            )}
          </Row>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <T s={10} c={ind?.stale ? C.warn : C.mut}>
              {ind?.source || 'Upstream'}
              {ind?.observationDate ? ` · ${ind.observationDate}` : ''}
              {ind?.stale && ind?.ageDays != null ? ` (${ind.ageDays}d old)` : ''}
            </T>
          </View>
        </View>
      </Row>
    </View>
  );
}

/**
 * Priority 1.6: 5-Tier Signal Badge + Confidence Meter + Conflicting Evidence Callout
 */
function signalColors(sig) {
  if (sig === 'STRONG LONG') return { bg: '#14532d', fg: '#86efac', border: '#22c55e' };
  if (sig === 'LONG') return { bg: '#166534', fg: '#bbf7d0', border: '#22c55e' };
  if (sig === 'STRONG SHORT') return { bg: '#7f1d1d', fg: '#fca5a5', border: '#ef4444' };
  if (sig === 'SHORT') return { bg: '#991b1b', fg: '#fecaca', border: '#ef4444' };
  return { bg: '#1e293b', fg: '#cbd5e1', border: '#64748b' };
}

function SignalBadge({ signal }) {
  const sc = signalColors(signal);
  return (
    <View style={{ backgroundColor: sc.bg, borderWidth: 1, borderColor: sc.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
      <T s={10} w='800' c={sc.fg}>{signal || 'NEUTRAL / NO TRADE'}</T>
    </View>
  );
}

function ConfBar({ pctVal = 0 }) {
  const v = Math.max(0, Math.min(100, Math.round(pctVal)));
  const fill = v >= 72 ? C.up : v >= 52 ? C.ac : C.warn;
  return (
    <View style={{ marginTop: 6 }}>
      <Row style={{ marginBottom: 3 }}>
        <T s={10} c={C.mut} w='700'>SIGNAL CONFIDENCE</T>
        <T s={11} w='800' c={fill}>{v}%</T>
      </Row>
      <View style={{ height: 6, backgroundColor: C.bg, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
        <View style={{ width: `${v}%`, height: '100%', backgroundColor: fill, borderRadius: 4 }} />
      </View>
    </View>
  );
}

function ConflictBox({ conflicts = [], neutralReason }) {
  if (!conflicts?.length && !neutralReason) return null;
  return (
    <View style={{ backgroundColor: '#2c1a06', borderWidth: 1, borderColor: C.warn, borderRadius: 8, padding: 8, marginTop: 8 }}>
      <T s={10} w='800' c={C.warnTx}>⚠ {conflicts?.length ? 'CONFLICTING EVIDENCE' : 'NEUTRAL GUARDRAIL'}</T>
      {!!neutralReason && <T s={11} c='#fde68a' style={{ marginTop: 3 }}>• {neutralReason}</T>}
      {(conflicts || []).map((c, idx) => (
        <T key={idx} s={11} c='#fde68a' style={{ marginTop: 2 }}>• {c}</T>
      ))}
    </View>
  );
}

/**
 * Priority 1.1: Global Data Freshness Status Bar (top of dashboard)
 */
function FreshnessBar({ intel, fx, dash, onOpenAudit }) {
  const f = intel?.freshness || fx?.freshness || dash?.freshness;
  if (!f) return null;
  const staleN = f.staleCount || 0;
  const unavailN = f.unavailableCount || 0;
  const status = f.status || (staleN || unavailN ? 'PARTIAL_STALE' : 'FRESH');
  const bg = status === 'FRESH' ? '#0d2b1d' : status === 'DEGRADED' ? '#3b0d0d' : '#2c1a06';
  const border = status === 'FRESH' ? '#166534' : status === 'DEGRADED' ? '#7f1d1d' : '#92400e';
  const accent = status === 'FRESH' ? C.up : status === 'DEGRADED' ? C.dn : C.warn;

  return (
    <TouchableOpacity
      onPress={onOpenAudit}
      style={{
        backgroundColor: bg,
        borderBottomWidth: 1,
        borderBottomColor: border,
        paddingHorizontal: 14,
        paddingVertical: 6,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, marginRight: 6 }} />
        <T s={11} w='800' c={accent}>DATA FRESHNESS: {status.replace('_', ' ')}</T>
        <T s={11} c={C.tx} style={{ marginLeft: 10 }}>
          {staleN > 0 ? `⚠ ${staleN} STALE (>45d mo / >105d qtr)` : 'All tracked releases within freshness window'}
          {unavailN > 0 ? ` · ${unavailN} Unavailable` : ''}
        </T>
      </View>
      <T s={10} w='700' c={C.ac}>Inspect audit ↗</T>
    </TouchableOpacity>
  );
}

function LineChart({ data, color, h = 140 }) {
  const [w, setW] = useState(0);
  if (!data?.length) return null;
  const lo = Math.min(...data), hi = Math.max(...data);
  const X = i => i * (w / Math.max(1, data.length - 1));
  const Y = v => h - 6 - ((v - lo) / ((hi - lo) || 1)) * (h - 12);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: h, backgroundColor: C.bg, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
      {w > 0 && data.slice(1).map((v, i) => {
        const x1 = X(i), y1 = Y(data[i]), x2 = X(i + 1), y2 = Y(v), len = Math.hypot(x2 - x1, y2 - y1);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (x1 + x2) / 2 - len / 2,
              top: (y1 + y2) / 2 - 1,
              width: len + 1,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }]
            }}
          />
        );
      })}
    </View>
  );
}

// ============================================================================
// 5. MODALS: SCORE BREAKDOWN (P1.4), STRENGTH METHODOLOGY (P1.3), FRESHNESS AUDIT (P1.1)
// ============================================================================

const FACTOR_LABELS = {
  rateDiff: 'Interest Rate Differential',
  realYield: 'Real Yield (Nominal − CPI)',
  inflationTrend: 'Inflation Trend & Core',
  growthMomentum: 'Growth Momentum (GDP/PMI)',
  laborHealth: 'Labor Market Health',
  centralBankStance: 'Central Bank Guidance',
  cotPositioning: 'Institutional COT Positioning'
};

function ScoreBreakdownModal({ currency, fx, onClose }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  if (!currency) return null;
  const sc = fx?.scores?.[currency];

  return (
    <Modal transparent animationType='slide' visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ width: wide ? 520 : '100%', height: '100%', backgroundColor: C.bg, borderLeftWidth: 1, borderLeftColor: C.line, paddingTop: Platform.OS === 'android' ? 28 : 10 }}>
          <Row style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View>
              <T s={19} w='800'>{currency} Macro Score Breakdown</T>
              <T s={11} c={C.mut}>{BANKS[currency]?.[0]} · Transparent 7-Factor Attribution</T>
            </View>
            <TouchableOpacity onPress={onClose}><T s={22}>✕</T></TouchableOpacity>
          </Row>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            {!sc ? (
              <Card><T c={C.mut}>Detailed server score breakdown unavailable yet — pull to refresh.</T></Card>
            ) : (
              <>
                <Card style={{ borderColor: col(sc.totalScore) }}>
                  <Row>
                    <View>
                      <T s={11} c={C.mut} w='700'>TOTAL COMPOSITE SCORE</T>
                      <T s={28} w='800' c={col(sc.totalScore)}>{signedF2(sc.totalScore)}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Tag text={`${sc.inputsAvailable}/${sc.totalInputs} Factors Active`} bg={C.line} fg={C.tx} />
                      <T s={11} c={C.mut} style={{ marginTop: 4 }}>Completeness: {sc.dataCompletenessPct}%</T>
                    </View>
                  </Row>
                  <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
                    <T s={10} c={C.mut} w='700'>EXACT FORMULA</T>
                    <T s={11} c={C.tx} style={{ marginTop: 2, lineHeight: 16 }}>{sc.formula}</T>
                  </View>
                </Card>

                <Card title='Factor-by-Factor Contributions'>
                  {Object.entries(sc.contributions || {}).map(([k, f]) => {
                    const barW = Math.min(100, Math.abs(f.contribution || 0) / 2 * 100);
                    return (
                      <View key={k} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line }}>
                        <Row>
                          <View style={{ flex: 1 }}>
                            <T s={13} w='700'>{FACTOR_LABELS[k] || k}</T>
                            <T s={10} c={f.stale ? C.warn : C.mut}>
                              Weight {f.weightPct}% · Raw: {f.available ? `${f.rawValue ?? '—'}${f.unit ? ' ' + f.unit : ''}` : 'Unavailable'} · {f.source}{f.observationDate ? ` (${f.observationDate})` : ''}{f.stale ? ' · STALE' : ''}
                            </T>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <T s={15} w='800' c={col(f.contribution)}>{signedF2(f.contribution, 3)} pts</T>
                            <T s={10} c={C.mut}>z = {f.normalizedScore != null ? signedF2(f.normalizedScore) : '—'}</T>
                          </View>
                        </Row>
                        <View style={{ height: 5, backgroundColor: C.bg, borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                          <View style={{ width: `${barW}%`, height: '100%', backgroundColor: f.contribution >= 0 ? C.up : C.dn }} />
                        </View>
                        <T s={11} c={C.mut} style={{ marginTop: 5 }}>{f.rationale}</T>
                      </View>
                    );
                  })}
                </Card>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StrengthMethodModal({ methodology, onClose }) {
  if (!methodology) return null;
  return (
    <Modal transparent animationType='fade' visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 520, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.ac, padding: 16 }}>
          <Row style={{ marginBottom: 10 }}>
            <T s={17} w='800'>Base/Quote-Adjusted Currency Strength</T>
            <TouchableOpacity onPress={onClose}><T s={20}>✕</T></TouchableOpacity>
          </Row>
          <T s={11} c={C.mut} w='700'>EXACT FORMULA</T>
          <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 10, marginVertical: 6, borderWidth: 1, borderColor: C.line }}>
            <T s={12} c={C.tx} style={{ lineHeight: 18 }}>{methodology.formula}</T>
          </View>
          <T s={12} style={{ marginTop: 6, lineHeight: 18 }}>
            • Every G8 currency is evaluated equally across all 7 counterpart crosses ({methodology.crossCount || 28} total pairs).
          </T>
          <T s={12} style={{ marginTop: 4, lineHeight: 18 }}>
            • Quote-side inversion: when calculating JPY from USD/JPY, the pair is explicitly inverted to JPY/USD so a falling USD/JPY properly registers as JPY strength.
          </T>
          <T s={12} style={{ marginTop: 4, lineHeight: 18 }}>
            • Timeframes: 1D (1d), 1W (5d), 1M (21d), 3M (63d) trading sessions · As of {methodology.asOfDate} ({methodology.source}).
          </T>
          <Btn primary t='Got it' on={onClose} style={{ alignSelf: 'flex-end', marginTop: 14 }} />
        </View>
      </View>
    </Modal>
  );
}

function FreshnessAuditModal({ intel, fx, dash, onClose }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const f = intel?.freshness || fx?.freshness || dash?.freshness;
  const staleList = f?.staleWarnings || f?.staleItems || [];
  const unavailList = f?.unavailableWarnings || f?.unavailableItems || [];

  return (
    <Modal transparent animationType='slide' visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ width: wide ? 500 : '100%', height: '100%', backgroundColor: C.bg, borderLeftWidth: 1, borderLeftColor: C.line, paddingTop: Platform.OS === 'android' ? 28 : 10 }}>
          <Row style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View>
              <T s={18} w='800'>Data Freshness & Integrity Audit</T>
              <T s={11} c={C.mut}>Strict rules: Monthly &gt;45d = STALE · Quarterly &gt;105d = STALE</T>
            </View>
            <TouchableOpacity onPress={onClose}><T s={22}>✕</T></TouchableOpacity>
          </Row>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            <Card title='Summary'>
              <Row><T c={C.mut}>Overall Status</T><T w='800' c={f?.status === 'FRESH' ? C.up : C.warn}>{f?.status || 'UNKNOWN'}</T></Row>
              <Row style={{ marginTop: 4 }}><T c={C.mut}>Stale Indicators</T><T w='700' c={staleList.length ? C.warn : C.up}>{staleList.length}</T></Row>
              <Row style={{ marginTop: 4 }}><T c={C.mut}>Unavailable / Timeout</T><T w='700' c={unavailList.length ? C.dn : C.up}>{unavailList.length}</T></Row>
              <Row style={{ marginTop: 4 }}><T c={C.mut}>Last Checked (IST)</T><T s={12}>{fmtIstTime(f?.checkedAt)}</T></Row>
            </Card>

            <Card title={`Stale Indicators (${staleList.length})`}>
              {!staleList.length ? (
                <T c={C.up} s={12}>✓ No indicators exceed stale thresholds.</T>
              ) : staleList.map((it, idx) => (
                <View key={idx} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
                  <Row>
                    <T s={12} w='700'>{it.key}</T>
                    <Tag text='STALE' bg={C.warnBg} fg={C.warnTx} border={C.warn} />
                  </Row>
                  <T s={11} c={C.mut}>
                    Source: {it.source} · Obs: {it.observationDate} · Age: {it.ageDays}d (limit {it.thresholdDays}d)
                  </T>
                </View>
              ))}
            </Card>

            <Card title={`Unavailable / Pending Indicators (${unavailList.length})`}>
              {!unavailList.length ? (
                <T c={C.up} s={12}>✓ All core upstream feeds responded.</T>
              ) : unavailList.map((it, idx) => (
                <View key={idx} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
                  <Row>
                    <T s={12} w='700'>{it.key}</T>
                    <T s={11} c={C.dn} w='700'>{it.reason}</T>
                  </Row>
                  <T s={10} c={C.mut}>Source: {it.source}</T>
                </View>
              ))}
            </Card>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// 6. SESSION BAR & HIGH-IMPACT COUNTDOWN BANNER (IST)
// ============================================================================

function SessionBar() {
  const now = useNow();
  const i = ist(now);
  const mk = Math.floor(now / 6e4);
  const no = useMemo(() => nextOpen(mk * 6e4), [mk]);
  const on = SESS.map(s => actSess(s, now));
  const ov = on[1] && on[2];

  const Pl = ({ t, live, hi }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: live ? C.up : C.line, backgroundColor: hi && live ? '#14532d' : 'transparent', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6, marginVertical: 2 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live ? C.up : C.mut, marginRight: 5 }} />
      <T s={10} w='700' c={live ? C.up : C.mut}>{t}</T>
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 5, backgroundColor: '#0d1636', borderBottomWidth: 1, borderBottomColor: C.line }}>
      <T s={13} w='800' style={{ marginRight: 10 }}>{p2(i.h)}:{p2(i.m)}:{p2(i.s)} IST</T>
      {SESS.map((s, k) => <Pl key={s[0]} live={on[k]} t={`${s[0]} ${hm(s[1])}–${hm(s[2])} ${on[k] ? 'OPEN' : 'CLOSED'}`} />)}
      <Pl hi live={ov} t={`London–NY overlap 18:30–22:30 ${ov ? 'ACTIVE' : '—'}`} />
      {!!no && <T c={C.mut} s={11}>{closedWk(i) ? 'Weekend · ' : ''}Next open: <T s={11} w='700'>{no.name}</T> in {fmtCd(no.t - now)}</T>}
    </View>
  );
}

function NextHigh({ cal }) {
  const now = useNow();
  if (!cal) return null;
  const nx = (cal.items || []).filter(e => e.impact === 'High' && new Date(e.timestamp) > now)[0];
  return (
    <View style={{ backgroundColor: '#3b0d0d', borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 10, padding: 10, marginBottom: 12 }}>
      {nx ? (
        <T s={13} w='700'>
          🔴 Next High-Impact: {nx.currency} {nx.title} in {fmtCd(new Date(nx.timestamp) - now)}{' '}
          <T c='#fecaca' w='400' s={12}>· Forecast {nx.forecast || '–'} vs Prev {nx.previous || '–'}</T>
        </T>
      ) : (
        <T c={C.mut} s={13}>No further high-impact releases on this week's calendar.</T>
      )}
    </View>
  );
}

// ============================================================================
// 7. OVERVIEW & CONSOLIDATED MACRO EXECUTIVE DASHBOARD (PRIORITY 1, 3, 5)
// ============================================================================

function Overview({ A, fx, intel, gold, onOpenScore, onOpenAudit, onNavigate }) {
  const [strTf, setStrTf] = useState(21);
  const [corrWin, setCorrWin] = useState('60D');
  const [methodOpen, setMethodOpen] = useState(false);

  if (!A) return <Wait />;

  const exec = intel?.executiveSummary;
  const regime = intel?.macroRegime;
  const signals = intel?.pairSignals || [];
  const topTrades = signals.slice(0, 3);
  const strMap = A.str[strTf] || A.str[21];
  const sortedCur = CUR.slice().sort((a, b) => (strMap[b] || 0) - (strMap[a] || 0));
  const maxAbs = Math.max(...CUR.map(c => Math.abs(strMap[c] || 0))) || 1;
  const corrMatrix = A.correlations?.[corrWin] || A.corr;
  const alerts = A.breakdownAlerts || [];

  const isBreakdownCell = (a, b) => alerts.some(al => (al.pairA === a && al.pairB === b) || (al.pairA === b && al.pairB === a));

  return (
    <>
      <T s={24} w='800'>Macro Executive Dashboard</T>
      <Note>
        Consolidated macro regime, clean divergent setups, freshness diagnostics, and calibrated multi-factor signals (ECB reference rates to {A.date}). Click any currency score to inspect its full 7-factor breakdown.
      </Note>

      {/* PRIORITY 5: Consolidated Executive Dashboard Strip */}
      <Card title='Executive Macro Snapshot' style={{ borderColor: C.ac, backgroundColor: '#0e193d' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 200, backgroundColor: C.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.line }}>
            <T s={10} c={C.mut} w='800'>GLOBAL MACRO REGIME</T>
            <T s={17} w='800' c={C.ac} style={{ marginTop: 3 }}>{exec?.globalRegime || 'Calculating…'}</T>
            {exec?.regimeConfidencePct != null && (
              <T s={11} c={C.up} w='700' style={{ marginTop: 2 }}>Confidence {exec.regimeConfidencePct}%</T>
            )}
            <T s={11} c={C.mut} style={{ marginTop: 4 }}>{exec?.regimePlaybook || 'Loading macro regime playbook…'}</T>
          </View>

          <View style={{ flex: 1, minWidth: 200, backgroundColor: C.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.line }}>
            <T s={10} c={C.mut} w='800'>TOP CLEAN DIVERGENT PAIRS</T>
            {exec?.topDivergentPairs?.length ? (
              exec.topDivergentPairs.slice(0, 3).map(p => (
                <Row key={p.pair} style={{ marginTop: 5 }}>
                  <T s={12} w='800'>{p.pair}</T>
                  <SignalBadge signal={p.signal} />
                  <T s={11} c={C.mut}>{p.confidencePct}%</T>
                </Row>
              ))
            ) : (
              <T s={11} c={C.mut} style={{ marginTop: 6 }}>No clean non-crowded pair currently exceeds the ±1.50 spread threshold.</T>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 200, backgroundColor: C.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.line }}>
            <T s={10} c={C.mut} w='800'>UNIFIED GOLD &amp; RISK ALERTS</T>
            <Row style={{ marginTop: 4 }}>
              <T s={12} c={C.mut}>XAU/USD Spot</T>
              <T s={14} w='800' c={C.warn}>{gold?.price != null ? `$${f2(gold.price, 2)}` : (gold?.unavailableReason || 'Unavailable')}</T>
            </Row>
            <T s={10} c={gold?.stale ? C.warn : C.mut}>
              {gold?.source} · {gold?.observationDate || '—'}{gold?.stale ? ' · STALE' : ''}
            </T>
            <Row style={{ marginTop: 8 }}>
              <TouchableOpacity onPress={onOpenAudit}>
                <Tag text={`${exec?.staleDataWarningsCount ?? 0} Stale · ${exec?.unavailableDataCount ?? 0} Unavail`} bg={exec?.staleDataWarningsCount ? C.warnBg : C.upBg} fg={exec?.staleDataWarningsCount ? C.warnTx : C.upTx} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onNavigate(9)}>
                <Tag text={`${exec?.invalidationAlertsCount ?? 0} Invalidation Alerts`} bg={exec?.invalidationAlertsCount ? C.dnBg : C.line} fg={exec?.invalidationAlertsCount ? C.dnTx : C.mut} />
              </TouchableOpacity>
            </Row>
          </View>
        </View>

        {!!exec?.upcomingHighImpact?.length && (
          <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
            <Row style={{ marginBottom: 4 }}>
              <T s={10} c={C.mut} w='800'>HIGH-IMPACT UPCOMING CATALYSTS (IST)</T>
              <TouchableOpacity onPress={() => onNavigate(7)}><T s={11} c={C.ac} w='700'>Full Calendar →</T></TouchableOpacity>
            </Row>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {exec.upcomingHighImpact.slice(0, 6).map((e, idx) => (
                <View key={idx} style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, marginRight: 8 }}>
                  <T s={11} w='800' c='#fecaca'>🔴 {e.currency} · {e.title}</T>
                  <T s={10} c={C.mut}>{e.date} {e.time} IST · Fcst {e.forecast || '—'}</T>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </Card>

      {/* PRIORITY 1.4: Clickable G8 Macro Score Strip */}
      <Card title='G8 Macro Scores (Tap any currency for 7-factor breakdown)'>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {CUR.map(c => {
            const sc = fx?.scores?.[c];
            const mom = intel?.macroMomentum?.[c];
            return (
              <TouchableOpacity
                key={c}
                onPress={() => onOpenScore(c)}
                style={{ width: '25%', minWidth: 82, padding: 4 }}
              >
                <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center' }}>
                  <T s={12} w='800'>{c}</T>
                  <T s={16} w='800' c={col(sc?.totalScore || 0)} style={{ marginVertical: 2 }}>
                    {sc ? signedF2(sc.totalScore) : '—'}
                  </T>
                  <T s={9} c={mom?.direction === 'Improving' ? C.up : mom?.direction === 'Deteriorating' ? C.dn : C.mut} w='700'>
                    {mom?.direction === 'Improving' ? '▲ Improving' : mom?.direction === 'Deteriorating' ? '▼ Cooling' : '• Stable'}
                  </T>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* PRIORITY 1.6: Calibrated Top Trade Setups */}
      <T s={17} w='800' style={{ marginBottom: 8 }}>Top Calibrated FX Setups</T>
      {topTrades.map(p => {
        const sr = A.series(p.base, p.quote);
        const lo = Math.min(...sr), hi = Math.max(...sr);
        return (
          <Card key={p.pair}>
            <Row style={{ marginBottom: 6 }}>
              <Row style={{ justifyContent: 'flex-start' }}>
                <T s={18} w='800' style={{ marginRight: 8 }}>{p.pair}</T>
                <SignalBadge signal={p.signal} />
              </Row>
              <T s={11} c={C.mut}>Spread <T w='800' c={col(p.spread)}>{signedF2(p.spread)}</T></T>
            </Row>

            <Row style={{ alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <T s={24} w='800'>{f2(p.spot, p.quote === 'JPY' ? 3 : 5)}</T>
                <T c={C.mut} s={11}>
                  1D <T c={col(p.d1)} s={11}>{pct(p.d1)}</T> · 1M <T c={col(p.m1)} s={11}>{pct(p.m1)}</T> · Real Diff <T c={col(p.realYieldDiff)} s={11}>{p.realYieldDiff != null ? signedF2(p.realYieldDiff) + '%' : '—'}</T>
                </T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 40, width: '40%' }}>
                {sr.map((v, i) => (
                  <View key={i} style={{ flex: 1, marginRight: 1, height: 4 + ((v - lo) / ((hi - lo) || 1)) * 36, backgroundColor: C.ac, opacity: 0.8 }} />
                ))}
              </View>
            </Row>

            <ConfBar pctVal={p.confidencePct} />
            <ConflictBox conflicts={p.conflicts} neutralReason={p.neutralReason} />

            <Row style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <Row style={{ justifyContent: 'flex-start' }}>
                <TouchableOpacity onPress={() => onOpenScore(p.base)} style={{ marginRight: 10 }}>
                  <T s={11} c={C.ac} w='700'>{p.base} breakdown ↗</T>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onOpenScore(p.quote)}>
                  <T s={11} c={C.ac} w='700'>{p.quote} breakdown ↗</T>
                </TouchableOpacity>
              </Row>
              <T s={10} c={C.mut}>Calc: {fmtIstTime(p.lastCalculated)}</T>
            </Row>
          </Card>
        );
      })}

      {/* PRIORITY 1.3: Base/Quote-Adjusted Currency Strength */}
      <Card
        title='Base/Quote-Adjusted Currency Strength (28 G8 Crosses)'
        right={
          <TouchableOpacity onPress={() => setMethodOpen(true)} style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.ac, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
            <T s={10} w='800' c={C.ac}>ⓘ Methodology</T>
          </TouchableOpacity>
        }
      >
        <Pills opts={[[1, '1D'], [5, '1W'], [21, '1M'], [63, '3M']]} val={strTf} set={setStrTf} />
        {sortedCur.map(c => {
          const val = strMap[c] || 0;
          return (
            <TouchableOpacity key={c} onPress={() => onOpenScore(c)}>
              <Row style={{ marginBottom: 6 }}>
                <T w='800' style={{ width: 42 }}>{c}</T>
                <View style={{ flex: 1, height: 14, backgroundColor: C.bg, borderRadius: 4, marginHorizontal: 8 }}>
                  <View style={{ width: `${(Math.abs(val) / maxAbs) * 100}%`, height: 14, borderRadius: 4, backgroundColor: val >= 0 ? C.up : C.dn }} />
                </View>
                <T c={col(val)} w='700' style={{ width: 62, textAlign: 'right' }}>{signedF2(val)}%</T>
              </Row>
            </TouchableOpacity>
          );
        })}
        <T s={10} c={C.mut} style={{ marginTop: 4 }}>
          Source: {A.strengthMethodology?.source} · As of {A.strengthMethodology?.asOfDate} · Quote-side crosses explicitly inverted.
        </T>
      </Card>

      {/* PRIORITY 3.1: Multi-Horizon 30D/60D/90D Currency Correlations + Breakdown Alerts */}
      <Card
        title={`${corrWin} Rolling Currency Return Correlations`}
        right={
          <View style={{ flexDirection: 'row' }}>
            {['30D', '60D', '90D'].map(w => (
              <TouchableOpacity
                key={w}
                onPress={() => setCorrWin(w)}
                style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 4, backgroundColor: corrWin === w ? C.ac : C.bg, borderWidth: 1, borderColor: corrWin === w ? C.ac : C.line }}
              >
                <T s={10} w='800' c={corrWin === w ? '#fff' : C.mut}>{w}</T>
              </TouchableOpacity>
            ))}
          </View>
        }
      >
        {!!alerts.length && (
          <View style={{ backgroundColor: '#2c1a06', borderWidth: 1, borderColor: C.warn, borderRadius: 8, padding: 8, marginBottom: 10 }}>
            <T s={11} w='800' c={C.warnTx}>⚡ CORRELATION BREAKDOWN ALERTS (|30D − 90D| &gt; 0.35)</T>
            {alerts.slice(0, 4).map((al, idx) => (
              <T key={idx} s={11} c='#fde68a' style={{ marginTop: 3 }}>• {al.alertText}</T>
            ))}
          </View>
        )}

        <Row>
          <View style={{ width: 34 }} />
          {CUR.map(c => <T key={c} c={C.mut} s={9} w='700' style={{ flex: 1, textAlign: 'center' }}>{c}</T>)}
        </Row>
        {CUR.map((a, i) => (
          <Row key={a}>
            <T c={C.mut} s={9} w='700' style={{ width: 34 }}>{a}</T>
            {CUR.map((b, j) => {
              const v = corrMatrix?.[i]?.[j] ?? 0;
              const brk = a !== b && isBreakdownCell(a, b);
              return (
                <View
                  key={b}
                  style={{
                    flex: 1,
                    height: 32,
                    margin: 0.5,
                    justifyContent: 'center',
                    borderWidth: brk ? 1.5 : 0,
                    borderColor: brk ? C.warn : 'transparent',
                    backgroundColor: v > 0 ? `rgba(59,130,246,${Math.abs(v)})` : `rgba(239,68,68,${Math.abs(v)})`
                  }}
                >
                  <T s={9} w={brk ? '800' : '400'} style={{ textAlign: 'center' }}>{Number(v).toFixed(2)}</T>
                </View>
              );
            })}
          </Row>
        ))}
        <T s={10} c={C.mut} style={{ marginTop: 6 }}>
          Amber bordered cells indicate pairs where the 30D rolling correlation has diverged by &gt;0.35 from the 90D baseline.
        </T>
      </Card>

      {methodOpen && <StrengthMethodModal methodology={A.strengthMethodology} onClose={() => setMethodOpen(false)} />}
    </>
  );
}

// ============================================================================
// 8. SWING-TRADING INTELLIGENCE SCREEN (PRIORITY 4)
// ============================================================================

function SwingIntel({ intel, onOpenScore }) {
  const [cleanOnly, setCleanOnly] = useState(true);
  if (!intel) return <Wait msg='Loading Swing-Trading Intelligence (/api/intelligence)…' />;

  const { macroRegime, divergenceScanner, macroMomentum, surpriseTracker, invalidationAlerts, backtest, currencyMultiTimeframe, safeHavenFlows } = intel;
  const divList = cleanOnly ? (divergenceScanner?.cleanTopDivergent || []) : (divergenceScanner?.allRanked || []).slice(0, 12);

  const biasColor = b => (b === 'Bullish' ? C.up : b === 'Bearish' ? C.dn : C.mut);

  return (
    <>
      <T s={24} w='800'>Swing-Trading Intelligence</T>
      <Note>
        Macro regime classification, clean divergence scanning with CFTC COT crowding filter, 30-day macro momentum, priced-in vs. surprise tracker, invalidation alerts, multi-timeframe biases, and rolling 30D/60D score backtest. Last calculated {fmtIstTime(intel.calculatedAt)}.
      </Note>

      {/* 4.1 Macro Regime Detection */}
      <Card title='1. Global Macro Regime Detection' style={{ borderColor: C.ac }}>
        <Row style={{ marginBottom: 6 }}>
          <T s={20} w='800' c={C.ac}>{macroRegime?.regime}</T>
          <Tag text={`Confidence ${macroRegime?.confidencePct ?? '—'}%`} bg={C.acBg} fg='#fff' />
        </Row>
        {(macroRegime?.criteriaMatched || []).map((c, i) => (
          <T key={i} s={12} style={{ marginTop: 3 }}>• {c}</T>
        ))}
        <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: C.line }}>
          <T s={10} c={C.mut} w='800'>SWING PLAYBOOK</T>
          <T s={12} c={C.upTx} style={{ marginTop: 3 }}>{macroRegime?.playbook}</T>
        </View>
        <Row style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <T s={11} c={C.mut}>Avg G8 GDP: <T w='700'>{f2(macroRegime?.metrics?.globalGrowthAvg)}%</T></T>
          <T s={11} c={C.mut}>Avg G8 CPI: <T w='700'>{f2(macroRegime?.metrics?.globalInflationAvg)}%</T></T>
          <T s={11} c={C.mut}>VIX: <T w='700'>{f2(macroRegime?.metrics?.vix)}</T></T>
          <T s={11} c={C.mut}>Safe-Haven Flow: <T w='700' c={C.warn}>{safeHavenFlows?.regime}</T></T>
        </Row>
      </Card>

      {/* 4.5 Trade Thesis Invalidation Alerts */}
      <Card title={`2. Trade Thesis Invalidation Alerts (${invalidationAlerts?.length || 0})`} style={invalidationAlerts?.length ? { borderColor: C.dn } : undefined}>
        {!invalidationAlerts?.length ? (
          <T s={12} c={C.up}>✓ No active high-conviction FX trade theses were invalidated by recent 72h surprises, central bank shifts, or correlation breakdowns.</T>
        ) : invalidationAlerts.map((a, idx) => (
          <View key={idx} style={{ backgroundColor: '#2a0d14', borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 8, padding: 9, marginBottom: 7 }}>
            <Row>
              <T s={13} w='800' c='#fecaca'>🚨 {a.pair} ({a.bias})</T>
              <Tag text={a.triggerType} bg={C.dnBg} fg={C.dnTx} />
            </Row>
            <T s={12} style={{ marginTop: 4 }}>{a.reason}</T>
            <T s={10} c={C.mut} style={{ marginTop: 3 }}>{fmtIstTime(a.timestamp)}</T>
          </View>
        ))}
      </Card>

      {/* 4.2 Currency Divergence Scanner */}
      <Card
        title='3. Currency Divergence Scanner (Macro + Real Yield + Momentum)'
        right={
          <TouchableOpacity onPress={() => setCleanOnly(v => !v)} style={{ backgroundColor: cleanOnly ? C.upBg : C.line, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <T s={10} w='800' c={cleanOnly ? C.upTx : C.tx}>{cleanOnly ? 'Filter: Clean (Ex-Crowded COT)' : 'Showing: All 28 Pairs'}</T>
          </TouchableOpacity>
        }
      >
        {!divList.length ? (
          <T s={12} c={C.mut}>No pairs currently meet the clean non-crowded divergence criteria. Toggle filter to view all 28 pairs.</T>
        ) : divList.map(p => (
          <View key={p.pair} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Row>
              <Row style={{ justifyContent: 'flex-start' }}>
                <T s={15} w='800' style={{ marginRight: 8 }}>{p.pair}</T>
                <SignalBadge signal={p.signal} />
                {p.crowdedCotExtreme && <Tag text='CROWDED COT' bg={C.warnBg} fg={C.warnTx} style={{ marginLeft: 6 }} />}
              </Row>
              <T s={12} w='800' c={C.ac}>Div {f2(p.divergenceScore)}</T>
            </Row>
            <Row style={{ marginTop: 4 }}>
              <T s={11} c={C.mut}>Macro {signedF2(p.spread)}</T>
              <T s={11} c={C.mut}>RealYld {p.realYieldDiff != null ? signedF2(p.realYieldDiff) + '%' : '—'}</T>
              <T s={11} c={C.mut}>1M Mom {signedF2(p.momentumSpread1M)}%</T>
              <T s={11} c={C.mut}>Conf {p.confidencePct}%</T>
            </Row>
          </View>
        ))}
        {!!divergenceScanner?.filteredCrowdedPairs?.length && (
          <T s={10} c={C.warn} style={{ marginTop: 8 }}>
            Filtered crowded COT extremes: {divergenceScanner.filteredCrowdedPairs.map(x => x.pair).join(', ')}.
          </T>
        )}
      </Card>

      {/* 4.3 Macro Momentum Score (30D) */}
      <Card title='4. 30-Day Macro Momentum Score (Improving vs. Deteriorating)'>
        {CUR.map(c => {
          const m = macroMomentum?.[c];
          if (!m) return null;
          const dc = m.direction === 'Improving' ? C.up : m.direction === 'Deteriorating' ? C.dn : C.mut;
          return (
            <TouchableOpacity key={c} onPress={() => onOpenScore(c)} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <Row>
                <Row style={{ justifyContent: 'flex-start' }}>
                  <T s={14} w='800' style={{ width: 42 }}>{c}</T>
                  <Tag text={m.direction.toUpperCase()} bg={m.direction === 'Improving' ? C.upBg : m.direction === 'Deteriorating' ? C.dnBg : C.line} fg={m.direction === 'Improving' ? C.upTx : m.direction === 'Deteriorating' ? C.dnTx : C.tx} />
                </Row>
                <T s={12} w='800' c={dc}>30D Δ {signedF2(m.delta30d)} · Score {signedF2(m.currentScore)}</T>
              </Row>
              <T s={11} c={C.mut} style={{ marginTop: 2 }}>{(m.drivers || []).join(' · ')}</T>
            </TouchableOpacity>
          );
        })}
      </Card>

      {/* 4.4 Priced-In vs. Surprise Tracker */}
      <Card title='5. Priced-In vs. Economic Surprise Tracker (30D Releases)'>
        {CUR.map(c => {
          const s = surpriseTracker?.[c];
          if (!s) return null;
          const isWarn = /Over-Priced/i.test(s.pricingState);
          const isOpp = /Under-Priced/i.test(s.pricingState);
          return (
            <View key={c} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <Row>
                <T s={14} w='800'>{c}</T>
                <Tag
                  text={s.pricingState}
                  bg={isWarn ? C.warnBg : isOpp ? C.upBg : C.line}
                  fg={isWarn ? C.warnTx : isOpp ? C.upTx : C.tx}
                />
              </Row>
              <Row style={{ marginTop: 3 }}>
                <T s={11} c={C.mut}>Releases: {s.releasesAnalyzed} (<T c={C.up} s={11}>{s.beats}B</T> / <T c={C.dn} s={11}>{s.misses}M</T>)</T>
                <T s={11} c={C.mut}>1M Spot: <T c={col(s.spotMove1MPct)} s={11} w='700'>{pctRaw(s.spotMove1MPct)}</T></T>
                <T s={11} c={C.mut}>Next Mtg: <T s={11} w='700'>{s.impliedNextMeetingBps >= 0 ? '+' : ''}{s.impliedNextMeetingBps} bps</T></T>
              </Row>
              <T s={11} c={C.mut} style={{ marginTop: 3 }}>{s.note}</T>
            </View>
          );
        })}
      </Card>

      {/* 4.7 Multi-Timeframe Fundamental Outlook */}
      <Card title='6. Multi-Timeframe Fundamental Outlook'>
        <Row style={{ paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <T s={10} c={C.mut} w='800' style={{ width: 42 }}>CCY</T>
          <T s={10} c={C.mut} w='800' style={{ flex: 1, textAlign: 'center' }}>ST (1–2W)</T>
          <T s={10} c={C.mut} w='800' style={{ flex: 1, textAlign: 'center' }}>MT (1–3M)</T>
          <T s={10} c={C.mut} w='800' style={{ flex: 1, textAlign: 'center' }}>LT (3–12M)</T>
        </Row>
        {CUR.map(c => {
          const m = currencyMultiTimeframe?.[c];
          if (!m) return null;
          return (
            <TouchableOpacity key={c} onPress={() => onOpenScore(c)}>
              <Row style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(30,42,82,0.5)' }}>
                <T s={13} w='800' style={{ width: 42 }}>{c}</T>
                <T s={12} w='700' c={biasColor(m.shortTerm.bias)} style={{ flex: 1, textAlign: 'center' }}>{m.shortTerm.bias}</T>
                <T s={12} w='700' c={biasColor(m.mediumTerm.bias)} style={{ flex: 1, textAlign: 'center' }}>{m.mediumTerm.bias}</T>
                <T s={12} w='700' c={biasColor(m.longTerm.bias)} style={{ flex: 1, textAlign: 'center' }}>{m.longTerm.bias}</T>
              </Row>
            </TouchableOpacity>
          );
        })}
        <T s={10} c={C.mut} style={{ marginTop: 6 }}>
          ST = Data Surprises + Momentum · MT = Rate Path + CFTC Positioning · LT = Real Yields + GDP Growth.
        </T>
      </Card>

      {/* 4.6 Historical Score Backtest Summary */}
      <Card title='7. Historical Score Backtest Summary (Rolling 30D / 60D)'>
        {!backtest?.available ? (
          <T s={12} c={C.mut}>{backtest?.reason || 'Backtest unavailable.'}</T>
        ) : (
          <>
            <Row style={{ gap: 10 }}>
              {[['30D Forward (21 TD)', backtest.window30D], ['60D Forward (42 TD)', backtest.window60D]].map(([lbl, w]) => (
                <View key={lbl} style={{ flex: 1, backgroundColor: C.bg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.line }}>
                  <T s={10} c={C.mut} w='800'>{lbl}</T>
                  <T s={22} w='800' c={(w.hitRatePct || 0) >= 52 ? C.up : C.warn} style={{ marginTop: 3 }}>
                    {w.hitRatePct != null ? `${w.hitRatePct}%` : '—'}
                  </T>
                  <T s={10} c={C.mut}>Directional Hit Rate ({w.hits}/{w.tradesEvaluated} setups)</T>
                  <T s={11} style={{ marginTop: 4 }}>Avg Ret: <T w='700' c={col(w.avgReturnPct)}>{pctRaw(w.avgReturnPct)}</T></T>
                  <T s={11}>Sharpe Proxy: <T w='700'>{f2(w.sharpeProxy)}</T></T>
                </View>
              ))}
            </Row>
            <T s={10} c={C.mut} style={{ marginTop: 8 }}>Sample: {backtest.samplePeriod} · {backtest.methodology}</T>
            <T s={10} c={C.warn} style={{ marginTop: 3 }}>{backtest.caveat}</T>
          </>
        )}
      </Card>
    </>
  );
}

// ============================================================================
// 9. EXPANDED FUNDAMENTALS SCREEN (PRIORITY 1.1, 1.4 & PRIORITY 2.7–2.13)
// ============================================================================

function Fundamentals({ fx, cot, onOpenScore }) {
  const [focusCur, setFocusCur] = useState('ALL');
  if (!fx) return <Wait />;
  const D = fx.data || {};
  const K = cot?.data || {};
  const list = focusCur === 'ALL' ? CUR : [focusCur];

  return (
    <>
      <T s={24} w='800'>G8 Macro Fundamentals</T>
      <Note>
        Expanded institutional fundamental suite: Policy Rates &amp; Implied Path, Real Yields, Headline/Core CPI &amp; PCE, GDP/PMI/Retail/IP, Labor &amp; Wages, Central Bank Guidance, and 3-Year CFTC COT Percentiles. Amber STALE tags trigger strictly at &gt;45d (monthly) and &gt;105d (quarterly). Tap any currency score for full 7-factor attribution.
      </Note>

      <Pills opts={[['ALL', 'All G8'], ...CUR.map(c => [c, c])]} val={focusCur} set={setFocusCur} />

      {list.map(c => {
        const d = D[c] || {};
        const sc = fx.scores?.[c];
        const cotC = K[c];
        const cb = d.centralBank || {};
        const inf = d.inflationSuite || {};
        const gr = d.growthSuite || {};
        const emp = d.employmentSuite || {};
        const ryDiff = fx.realYieldDiffVsUsd?.[c];

        return (
          <Card
            key={c}
            title={`${c} · ${BANKS[c][0]}`}
            right={
              <TouchableOpacity
                onPress={() => onOpenScore(c)}
                style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: col(sc?.totalScore || 0), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}
              >
                <T s={12} w='800' c={col(sc?.totalScore || 0)}>
                  Score {sc ? signedF2(sc.totalScore) : '—'} ↗
                </T>
              </TouchableOpacity>
            }
          >
            {/* Central Bank & Rates */}
            <T s={10} c={C.ac} w='800' style={{ marginBottom: 4 }}>INTEREST RATES &amp; CENTRAL BANK PATH</T>
            <IndicatorRow label='Policy Rate' ind={d.rate} unit='%' />
            <IndicatorRow label='10Y Sovereign Yield' ind={d.yield10y} unit='%' />
            <IndicatorRow label='Short Rate / 2Y Proxy' ind={d.yieldShort} unit='%' subNote={d.yieldCurve?.spread != null ? `Curve Spread (10Y-Short): ${signedF2(d.yieldCurve.spread)}pp ${d.yieldCurve.inverted ? '(Inverted)' : ''}` : undefined} />
            <IndicatorRow label='10Y Real Yield (Nominal − CPI)' ind={d.realYield10y} unit='%' subNote={ryDiff != null && c !== 'USD' ? `vs USD Real Yield Diff: ${signedF2(ryDiff)}%` : undefined} />

            <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 8, marginVertical: 6, borderWidth: 1, borderColor: C.line }}>
              <Row>
                <T s={11} w='700'>Guidance: <T c={cb.guidance === 'Hawkish' ? C.up : cb.guidance === 'Dovish' ? C.dn : C.warn} w='800'>{cb.guidance || 'Data-Dependent'}</T></T>
                <T s={11} c={C.mut}>Next Mtg Priced: <T w='800' c={col(cb.impliedNextMeetingBps)}>{cb.impliedNextMeetingBps >= 0 ? '+' : ''}{cb.impliedNextMeetingBps ?? 0} bps</T></T>
              </Row>
              <Row style={{ marginTop: 4 }}>
                <T s={10} c={C.mut}>
                  Implied Odds: Hike {cb.probabilities?.hikePct ?? '—'}% · Hold {cb.probabilities?.holdPct ?? '—'}% · Cut {cb.probabilities?.cutPct ?? '—'}%
                </T>
              </Row>
              <Row style={{ marginTop: 4 }}>
                <T s={10} c={C.mut}>
                  Next Meeting: {cb.nextMeeting ? `${cb.nextMeeting.date} ${cb.nextMeeting.timeIst} IST (${cb.nextMeeting.daysAway}d)` : 'Pending official calendar'}
                </T>
                <TouchableOpacity onPress={() => Linking.openURL(BANKS[c][1])}><T s={10} c={C.ac} w='700'>CB Calendar ↗</T></TouchableOpacity>
              </Row>
            </View>

            {/* Inflation Suite */}
            <T s={10} c={C.ac} w='800' style={{ marginTop: 6, marginBottom: 4 }}>INFLATION SUITE ({inf.direction || 'Sticky'})</T>
            <IndicatorRow label='Headline CPI y/y' ind={d.cpi} unit='%' subNote={inf.trend3mAnnualized != null ? `3M Annualized Trend: ${f2(inf.trend3mAnnualized)}% (${inf.direction})` : undefined} />
            <IndicatorRow label='Core CPI y/y' ind={d.coreCpi} unit='%' />
            {c === 'USD' && <IndicatorRow label='US Core PCE y/y (Fed Target Gauge)' ind={inf.pce} unit='%' />}

            {/* Growth Suite */}
            <T s={10} c={C.ac} w='800' style={{ marginTop: 8, marginBottom: 4 }}>ECONOMIC GROWTH ({gr.gdpTrend || 'Stable'})</T>
            <IndicatorRow label='GDP Growth y/y' ind={d.gdp} unit='%' subNote={gr.gdpSurprise != null ? `Latest Calendar Surprise: ${signedF2(gr.gdpSurprise)}` : undefined} />
            <IndicatorRow label='Manufacturing PMI / ISM' ind={gr.manufacturingPmi} unit='' />
            <IndicatorRow label='Services PMI / ISM' ind={gr.servicesPmi} unit='' />
            <IndicatorRow label='Retail Sales' ind={gr.retailSales} unit='%' />
            <IndicatorRow label='Industrial Production' ind={gr.industrialProd} unit='%' />

            {/* Employment Suite */}
            <T s={10} c={C.ac} w='800' style={{ marginTop: 8, marginBottom: 4 }}>EMPLOYMENT &amp; WAGES (3M Trend: {emp.unempTrend3m || 'Stable'})</T>
            <IndicatorRow label='Unemployment Rate' ind={d.unemp} unit='%' subNote={emp.unempDelta3m != null ? `3M Change: ${signedF2(emp.unempDelta3m)}pp` : undefined} />
            <IndicatorRow label='Employment Change / NFP' ind={emp.employmentChange} unit='' />
            <IndicatorRow label='Wage Growth' ind={emp.wageGrowth} unit='%' />
            {c === 'USD' && <IndicatorRow label='Labor Force Participation Rate' ind={emp.participation} unit='%' />}

            {/* Institutional Positioning (CFTC COT) */}
            <T s={10} c={C.ac} w='800' style={{ marginTop: 8, marginBottom: 4 }}>INSTITUTIONAL POSITIONING (CFTC COT)</T>
            {cotC && cotC.value != null ? (
              <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 9, borderWidth: 1, borderColor: cotC.isCrowdedExtreme ? C.warn : C.line }}>
                <Row>
                  <T s={12} w='700'>Net: <T c={col(cotC.net)} w='800'>{Math.round(cotC.net).toLocaleString()}</T></T>
                  <Tag text={cotC.crowdingState || 'Neutral'} bg={cotC.isCrowdedExtreme ? C.warnBg : C.line} fg={cotC.isCrowdedExtreme ? C.warnTx : C.tx} />
                </Row>
                <Row style={{ marginTop: 4 }}>
                  <T s={11} c={C.mut}>WoW Δ: <T c={col(cotC.wowNetChange)} s={11} w='700'>{cotC.wowNetChange != null ? `${cotC.wowNetChange > 0 ? '+' : ''}${Math.round(cotC.wowNetChange).toLocaleString()}` : '—'}</T></T>
                  <T s={11} c={C.mut}>Net / OI: <T s={11} w='700'>{cotC.netPctOi != null ? `${cotC.netPctOi}%` : '—'}</T></T>
                </Row>
                <Row style={{ marginTop: 4 }}>
                  <T s={11} c={C.mut}>52W Pct: <T s={11} w='800' c={cotC.percentile52w >= 85 || cotC.percentile52w <= 15 ? C.warn : C.tx}>{cotC.percentile52w ?? '—'}th</T></T>
                  <T s={11} c={C.mut}>3Y Pct: <T s={11} w='800'>{cotC.percentile3y ?? '—'}th</T></T>
                  <T s={10} c={cotC.stale ? C.warn : C.mut}>{cotC.source} · {cotC.observationDate}{cotC.stale ? ' · STALE' : ''}</T>
                </Row>
              </View>
            ) : (
              <T s={11} c={C.warn}>{cotC?.unavailableReason || 'Unavailable (Source Timeout)'}</T>
            )}
          </Card>
        );
      })}
    </>
  );
}

// ============================================================================
// 10. PAIR & ASSET SCANNER WITH SORTING, FILTERING & PAIR DEEP-DIVE (P1, P5)
// ============================================================================

function Scanner({ A, fx, cot, intel, gold, send, onOpenScore }) {
  const [deep, setDeep] = useState(null);
  const [biasF, setBiasF] = useState('ALL');
  const [curF, setCurF] = useState('ALL');
  const [minConf, setMinConf] = useState(0);
  const [cleanFilter, setCleanFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('CONF');

  const rows = useMemo(() => {
    const base = intel?.pairSignals || [];
    let filtered = base.filter(p => {
      if (biasF !== 'ALL') {
        if (biasF === 'NEUTRAL') { if (p.signal !== 'NEUTRAL / NO TRADE') return false; }
        else if (biasF === 'LONG_ANY') { if (!p.signal.includes('LONG')) return false; }
        else if (biasF === 'SHORT_ANY') { if (!p.signal.includes('SHORT')) return false; }
        else if (p.signal !== biasF) return false;
      }
      if (curF !== 'ALL' && p.base !== curF && p.quote !== curF) return false;
      if (p.confidencePct < minConf) return false;
      if (cleanFilter === 'NO_CONFLICT' && p.hasConflict) return false;
      if (cleanFilter === 'EX_CROWDED' && p.crowdedCotExtreme) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'CONF') sorted.sort((a, b) => b.confidencePct - a.confidencePct || Math.abs(b.spread) - Math.abs(a.spread));
    else if (sortBy === 'SPREAD') sorted.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
    else if (sortBy === 'DIV') sorted.sort((a, b) => b.divergenceScore - a.divergenceScore);
    else if (sortBy === 'MOM') sorted.sort((a, b) => Math.abs(b.m1 || 0) - Math.abs(a.m1 || 0));
    return sorted;
  }, [intel?.pairSignals, biasF, curF, minConf, cleanFilter, sortBy]);

  if (!A || !intel) return <Wait />;

  return (
    <>
      <T s={24} w='800'>Pair &amp; Asset Scanner</T>
      <Note>
        28 G8 crosses scored via the 5-tier calibrated engine (STRONG LONG / LONG / NEUTRAL / SHORT / STRONG SHORT) with automatic Neutral guardrails on weak spreads (&lt;1.5) or opposing momentum/COT conflicts.
      </Note>

      {/* Unified Gold Reference Strip (Priority 1.2) */}
      <Card style={{ padding: 10, borderColor: C.warn }}>
        <Row>
          <View>
            <T s={12} w='800' c={C.warn}>XAU/USD · UNIFIED GOLD FEED</T>
            <T s={10} c={gold?.stale ? C.warn : C.mut}>
              {gold?.source} · {gold?.observationDate || '—'} · Updated {fmtIstTime(gold?.fetchedAt)}{gold?.stale ? ' · STALE' : ''}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T s={18} w='800'>{gold?.price != null ? `$${f2(gold.price, 2)}` : (gold?.unavailableReason || 'Unavailable')}</T>
            {gold?.d1 != null && <T s={11} c={col(gold.d1)}>1D {pct(gold.d1)} · 1M {pct(gold.m1)}</T>}
          </View>
        </Row>
      </Card>

      {/* Priority 5: Sorting & Filtering Controls */}
      <Card title='Filter & Sort Scanner'>
        <T s={10} c={C.mut} w='700' style={{ marginBottom: 4 }}>BIAS FILTER</T>
        <Pills
          opts={[
            ['ALL', 'All Signals'],
            ['STRONG LONG', 'Strong Long'],
            ['LONG_ANY', 'All Long'],
            ['NEUTRAL', 'Neutral / No Trade'],
            ['SHORT_ANY', 'All Short'],
            ['STRONG SHORT', 'Strong Short']
          ]}
          val={biasF}
          set={setBiasF}
        />
        <T s={10} c={C.mut} w='700' style={{ marginBottom: 4 }}>CURRENCY</T>
        <Pills opts={[['ALL', 'All G8'], ...CUR.map(c => [c, c])]} val={curF} set={setCurF} />
        <T s={10} c={C.mut} w='700' style={{ marginBottom: 4 }}>CONFIDENCE, QUALITY &amp; SORT</T>
        <Pills opts={[[0, 'Any Conf'], [50, '≥50% Conf'], [65, '≥65% Conf'], [75, '≥75% Conf']]} val={minConf} set={setMinConf} />
        <Pills opts={[['ALL', 'All Quality'], ['NO_CONFLICT', 'No Conflicts'], ['EX_CROWDED', 'Ex-Crowded COT']]} val={cleanFilter} set={setCleanFilter} />
        <Pills opts={[['CONF', 'Sort: Confidence %'], ['SPREAD', 'Sort: Macro Spread'], ['DIV', 'Sort: Divergence'], ['MOM', 'Sort: 1M Move']]} val={sortBy} set={setSortBy} style={{ marginBottom: 2 }} />
        <T s={11} c={C.mut}>Showing <T w='800'>{rows.length}</T> of 28 pairs · Global Regime: <T w='800' c={C.ac}>{intel.macroRegime?.regime}</T></T>
      </Card>

      {!rows.length && <Card><T c={C.mut}>No pairs match your active filter criteria.</T></Card>}

      {rows.map(p => (
        <TouchableOpacity key={p.pair} onPress={() => setDeep(p)}>
          <Card style={{ padding: 11, marginBottom: 9 }}>
            <Row>
              <Row style={{ justifyContent: 'flex-start' }}>
                <T w='800' s={16} style={{ marginRight: 8 }}>{p.pair}</T>
                <SignalBadge signal={p.signal} />
              </Row>
              <T c={col(p.spread)} w='800' s={13}>Spread {signedF2(p.spread)}</T>
            </Row>
            <Row style={{ marginTop: 5 }}>
              <T c={C.mut} s={12}>Ref {f2(p.spot, p.quote === 'JPY' ? 3 : 5)}</T>
              <T c={col(p.d1)} s={12}>1D {pct(p.d1)}</T>
              <T c={col(p.m1)} s={12}>1M {pct(p.m1)}</T>
              <T c={C.mut} s={11}>RealYld {p.realYieldDiff != null ? signedF2(p.realYieldDiff) + '%' : '—'}</T>
            </Row>
            <ConfBar pctVal={p.confidencePct} />
            <ConflictBox conflicts={p.conflicts} neutralReason={p.neutralReason} />
            <Row style={{ marginTop: 6 }}>
              <T s={10} c={C.mut}>ST: {p.multiTimeframe?.shortTerm?.bias} · MT: {p.multiTimeframe?.mediumTerm?.bias} · LT: {p.multiTimeframe?.longTerm?.bias}</T>
              <T s={10} c={C.mut}>{fmtIstTime(p.lastCalculated)}</T>
            </Row>
          </Card>
        </TouchableOpacity>
      ))}

      {deep && (
        <PairModal
          p={deep}
          A={A}
          fx={fx}
          cot={cot}
          onOpenScore={c => { setDeep(null); onOpenScore(c); }}
          send={o => { setDeep(null); send(o); }}
          onClose={() => setDeep(null)}
        />
      )}
    </>
  );
}

function PairModal({ p, A, fx, cot, send, onClose, onOpenScore }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const b = p.base, q = p.quote;
  const D = fx?.data || {}, K = cot?.data || {};
  const ser = A.series(b, q);
  const dp = q === 'JPY' ? 3 : 5;
  const jpy = b === 'JPY' || q === 'JPY';
  const perf = [['1D', 1], ['1W', 5], ['1M', 21], ['3M', 63]].map(([l, k]) => [l, A.chg(b, q, k)]);
  const up = ser[ser.length - 1] >= ser[0];

  const FR = [
    ['Policy rate %', c => D[c]?.rate?.value],
    ['10Y Nominal Yield %', c => D[c]?.yield10y?.value],
    ['10Y Real Yield %', c => D[c]?.realYield10y?.value],
    ['CPI y/y %', c => D[c]?.cpi?.value],
    ['GDP y/y %', c => D[c]?.gdp?.value],
    ['Unemployment %', c => D[c]?.unemp?.value],
    ['Implied Next Mtg (bps)', c => D[c]?.centralBank?.impliedNextMeetingBps],
    ['7-Factor Macro Score', c => fx?.scores?.[c]?.totalScore]
  ];

  const cb = K[b], cq = K[q];
  const Cell = ({ children, c, w = 1, al = 'right', bold }) => (
    <T s={12} c={c} w={bold ? '700' : '400'} style={{ flex: w, textAlign: al }}>{children}</T>
  );
  const n0 = x => (x == null ? 'Unavailable' : Math.round(x).toLocaleString('en-US'));

  return (
    <Modal transparent animationType='slide' visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ width: wide ? 560 : '100%', height: '100%', backgroundColor: C.bg, borderLeftWidth: 1, borderLeftColor: C.line, paddingTop: Platform.OS === 'android' ? 28 : 8 }}>
          <Row style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Row style={{ justifyContent: 'flex-start' }}>
              <T s={20} w='800' style={{ marginRight: 10 }}>{b}/{q}</T>
              <SignalBadge signal={p.signal} />
            </Row>
            <TouchableOpacity onPress={onClose}><T s={22}>✕</T></TouchableOpacity>
          </Row>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Card title='Calibrated Signal Diagnostics'>
              <ConfBar pctVal={p.confidencePct} />
              <ConflictBox conflicts={p.conflicts} neutralReason={p.neutralReason} />
              <Row style={{ marginTop: 10 }}>
                {Object.entries(p.multiTimeframe || {}).map(([k, v]) => (
                  <View key={k} style={{ flex: 1, alignItems: 'center', backgroundColor: C.bg, padding: 7, borderRadius: 8, marginHorizontal: 2, borderWidth: 1, borderColor: C.line }}>
                    <T s={9} c={C.mut} w='700'>{k.replace('Term', '').toUpperCase()}</T>
                    <T s={12} w='800' c={v.bias === 'Bullish' ? C.up : v.bias === 'Bearish' ? C.dn : C.mut}>{v.bias}</T>
                  </View>
                ))}
              </Row>
              <T s={10} c={C.mut} style={{ marginTop: 8 }}>Last Calculated: {fmtIstTime(p.lastCalculated)}</T>
            </Card>

            <Card title='60-Day Reference Price (ECB Daily)'>
              <T s={24} w='800'>{f2(p.spot, dp)}</T>
              <View style={{ marginVertical: 8 }}><LineChart data={ser} color={up ? C.up : C.dn} /></View>
              <Row>
                <T c={C.mut} s={11}>60d low {f2(Math.min(...ser), dp)}</T>
                <T c={C.mut} s={11}>60d high {f2(Math.max(...ser), dp)}</T>
              </Row>
              <Row style={{ marginTop: 10 }}>
                {perf.map(([l, v]) => (
                  <View key={l} style={{ alignItems: 'center', flex: 1 }}>
                    <T c={C.mut} s={11}>{l}</T>
                    <T c={col(v)} w='700'>{pct(v)}</T>
                  </View>
                ))}
              </Row>
            </Card>

            <Card title='Fundamentals & Yield Differentials'>
              <Row style={{ marginBottom: 6 }}>
                <Cell al='left' w={1.8} c={C.mut}>Metric</Cell>
                <Cell c={C.ac} bold>{b}</Cell>
                <Cell c={C.ac} bold>{q}</Cell>
                <Cell c={C.mut} bold>Diff</Cell>
              </Row>
              {FR.map(([l, fn]) => {
                const x = fn(b), y = fn(q), d = okN(x) && okN(y) ? x - y : null;
                return (
                  <Row key={l} style={{ paddingVertical: 5, borderTopWidth: 1, borderTopColor: C.line }}>
                    <Cell al='left' w={1.8} c={C.mut}>{l}</Cell>
                    <Cell>{okN(x) ? f2(x) : 'N/A'}</Cell>
                    <Cell>{okN(y) ? f2(y) : 'N/A'}</Cell>
                    <Cell c={col(d)} bold>{d == null ? '—' : signedF2(d)}</Cell>
                  </Row>
                );
              })}
              <Row style={{ marginTop: 10 }}>
                <Btn small t={`Inspect ${b} Score`} on={() => onOpenScore(b)} />
                <Btn small t={`Inspect ${q} Score`} on={() => onOpenScore(q)} />
              </Row>
            </Card>

            <Card title='Expanded CFTC COT Positioning (52W & 3Y Percentiles)'>
              <Row style={{ marginBottom: 6 }}>
                <Cell al='left' w={1.6} c={C.mut}>Metric</Cell>
                <Cell c={C.mut} bold>{b}</Cell>
                <Cell c={C.mut} bold>{q}</Cell>
              </Row>
              {[
                ['Net contracts', x => n0(x?.net)],
                ['WoW change', x => (x?.wowNetChange == null ? '—' : (x.wowNetChange > 0 ? '+' : '') + n0(x.wowNetChange))],
                ['Net % of OI', x => (x?.netPctOi != null ? `${x.netPctOi}%` : '—')],
                ['52W Percentile', x => (x?.percentile52w != null ? `${x.percentile52w}th` : '—')],
                ['3Y Percentile', x => (x?.percentile3y != null ? `${x.percentile3y}th` : '—')],
                ['Crowding', x => x?.crowdingState || '—']
              ].map(([l, fn]) => (
                <Row key={l} style={{ paddingVertical: 4, borderTopWidth: 1, borderTopColor: C.line }}>
                  <Cell al='left' w={1.6} c={C.mut}>{l}</Cell>
                  <Cell c={l === 'Net contracts' && cb ? col(cb.net) : undefined}>{fn(cb)}</Cell>
                  <Cell c={l === 'Net contracts' && cq ? col(cq.net) : undefined}>{fn(cq)}</Cell>
                </Row>
              ))}
            </Card>

            <Btn primary t='Send to Risk Calculator →' on={() => send({ pair: b + q, entry: f2(p.spot, dp), size: jpy ? '0.01' : '0.0001' })} style={{ alignSelf: 'flex-start' }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// 11. MACRO & CROSS-ASSET DRIVERS SCREEN (PRIORITY 1.2, 2.14 & PRIORITY 3.2)
// ============================================================================

function Macro({ d, assets, intel, gold }) {
  if (!d) return <Wait />;
  const F = d.fred || {};
  const B = d.bls || {};
  const der = d.derived || {};
  const drv = assets?.crossAssetDrivers || intel?.crossAssetDrivers || {};
  const sh = intel?.safeHavenFlows || {};
  const xAlerts = assets?.correlationBreakdownAlerts || [];

  const CorrStrip = ({ label, map }) => (
    <Row style={{ paddingVertical: 4 }}>
      <T s={11} c={C.mut}>{label}</T>
      <T s={11} w='700'>
        30D <T c={col(map?.['30D'])} s={11}>{map?.['30D'] != null ? signedF2(map['30D']) : '—'}</T> · 60D <T c={col(map?.['60D'])} s={11}>{map?.['60D'] != null ? signedF2(map['60D']) : '—'}</T> · 90D <T c={col(map?.['90D'])} s={11}>{map?.['90D'] != null ? signedF2(map['90D']) : '—'}</T>
      </T>
    </Row>
  );

  return (
    <>
      <T s={24} w='800'>Macro &amp; Cross-Asset Drivers</T>
      <Note>
        Unified Gold feed, sovereign real yields, WTI/Brent energy regime, VIX/equities/credit risk sentiment, BTC liquidity correlations, Safe-Haven flows, and FRED/BLS releases with explicit source/date/STALE badges.
      </Note>

      {!!xAlerts.length && (
        <Card title='Cross-Asset Correlation Breakdown Alerts' style={{ borderColor: C.warn }}>
          {xAlerts.map((a, idx) => (
            <T key={idx} s={12} c={C.warnTx} style={{ marginBottom: 4 }}>⚡ {a.alertText}</T>
          ))}
        </Card>
      )}

      {/* Gold & Precious Metals (Unified Gold Feed) */}
      <Card title='Gold (XAU/USD) Cross-Asset Driver Panel' style={{ borderColor: C.warn }}>
        <IndicatorRow label='Gold Spot (Unified Feed)' ind={gold} unit='USD/oz' decimals={2} subNote={gold?.d1 != null ? `1D ${pct(gold.d1)} · 1M ${pct(gold.m1)}` : undefined} />
        <IndicatorRow label='Silver (XAG/USD)' ind={drv.gold?.silver} unit='USD/oz' decimals={2} />
        <IndicatorRow label='GLD Gold ETF Demand Proxy' ind={drv.gold?.gldEtf} unit='USD' decimals={2} subNote={drv.gold?.gldEtf?.trend} />
        <Row style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View style={{ flex: 1 }}>
            <T s={12} c={C.mut}>Gold / Silver Ratio</T>
            <T s={10} c={C.mut}>{drv.gold?.goldSilverInterpretation}</T>
          </View>
          <T s={14} w='800' c={C.warn}>{drv.gold?.goldSilverRatio ?? '—'}x</T>
        </Row>
        <CorrStrip label='Gold vs DXY Correlation' map={drv.gold?.corrVsDxy} />
        <CorrStrip label='Gold vs US 10Y Yield Correlation' map={drv.gold?.corrVsUs10y} />
        <CorrStrip label='Gold vs Silver Correlation' map={drv.gold?.corrVsSilver} />
      </Card>

      {/* USD & US Sovereign Yields */}
      <Card title='USD & Sovereign Yield Curve'>
        <IndicatorRow label='DXY Dollar Index Proxy' ind={drv.usd?.dxy} unit='' decimals={2} subNote={drv.usd?.dxy?.trend} />
        <IndicatorRow label='Broad Trade-Weighted USD' ind={F.usdBroad} unit='' />
        <IndicatorRow label='US 2Y Treasury Yield' ind={F.us2y} unit='%' />
        <IndicatorRow label='US 5Y Treasury Yield' ind={F.us5y} unit='%' />
        <IndicatorRow label='US 10Y Treasury Yield' ind={F.us10y} unit='%' />
        <IndicatorRow label='US 2s10s Spread' ind={der.spread2s10s} unit='pp' />
        <IndicatorRow label='US 10Y TIPS Real Yield' ind={F.tips10y} unit='%' />
        <IndicatorRow label='US 10Y Real Yield (Nominal − CPI)' ind={der.usRealYieldNominalMinusCpi} unit='%' />
        <IndicatorRow label='US 10Y Breakeven Inflation' ind={der.breakeven10y} unit='%' />
      </Card>

      {/* Oil (WTI & Brent) */}
      <Card title='Energy Drivers (WTI & Brent Crude)'>
        <IndicatorRow label='WTI Crude Oil (USOIL)' ind={drv.oil?.wti || F.wti} unit='$/bbl' />
        <IndicatorRow label='Brent Crude Oil (UKOIL)' ind={drv.oil?.brent || F.brent} unit='$/bbl' />
        <Row style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <T s={12} c={C.mut}>Brent − WTI Spread</T>
          <T s={13} w='800'>{drv.oil?.brentWtiSpread != null ? `$${f2(drv.oil.brentWtiSpread)}/bbl` : '—'}</T>
        </Row>
        <Row style={{ paddingVertical: 6 }}>
          <T s={12} c={C.mut}>Macro Supply/Demand Regime</T>
          <T s={12} w='800' c={C.ac}>{drv.oil?.regime || 'Unavailable'}</T>
        </Row>
        <CorrStrip label='WTI vs CAD Strength' map={drv.oil?.corrVsCad} />
      </Card>

      {/* Risk Sentiment */}
      <Card title='Risk Sentiment & Volatility Composite'>
        <Row style={{ marginBottom: 8 }}>
          <T s={15} w='800' c={drv.riskSentiment?.riskRegime === 'Risk-On' ? C.up : drv.riskSentiment?.riskRegime === 'Risk-Off' ? C.dn : C.warn}>
            {drv.riskSentiment?.riskRegime || 'Neutral'}
          </T>
          <Tag text={`Score ${signedF2(drv.riskSentiment?.riskCompositeScore)}`} bg={C.line} fg={C.tx} />
        </Row>
        <IndicatorRow label='VIX Volatility Index' ind={drv.riskSentiment?.vix} unit='' subNote={drv.riskSentiment?.vixRegime} />
        <IndicatorRow label='S&P 500 (SPX500)' ind={drv.riskSentiment?.spx} unit='' subNote={drv.riskSentiment?.spx?.trend} />
        <IndicatorRow label='Nasdaq 100 (NAS100)' ind={drv.riskSentiment?.nas100} unit='' subNote={drv.riskSentiment?.nas100?.trend} />
        <IndicatorRow label='Credit Appetite Proxy (HYG vs LQD 1M)' ind={drv.riskSentiment?.creditProxyHyVsIg1MPct != null ? { value: drv.riskSentiment.creditProxyHyVsIg1MPct, source: 'Yahoo Finance', observationDate: drv.riskSentiment?.spx?.observationDate, unit: '%' } : null} unit='%' />
      </Card>

      {/* Crypto (BTC/USD) */}
      <Card title='Crypto (BTC/USD) Liquidity & Risk Correlations'>
        <IndicatorRow label='Bitcoin (BTC/USD)' ind={drv.crypto?.btc} unit='USD' decimals={0} subNote={drv.crypto?.btc?.trend} />
        <CorrStrip label='BTC vs Nasdaq 100 (Risk)' map={drv.crypto?.corrVsNas100} />
        <CorrStrip label='BTC vs DXY (USD Liquidity)' map={drv.crypto?.corrVsDxy} />
        <CorrStrip label='BTC vs US 10Y Yield' map={drv.crypto?.corrVsUs10y} />
        <CorrStrip label='BTC vs TLT Long Bonds' map={drv.crypto?.corrVsTlt} />
      </Card>

      {/* Priority 2.14: Safe-Haven Flows */}
      <Card title='Safe-Haven Flows Regime'>
        <Row style={{ marginBottom: 6 }}>
          <T s={14} w='800' c={C.warn}>{sh.regime || 'Neutral'}</T>
          <T s={11} c={C.mut}>CHF/JPY 1M: <T w='800' c={col(sh.chfJpyBasket1MPct)}>{pctRaw(sh.chfJpyBasket1MPct)}</T></T>
        </Row>
        <IndicatorRow label='Germany 10Y Bund Yield' ind={F.de10y} unit='%' />
        <IndicatorRow label='Japan 10Y JGB Yield' ind={F.jp10y} unit='%' />
        <IndicatorRow label='TLT US 20Y+ Treasury ETF' ind={sh.sovereignBonds?.tltEtf} unit='USD' />
      </Card>

      {/* US Inflation & Labor (FRED & BLS) */}
      <Card title='US Inflation & Labor Suite (FRED + BLS)'>
        <IndicatorRow label='US CPI y/y (BLS)' ind={B.cpiYoY} unit='%' subNote={B.cpiYoY?.annualized3m != null ? `3M Annualized: ${f2(B.cpiYoY.annualized3m)}%` : undefined} />
        <IndicatorRow label='US Core CPI y/y (FRED)' ind={F.coreCpiUs} unit='%' />
        <IndicatorRow label='US Core PCE y/y (FRED)' ind={F.pceCore} unit='%' subNote={F.pceCore?.annualized3m != null ? `3M Annualized: ${f2(F.pceCore.annualized3m)}%` : undefined} />
        <IndicatorRow label='US Unemployment Rate (BLS)' ind={B.unemployment} unit='%' subNote={B.unemployment?.trend3m ? `3M Trend: ${B.unemployment.trend3m}` : undefined} />
        <IndicatorRow label='US Nonfarm Payrolls m/m (BLS)' ind={B.payrollsChange} unit='k' decimals={0} />
        <IndicatorRow label='US Avg Hourly Earnings y/y (BLS)' ind={B.wageGrowthYoY} unit='%' />
        <IndicatorRow label='US Labor Participation (BLS)' ind={B.participation} unit='%' />
        <IndicatorRow label='US Retail Sales y/y (FRED)' ind={F.retailSalesUs} unit='%' />
        <IndicatorRow label='US Industrial Production y/y (FRED)' ind={F.indProdUs} unit='%' />
      </Card>
    </>
  );
}

// ============================================================================
// 12. CONTEXT-AWARE NEWS SCREEN (PRIORITY 1.5)
// ============================================================================

const CATS = ['Top Stories', 'Central Banks', 'Currencies', 'Macro & Rates'];
const AS = {
  USD: ['#15803d', '$'], EUR: ['#2563eb', '€'], GBP: ['#7e22ce', '£'], JPY: ['#dc2626', '¥'],
  CHF: ['#be123c', '₣'], CAD: ['#ea580c', 'C$'], AUD: ['#ca8a04', 'A$'], NZD: ['#0d9488', 'NZ$'],
  XAUUSD: ['#b45309', 'Au'], XAGUSD: ['#64748b', 'Ag'], US30: ['#1d4ed8', 'DJ'], NAS100: ['#0284c7', 'NDX'],
  SPX500: ['#4338ca', 'SPX'], BTCUSD: ['#d97706', '₿'], USOIL: ['#374151', 'WTI'], UKOIL: ['#475569', 'BRN']
};
const ASSETS = Object.keys(AS);
const CF = { 'Central Banks': ['#0f766e', '%'], Currencies: ['#9333ea', '⇄'], 'Macro & Rates': ['#c2410c', '↗'], 'Top Stories': ['#334155', '◆'] };
const relT = n => {
  const t = n.time ? new Date(n.time) : null;
  if (!t || isNaN(t)) return n.publishedAt || '';
  const s = (Date.now() - t) / 1e3, m = s / 60, h = m / 60, d = h / 24, f = Math.floor;
  return s < 60 ? 'just now' : m < 60 ? `${f(m)} min ago` : h < 24 ? `${f(h)} hour${f(h) > 1 ? 's' : ''} ago` : d < 7 ? `${f(d)} day${f(d) > 1 ? 's' : ''} ago` : t.toLocaleDateString();
};

function Thumb({ n, style, big }) {
  const [bad, setBad] = useState(false);
  if (n.imageUrl && !bad) return <Image source={{ uri: n.imageUrl }} onError={() => setBad(true)} resizeMode='cover' style={{ backgroundColor: C.line, ...style }} />;
  const a = ASSETS.find(c => n.cur?.includes(c));
  const [bg, sym] = a ? AS[a] : (CF[n.category] || CF['Top Stories']);
  const sm = (style?.width || 100) < 70;
  const h = [...(n.id || 'abcdefabcdef')].slice(0, sm ? 6 : 12).map(ch => ch.charCodeAt(0) % 6);
  return (
    <View style={{ backgroundColor: bg, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', ...style }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 }}>
        {h.map((v, i) => <View key={i} style={{ flex: 1, marginHorizontal: 1, height: `${22 + v * 9}%`, backgroundColor: 'rgba(255,255,255,0.15)', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />)}
      </View>
      <Text style={{ color: '#fff', fontSize: big ? 60 : sm ? 20 : 30, fontWeight: '800' }}>{sym}</Text>
      {big && <T c='#ffffffcc' s={12} w='800' style={{ marginTop: 2, letterSpacing: 2 }}>{a || (n.category || '').toUpperCase()}</T>}
    </View>
  );
}

const Badge = ({ n }) => <View style={{ backgroundColor: C.line, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}><T s={10} w='700'>{(n.source || 'News').toUpperCase()}</T></View>;
const Chip = ({ t, c }) => <View style={{ borderWidth: 1, borderColor: c, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}><T c={c} s={11} w='700'>{t}</T></View>;

function SentimentBadge({ n }) {
  const toneColor = n.tone === 'Hawkish' ? C.up : n.tone === 'Dovish' ? C.dn : C.mut;
  const conf = n.sentimentConfidence != null ? `${n.sentimentConfidence}%` : null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
      <Tag text={`${n.tone || 'Neutral'}${conf ? ` · ${conf} Conf` : ''}`} bg={n.tone === 'Hawkish' ? C.upBg : n.tone === 'Dovish' ? C.dnBg : C.line} fg={n.tone === 'Hawkish' ? C.upTx : n.tone === 'Dovish' ? C.dnTx : C.tx} />
      {!!n.policyImplication && <Tag text={n.policyImplication} bg={C.bg} fg={toneColor} border={toneColor} />}
    </View>
  );
}

function Reader({ n, onClose }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const tc = t => (t === 'Hawkish' ? C.up : t === 'Dovish' ? C.dn : C.mut);
  const ic = { HIGH: C.dn, MEDIUM: C.warn, LOW: C.mut };
  if (!n) return null;
  return (
    <Modal transparent animationType='slide' visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ width: wide ? 500 : '100%', height: '100%', backgroundColor: C.bg, borderLeftWidth: 1, borderLeftColor: C.line, paddingTop: Platform.OS === 'android' ? 28 : 8 }}>
          <Row style={{ padding: 12 }}><T c={C.mut} s={11} w='700'>CONTEXT-AWARE ARTICLE ANALYSIS</T><TouchableOpacity onPress={onClose}><T s={20}>✕</T></TouchableOpacity></Row>
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0 }}>
            <Thumb n={n} big style={{ width: '100%', height: 200, borderRadius: 12 }} />
            <Row style={{ justifyContent: 'flex-start', marginTop: 12 }}><Badge n={n} /><T c={C.mut} s={12} style={{ marginLeft: 8 }}>{relT(n)}</T></Row>
            <T s={21} w='800' style={{ marginVertical: 10 }}>{n.title}</T>
            <SentimentBadge n={n} />
            {!!n.rationale && (
              <View style={{ backgroundColor: C.card, borderLeftWidth: 3, borderLeftColor: tc(n.tone), borderRadius: 8, padding: 10, marginVertical: 8 }}>
                <T s={10} c={C.mut} w='800'>MACRO POLICY RATIONALE</T>
                <T s={13} style={{ marginTop: 3 }}>{n.rationale}</T>
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
              {(n.cur || []).map(c => <Chip key={c} t={`${c} · ${n.directionalBias || n.tone || 'Neutral'}`} c={tc(n.tone)} />)}
              <Chip t={`${n.impact} IMPACT`} c={ic[n.impact] || C.mut} />
              {!!n.driver && <Chip t={n.driver} c={C.ac} />}
              <Chip t={n.category} c={C.ac} />
            </View>
            <T s={14} style={{ marginTop: 8, lineHeight: 22 }}>{n.summary || "This publisher's feed doesn't include a body excerpt. Open the full story below."}</T>
            <Btn primary t={`Read full story at ${n.source || 'publisher'} ↗`} on={() => Linking.openURL(n.url || n.link)} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const IMPC = { HIGH: ['#7f1d1d', '#fecaca', 'HIGH IMPACT'], MEDIUM: ['#78350f', '#fde68a', 'MEDIUM IMPACT'] };
const ImpactTag = ({ n }) => IMPC[n.impact] ? (
  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    <View style={{ backgroundColor: IMPC[n.impact][0], borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginRight: 6 }}>
      <T s={10} w='800' c={IMPC[n.impact][1]}>{IMPC[n.impact][2]}</T>
    </View>
    {!!n.driver && <T c={C.mut} s={11}>{n.driver}</T>}
  </View>
) : null;

function ImpactSummary({ asset, news }) {
  const cut = Date.now() - 72 * 36e5;
  const items = news.filter(n => n.cur?.includes(asset) && new Date(n.time) >= cut);
  const W = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  let net = 0, tot = 0, up = 0, dn = 0;
  items.forEach(n => {
    const s = n.sentimentScore != null ? Math.sign(n.sentimentScore) : (n.tone === 'Hawkish' ? 1 : n.tone === 'Dovish' ? -1 : 0);
    const weight = (W[n.impact] || 1) * ((n.sentimentConfidence || 50) / 100);
    net += weight * s;
    tot += weight * Math.abs(s);
    if (s > 0) up++;
    if (s < 0) dn++;
  });
  const r = tot ? net / tot : 0;
  const bias = up + dn < 2 || Math.abs(r) < 0.25 ? 'Mixed / Neutral' : r > 0 ? 'Bullish / Hawkish' : 'Bearish / Dovish';
  const bc = bias.startsWith('Bull') ? C.up : bias.startsWith('Bear') ? C.dn : C.warn;
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: bc }}>
      <Row>
        <T s={17} w='800'>{asset} Context-Weighted Sentiment (72h)</T>
        <View style={{ borderWidth: 1, borderColor: bc, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
          <T c={bc} s={12} w='800'>{bias}</T>
        </View>
      </Row>
      {!items.length ? (
        <T c={C.mut} s={13} style={{ marginTop: 8 }}>No {asset} headlines in the last 72 hours.</T>
      ) : (
        <T s={12} style={{ marginTop: 8 }}>
          Evaluated {items.length} headlines ({up} hawkish/bullish vs {dn} dovish/bearish, weighted by impact &amp; confidence %). Latest catalyst: “{items[0].title}” — {items[0].rationale}
        </T>
      )}
    </Card>
  );
}

const NF0 = { cat: 'Top Stories', asset: null, imp: 'ALL', q: '' };
const ALIAS = {
  usd: 'USD', dollar: 'USD', greenback: 'USD', eur: 'EUR', euro: 'EUR', gbp: 'GBP', pound: 'GBP', sterling: 'GBP',
  jpy: 'JPY', yen: 'JPY', chf: 'CHF', franc: 'CHF', cad: 'CAD', loonie: 'CAD', aud: 'AUD', aussie: 'AUD', nzd: 'NZD', kiwi: 'NZD',
  gold: 'XAUUSD', xau: 'XAUUSD', silver: 'XAGUSD', xag: 'XAGUSD', dow: 'US30', us30: 'US30', nasdaq: 'NAS100', nas100: 'NAS100',
  spx: 'SPX500', spx500: 'SPX500', btc: 'BTCUSD', bitcoin: 'BTCUSD', oil: 'USOIL', wti: 'USOIL', usoil: 'USOIL', brent: 'UKOIL', ukoil: 'UKOIL'
};

function News({ news, trades, nf, setNf }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const { cat, asset, imp, q } = nf;
  const setCat = v => setNf({ ...nf, cat: v });
  const setAsset = v => setNf({ ...nf, asset: v });
  const setImp = v => setNf({ ...nf, imp: v });
  const setQ = v => setNf({ ...nf, q: v });
  const [sel, setSel] = useState(null);

  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  const inQ = n => !toks.length || toks.every(t => `${n.title} ${n.summary || ''} ${n.rationale || ''} ${n.source || ''} ${n.driver || ''} ${(n.cur || []).join(' ')}`.toLowerCase().includes(t) || (ALIAS[t] && n.cur?.includes(ALIAS[t])));
  const inCat = n => cat === 'Top Stories' || n.category === cat;
  const inImp = n => imp === 'ALL' || n.impact === imp;
  const inAsset = n => !asset || n.cur?.includes(asset);

  const L = news.filter(n => inCat(n) && inImp(n) && inAsset(n) && inQ(n));
  const cnt = x => news.filter(n => inCat(n) && inImp(n) && inQ(n) && n.cur?.includes(x)).length;
  const impCnt = k => news.filter(n => inCat(n) && inAsset(n) && inQ(n) && (k === 'ALL' || n.impact === k)).length;

  const lead = L.find(n => n.imageUrl && n.impact === 'HIGH') || L.find(n => n.imageUrl) || L[0];
  const rest = L.filter(n => n.id !== lead?.id);
  const highs = rest.filter(n => n.impact === 'HIGH').slice(0, 30);
  const meds = rest.filter(n => n.impact === 'MEDIUM').slice(0, 30);
  const others = imp === 'ALL' ? rest.filter(n => n.impact === 'LOW').slice(0, 20) : [];
  const movers = (news.filter(n => n.impact === 'HIGH').length ? news.filter(n => n.impact === 'HIGH') : news).slice(0, 8);
  const mine = new Set(trades.flatMap(t => [t.pair.slice(0, 3), t.pair.slice(3, 6), t.pair]));
  const picks = mine.size ? news.filter(n => n.cur?.some(c => mine.has(c)) && !movers.includes(n)).slice(0, 5) : [];

  const story = n => (
    <TouchableOpacity key={n.id} onPress={() => setSel(n)}>
      <Row style={{ alignItems: 'flex-start', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <View style={{ marginRight: 8 }}><Badge n={n} /></View>
            <ImpactTag n={n} />
          </Row>
          <T s={15} w='700' style={{ marginTop: 6 }}>{n.title}</T>
          <SentimentBadge n={n} />
          {!!n.rationale && <T c={C.mut} s={11} style={{ marginTop: 3 }} numberOfLines={2}>↳ {n.rationale}</T>}
          <T c={C.mut} s={10} style={{ marginTop: 4 }}>{relT(n)}</T>
        </View>
        <Thumb n={n} style={{ width: 88, height: 88, borderRadius: 10 }} />
      </Row>
    </TouchableOpacity>
  );

  const sec = (emoji, title, color, items) => items.length ? (
    <View style={{ marginTop: 16 }}>
      <Row style={{ borderLeftWidth: 4, borderLeftColor: color, paddingLeft: 10, marginBottom: 4 }}>
        <T s={17} w='800'>{emoji} {title}</T>
        <T c={C.mut} s={12}>{items.length} stories</T>
      </Row>
      {items.map(story)}
    </View>
  ) : null;

  const SideBox = ({ title, items }) => items.length ? (
    <Card title={title}>
      {items.map(n => (
        <TouchableOpacity key={n.id} onPress={() => setSel(n)}>
          <Row style={{ alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(30,42,82,0.5)' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <T s={12} w='700'>{n.title}</T>
              <T c={n.tone === 'Hawkish' ? C.up : n.tone === 'Dovish' ? C.dn : C.mut} s={10} w='700' style={{ marginTop: 2 }}>
                {n.tone} ({n.sentimentConfidence ?? '—'}%) · {relT(n)}
              </T>
            </View>
            <Thumb n={n} style={{ width: 52, height: 52, borderRadius: 8 }} />
          </Row>
        </TouchableOpacity>
      ))}
    </Card>
  ) : null;

  return (
    <>
      <T s={24} w='800'>Context-Aware Macro News</T>
      <Note>Evaluates directional surprise, inverted labor gauges, and central-bank hold/cut/hike guidance across headline + summary text with confidence scores and 1-line policy rationales.</Note>

      <Row style={{ marginBottom: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10 }}>
          <Text style={{ marginRight: 6 }}>🔍</Text>
          <TextInput value={q} onChangeText={setQ} placeholder='Search headlines, rationales, Fed, CPI, gold…' placeholderTextColor={C.mut} style={{ flex: 1, color: C.tx, paddingVertical: 9, fontSize: 14 }} />
          {!!q && <TouchableOpacity onPress={() => setQ('')}><T c={C.mut} s={16}>✕</T></TouchableOpacity>}
        </View>
        {(q || asset || imp !== 'ALL' || cat !== 'Top Stories') && <Btn t='Reset' on={() => setNf(NF0)} style={{ marginLeft: 8, paddingVertical: 9 }} />}
      </Row>

      <Pills opts={CATS.map(c => [c, c])} val={cat} set={setCat} />
      <Pills opts={[['ALL', `All Impact (${impCnt('ALL')})`], ['HIGH', `🔴 High Impact (${impCnt('HIGH')})`], ['MEDIUM', `🟠 Medium Impact (${impCnt('MEDIUM')})`]]} val={imp} set={setImp} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
        <TouchableOpacity onPress={() => setAsset(null)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 6, backgroundColor: !asset ? '#e6ebff' : C.card, borderWidth: 1, borderColor: C.line }}>
          <T s={12} w='700' c={!asset ? C.bg : C.tx}>All assets</T>
        </TouchableOpacity>
        {ASSETS.map(x => {
          const on = asset === x, k = cnt(x);
          return (
            <TouchableOpacity key={x} onPress={() => setAsset(on ? null : x)} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 6, paddingVertical: 6, borderRadius: 16, marginRight: 6, backgroundColor: on ? '#e6ebff' : C.card, borderWidth: 1, borderColor: on ? '#e6ebff' : C.line }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: AS[x][0], marginRight: 6 }} />
              <T s={12} w='700' c={on ? C.bg : C.tx}>{x}</T>
              <View style={{ minWidth: 22, marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, backgroundColor: on ? C.bg : k ? C.ac : C.line, alignItems: 'center' }}>
                <T s={11} w='800' c={on || k ? '#fff' : C.mut}>{k}</T>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, width: '100%' }}>
          {!!asset && <ImpactSummary asset={asset} news={news} />}
          {!lead && <Card><T c={C.mut}>No stories match these filters yet.</T></Card>}
          {lead && (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => setSel(lead)}>
                <Thumb n={lead} big style={{ width: '100%', height: wide ? 230 : 170 }} />
                <View style={{ padding: 14 }}>
                  <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                    <View style={{ marginRight: 8 }}><Badge n={lead} /></View>
                    <ImpactTag n={lead} />
                  </Row>
                  <T s={20} w='800' style={{ marginTop: 8 }}>{lead.title}</T>
                  <SentimentBadge n={lead} />
                  {!!lead.rationale && <T s={12} c={C.tx} style={{ marginTop: 5 }}>↳ {lead.rationale}</T>}
                  <T c={C.mut} s={11} style={{ marginTop: 5 }}>{relT(lead)}</T>
                </View>
              </TouchableOpacity>
            </Card>
          )}
          {sec('🔴', 'High Impact News', C.dn, highs)}
          {sec('🟠', 'Medium Impact News', C.warn, meds)}
          {sec('📰', 'Other Market News', C.mut, others)}
        </View>
        <View style={{ width: wide ? 320 : '100%', marginLeft: wide ? 20 : 0, marginTop: wide ? 0 : 12 }}>
          <SideBox title='Market Movers' items={movers} />
          <SideBox title='From Your Journal Pairs' items={picks} />
        </View>
      </View>

      <Reader n={sel} onClose={() => setSel(null)} />
    </>
  );
}

// ============================================================================
// 13. DYNAMIC ECONOMIC CALENDAR (PRESERVED TRADINGVIEW/FXSTREET + IST)
// ============================================================================

const MAJ = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const INV_RX = /unemployment|jobless|claims|deficit|insolvenc|bankruptc|layoff/i;
const numCal = s => {
  if (s == null || s === '') return NaN;
  const cleaned = String(s).trim().replace(/[€£¥$,]/g, '');
  const m = cleaned.match(/^([+-]?[\d.]+)\s*([KMBT%]?)/i);
  if (!m) return NaN;
  return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1);
};
const verdictCal = e => {
  const a = numCal(e.actual), f = numCal(e.forecast);
  if (isNaN(a) || isNaN(f) || a === f) return 0;
  return ((a > f) !== INV_RX.test(e.title)) ? 1 : -1;
};
const istMid = t => { const d = ist(t); return Date.UTC(d.y, d.mon, d.day) - IST; };
const istDayId = t => { const d = ist(t); return `${d.y}-${p2(d.mon + 1)}-${p2(d.day)}`; };
const sunStart = t => { const m0 = istMid(t), d = ist(m0); return m0 - d.wd * DAY_MS; };

const CAL_GLOSSARY = [
  [/\bcpi\b|consumer price|hicp|inflation/i, 'Measures the change in prices paid by consumers for goods and services.', 'Drives central bank rate paths; hot prints force tighter policy.'],
  [/\bpce\b/i, 'Measures consumer price changes; Core PCE excludes food & energy.', 'Primary inflation benchmark watched by the Federal Reserve.'],
  [/\bgdp\b|gross domestic/i, 'Measures inflation-adjusted total economic output.', 'Primary gauge of expansion vs contraction.'],
  [/non-?farm|\bnfp\b|employment change|payrolls/i, 'Monthly change in total employed workers.', 'Leading indicator of wage pressure and consumer demand.'],
  [/unemployment|jobless|claims/i, 'Percentage of labor force unemployed or claiming benefits.', 'Rising joblessness signals slack and raises cut odds.'],
  [/\bpmi\b|\bism\b|purchasing managers/i, 'Survey diffusion index (>50 expansion, <50 contraction).', 'Fast leading gauge of business demand.'],
  [/retail sales/i, 'Total receipts of retail stores.', 'Key gauge of household consumption.'],
  [/rate decision|cash rate|bank rate|policy rate|federal funds|official cash|monetary policy|fomc|mpc|ecb press/i, 'Benchmark short-term interest rate decision and guidance.', 'Core driver of sovereign yield differentials and FX carry.']
];

function eventDetailInfo(e) {
  const inv = INV_RX.test(e.title);
  const hit = CAL_GLOSSARY.find(([rx]) => rx.test(e.title));
  return {
    desc: e.detail || hit?.[1] || `Scheduled ${e.currency} macroeconomic release.`,
    why: hit?.[2] || `Surprises versus consensus reprice ${e.currency} rate expectations.`,
    usual: inv ? `'Actual' lower than 'Forecast' is typically bullish for ${e.currency}.` : `'Actual' higher than 'Forecast' is typically bullish for ${e.currency}.`
  };
}

function ImpactFolder({ impact }) {
  const bg = { High: '#dc2626', Medium: '#f97316', Low: '#eab308' }[impact] || '#64748b';
  return (
    <View style={{ width: 20, height: 16, justifyContent: 'flex-end', alignItems: 'flex-start' }}>
      <View style={{ width: 9, height: 4, backgroundColor: bg, borderTopLeftRadius: 2, borderTopRightRadius: 2, marginLeft: 1 }} />
      <View style={{ width: 20, height: 12, backgroundColor: bg, borderRadius: 2, borderTopLeftRadius: 0 }} />
    </View>
  );
}

const CAL_TABS = [['Today', 'Today'], ['Tomorrow', 'Tomorrow'], ['This Week', 'This Week'], ['Next Week', 'Next Week'], ['Yesterday', 'Yesterday'], ['Past Releases', 'Past Releases']];

function EconCalendar({ cal, refreshTick = 0 }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const now = useNow();
  const today0 = istMid(now);
  const baseSun = sunStart(now);

  const [cur, setCur] = useState('ALL');
  const [imp, setImp] = useState('ALL');
  const [rangeTab, setRangeTab] = useState('This Week');
  const [activeSun, setActiveSun] = useState(() => sunStart(Date.now()));
  const [openKey, setOpenKey] = useState(null);
  const [viewCal, setViewCal] = useState(cal);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState(null);
  const rangeCache = useRef({});
  const lastTickRef = useRef(refreshTick);
  const reqSeq = useRef(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickYear, setPickYear] = useState(() => ist(Date.now()).y);
  const [pickMon, setPickMon] = useState(() => ist(Date.now()).mon);

  const queryRange = useMemo(() => {
    if (rangeTab === 'Today') { const d = istDayId(today0); return { from: d, to: d, includesToday: true }; }
    if (rangeTab === 'Tomorrow') { const d = istDayId(today0 + DAY_MS); return { from: d, to: d, includesToday: false }; }
    if (rangeTab === 'Yesterday') { const d = istDayId(today0 - DAY_MS); return { from: d, to: d, includesToday: false }; }
    if (rangeTab === 'Past Releases') return { from: istDayId(today0 - 14 * DAY_MS), to: istDayId(today0), includesToday: true };
    return { from: istDayId(activeSun), to: istDayId(activeSun + 6 * DAY_MS), includesToday: today0 >= activeSun && today0 < activeSun + 7 * DAY_MS };
  }, [rangeTab, activeSun, today0]);

  useEffect(() => {
    if (!cal?.items) return;
    const defKey = `${istDayId(baseSun)}_${istDayId(baseSun + 6 * DAY_MS)}`;
    rangeCache.current[defKey] = { t: Date.now(), data: cal };
    if (rangeTab === 'This Week' && activeSun === baseSun) setViewCal(cal);
  }, [cal]);

  const fetchRange = async (force = false) => {
    const key = `${queryRange.from}_${queryRange.to}`;
    const hit = rangeCache.current[key];
    if (!force && hit && Date.now() - hit.t < 120000) { setViewCal(hit.data); setFetchErr(null); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    setFetchErr(null);
    try {
      const q = `?from=${encodeURIComponent(queryRange.from)}&to=${encodeURIComponent(queryRange.to)}${force ? '&force=1' : ''}`;
      const r = await fetch(API + '/api/calendar' + q);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      rangeCache.current[key] = { t: Date.now(), data: j };
      if (seq === reqSeq.current) setViewCal(j);
    } catch (e) {
      if (seq === reqSeq.current) {
        if (hit) setViewCal(hit.data);
        setFetchErr('Unavailable (Source Timeout): ' + (e.message || 'network error'));
      }
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    const isForce = refreshTick !== lastTickRef.current;
    lastTickRef.current = refreshTick;
    fetchRange(isForce);
  }, [queryRange.from, queryRange.to, refreshTick]);

  useEffect(() => {
    if (!queryRange.includesToday) return;
    const id = setInterval(() => fetchRange(false), 120000);
    return () => clearInterval(id);
  }, [queryRange.from, queryRange.to, queryRange.includesToday]);

  const activeSat = activeSun + 6 * DAY_MS;
  const fmtShort = t => { const d = ist(t); return `${MN[d.mon]} ${d.day}`; };
  const fmtShortYr = t => { const d = ist(t); return `${MN[d.mon]} ${d.day}, ${d.y}`; };

  const selectTab = tab => {
    setRangeTab(tab);
    setOpenKey(null);
    if (tab === 'This Week') setActiveSun(baseSun);
    else if (tab === 'Next Week') setActiveSun(baseSun + 7 * DAY_MS);
    else if (tab === 'Today') setActiveSun(baseSun);
    else if (tab === 'Tomorrow') setActiveSun(sunStart(today0 + DAY_MS));
    else if (tab === 'Yesterday') setActiveSun(sunStart(today0 - DAY_MS));
  };

  const shiftWeek = delta => {
    const nextSun = activeSun + delta * 7 * DAY_MS;
    setActiveSun(nextSun);
    setOpenKey(null);
    setRangeTab(nextSun === baseSun ? 'This Week' : nextSun === baseSun + 7 * DAY_MS ? 'Next Week' : 'Custom Week');
    const d = ist(nextSun);
    setPickYear(d.y); setPickMon(d.mon);
  };

  const jumpToDateMs = ms => {
    const s = sunStart(ms);
    setActiveSun(s);
    setOpenKey(null);
    setRangeTab(s === baseSun ? 'This Week' : s === baseSun + 7 * DAY_MS ? 'Next Week' : 'Custom Week');
    setPickerOpen(false);
  };

  const navLabel = () => {
    if (rangeTab === 'Today') return `Today: ${WD[ist(today0).wd]} ${fmtShortYr(today0)}`;
    if (rangeTab === 'Tomorrow') { const t1 = today0 + DAY_MS; return `Tomorrow: ${WD[ist(t1).wd]} ${fmtShortYr(t1)}`; }
    if (rangeTab === 'Yesterday') { const tm1 = today0 - DAY_MS; return `Yesterday: ${WD[ist(tm1).wd]} ${fmtShortYr(tm1)}`; }
    if (rangeTab === 'Past Releases') return `Past 14 Days: ${fmtShort(today0 - 14 * DAY_MS)} – ${fmtShort(today0)}`;
    const diffWks = Math.round((activeSun - baseSun) / (7 * DAY_MS));
    const prefix = diffWks === 0 ? 'This Week' : diffWks === 1 ? 'Next Week' : diffWks === -1 ? 'Last Week' : 'Week';
    return `${prefix}: ${fmtShort(activeSun)} – ${fmtShortYr(activeSat)}`;
  };

  const miniCalWeeks = useMemo(() => {
    const firstUtc = Date.UTC(pickYear, pickMon, 1) - IST;
    const firstWd = ist(firstUtc).wd;
    const daysInMon = new Date(Date.UTC(pickYear, pickMon + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < firstWd; i++) cells.push(null);
    for (let day = 1; day <= daysInMon; day++) {
      const ms = Date.UTC(pickYear, pickMon, day) - IST;
      cells.push({ day, ms, inActiveWk: ms >= activeSun && ms < activeSun + 7 * DAY_MS, isToday: istDayId(ms) === istDayId(now) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [pickYear, pickMon, activeSun, today0]);

  const items = viewCal?.items || [];
  const filtered = items.filter(e => {
    if (cur !== 'ALL' && e.currency !== cur) return false;
    if (imp !== 'ALL' && e.impact !== imp) return false;
    const ts = new Date(e.timestamp).getTime();
    if (rangeTab === 'Today') return ts >= today0 && ts < today0 + DAY_MS;
    if (rangeTab === 'Tomorrow') return ts >= today0 + DAY_MS && ts < today0 + 2 * DAY_MS;
    if (rangeTab === 'Yesterday') return ts >= today0 - DAY_MS && ts < today0;
    if (rangeTab === 'Past Releases') return ts < now && ts >= today0 - 14 * DAY_MS;
    return ts >= activeSun && ts < activeSun + 7 * DAY_MS;
  });

  const byDay = {};
  filtered.forEach(e => { const k = istDayId(new Date(e.timestamp).getTime()); (byDay[k] ??= []).push(e); });

  let dayList = [];
  if (rangeTab === 'This Week' || rangeTab === 'Next Week' || rangeTab === 'Custom Week') {
    for (let i = 0; i < 7; i++) {
      const tDay = activeSun + i * DAY_MS, d = ist(tDay), k = istDayId(tDay);
      dayList.push({ key: k, label: `${WD[d.wd]} ${MN[d.mon]} ${d.day}`, isToday: k === istDayId(now), events: (byDay[k] || []).sort((a, b) => a.timestamp.localeCompare(b.timestamp)) });
    }
  } else if (rangeTab === 'Today' || rangeTab === 'Tomorrow' || rangeTab === 'Yesterday') {
    const tDay = rangeTab === 'Today' ? today0 : rangeTab === 'Tomorrow' ? today0 + DAY_MS : today0 - DAY_MS;
    const d = ist(tDay), k = istDayId(tDay);
    dayList.push({ key: k, label: `${WD[d.wd]} ${MN[d.mon]} ${d.day}`, isToday: k === istDayId(now), events: (byDay[k] || []).sort((a, b) => a.timestamp.localeCompare(b.timestamp)) });
  } else {
    dayList = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).map(k => {
      const evs = byDay[k].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const d = ist(new Date(evs[0].timestamp).getTime());
      return { key: k, label: `${WD[d.wd]} ${MN[d.mon]} ${d.day}`, isToday: k === istDayId(now), events: evs };
    });
  }

  const W = { date: 86, time: 56, cur: 44, imp: 40, det: 42, act: 74, fcst: 72, prev: 72 };
  const curYr = ist(now).y;
  const quickYears = [curYr - 1, curYr, curYr + 1, curYr + 2];

  return (
    <>
      <T s={24} w='800'>Economic Calendar</T>
      <Note>All times in IST (Asia/Kolkata). Powered dynamically by TradingView &amp; FXStreet for any past or future date range. Active feed: {viewCal?.provider || 'Loading…'}.{viewCal?.stale ? ' (STALE cache)' : ''}</Note>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.line }}><T s={14} w='800'>‹</T></TouchableOpacity>
        <TouchableOpacity onPress={() => setPickerOpen(o => !o)} style={{ alignItems: 'center', flex: 1, paddingHorizontal: 8 }}>
          <Row style={{ justifyContent: 'center' }}>
            <T s={14} w='800'>{navLabel()}</T>
            <View style={{ marginLeft: 8, backgroundColor: pickerOpen ? C.ac : C.bg, borderRadius: 6, borderWidth: 1, borderColor: pickerOpen ? C.ac : C.line, paddingHorizontal: 7, paddingVertical: 2 }}>
              <T s={10} w='700' c={pickerOpen ? '#fff' : C.ac}>📅 Jump</T>
            </View>
          </Row>
          <T c={C.mut} s={10} style={{ marginTop: 2 }}>{loading ? 'Loading live schedule…' : `${filtered.length} events shown${viewCal?.actualsCount ? ` · ${viewCal.actualsCount} live actuals` : ''}`}</T>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => shiftWeek(1)} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.line }}><T s={14} w='800'>›</T></TouchableOpacity>
      </View>

      {pickerOpen && (
        <Card title='Jump to any month, year, or week' style={{ borderColor: C.ac }}>
          <Row style={{ marginBottom: 8 }}>
            <Row style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <TouchableOpacity onPress={() => setPickYear(y => y - 1)} style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: C.bg, borderRadius: 6, borderWidth: 1, borderColor: C.line, marginRight: 6 }}><T s={12} w='800'>‹</T></TouchableOpacity>
              {quickYears.map(y => (
                <TouchableOpacity key={y} onPress={() => setPickYear(y)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginRight: 6, backgroundColor: pickYear === y ? C.ac : C.bg, borderWidth: 1, borderColor: pickYear === y ? C.ac : C.line }}>
                  <T s={12} w='700' c={pickYear === y ? '#fff' : C.tx}>{y}</T>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => setPickYear(y => y + 1)} style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: C.bg, borderRadius: 6, borderWidth: 1, borderColor: C.line }}><T s={12} w='800'>›</T></TouchableOpacity>
            </Row>
            <TouchableOpacity onPress={() => { setPickerOpen(false); selectTab('This Week'); }} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: C.line }}><T s={11} w='700'>Today</T></TouchableOpacity>
          </Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {MN.map((m, idx) => (
              <TouchableOpacity key={m} onPress={() => setPickMon(idx)} style={{ width: '16.66%', padding: 2 }}>
                <View style={{ paddingVertical: 5, borderRadius: 6, alignItems: 'center', backgroundColor: pickMon === idx ? C.ac : C.bg, borderWidth: 1, borderColor: pickMon === idx ? C.ac : C.line }}>
                  <T s={11} w='700' c={pickMon === idx ? '#fff' : C.tx}>{m}</T>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.line, padding: 8 }}>
            <Row style={{ marginBottom: 4 }}>{WD.map(w => <T key={w} c={C.mut} s={10} w='700' style={{ flex: 1, textAlign: 'center' }}>{w}</T>)}</Row>
            {miniCalWeeks.map((wk, wi) => (
              <Row key={wi} style={{ marginBottom: 2 }}>
                {wk.map((cell, ci) => cell ? (
                  <TouchableOpacity key={ci} onPress={() => jumpToDateMs(cell.ms)} style={{ flex: 1, paddingVertical: 5, marginHorizontal: 1, borderRadius: 5, alignItems: 'center', backgroundColor: cell.inActiveWk ? '#1d4ed8' : cell.isToday ? '#14532d' : 'transparent' }}>
                    <T s={12} w={cell.inActiveWk || cell.isToday ? '800' : '400'} c={cell.inActiveWk || cell.isToday ? '#fff' : C.tx}>{cell.day}</T>
                  </TouchableOpacity>
                ) : <View key={ci} style={{ flex: 1 }} />)}
              </Row>
            ))}
          </View>
        </Card>
      )}

      <Pills opts={CAL_TABS} val={rangeTab} set={selectTab} />
      <Pills opts={[['ALL', 'All'], ...MAJ.map(c => [c, c])]} val={cur} set={setCur} />
      <Pills opts={[['ALL', 'All Impact'], ['High', '🔴 High Impact'], ['Medium', '🟠 Medium Impact']]} val={imp} set={setImp} />
      {!!fetchErr && <Card style={{ borderColor: C.warn }}><T c={C.warn} s={12}>{fetchErr}</T></Card>}

      <Card style={{ padding: 0, overflow: 'hidden', opacity: loading ? 0.7 : 1 }}>
        <ScrollView horizontal={!wide} showsHorizontalScrollIndicator={!wide}>
          <View style={{ width: wide ? '100%' : 760, minWidth: wide ? '100%' : 760 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d1636', paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <T c={C.mut} s={10} w='800' style={{ width: W.date }}>DATE</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.time }}>TIME</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.cur, textAlign: 'center' }}>CUR</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.imp, textAlign: 'center' }}>IMP</T>
              <T c={C.mut} s={10} w='800' style={{ flex: 1, paddingHorizontal: 6 }}>EVENT</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.det, textAlign: 'center' }}>DET</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.act, textAlign: 'right' }}>ACTUAL</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.fcst, textAlign: 'right' }}>FCST</T>
              <T c={C.mut} s={10} w='800' style={{ width: W.prev, textAlign: 'right' }}>PREV</T>
            </View>
            {dayList.map((day, di) => (
              <View key={day.key} style={{ borderTopWidth: di === 0 ? 0 : 2, borderTopColor: C.line }}>
                {day.events.length === 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 8 }}>
                    <View style={{ width: W.date }}><T s={12} w='800' c={day.isToday ? C.ac : C.tx}>{day.label}</T></View>
                    <T c={C.mut} s={12} style={{ flex: 1, fontStyle: 'italic' }}>{loading ? 'Fetching events…' : 'No scheduled events matching filters'}</T>
                  </View>
                ) : day.events.map((e, idx) => {
                  const ts = new Date(e.timestamp).getTime(), d = ist(ts), past = ts < now, v = verdictCal(e);
                  const rKey = e.id || `${day.key}_${idx}_${e.currency}_${e.title}`;
                  const isOpen = openKey === rKey;
                  const info = isOpen ? eventDetailInfo(e) : null;
                  const hasAct = e.actual != null && e.actual !== '';
                  const actColor = hasAct ? (v > 0 ? C.up : v < 0 ? C.dn : C.tx) : C.mut;
                  return (
                    <View key={rKey} style={{ borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: C.line, backgroundColor: isOpen ? '#16224a' : idx % 2 === 1 ? C.cardAlt : 'transparent' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8 }}>
                        <View style={{ width: W.date }}>{idx === 0 && <T s={12} w='800' c={day.isToday ? C.ac : C.tx}>{day.label}</T>}</View>
                        <T s={12} w='700' c={past ? C.mut : C.tx} style={{ width: W.time }}>{e.time || `${p2(d.h)}:${p2(d.m)}`}</T>
                        <View style={{ width: W.cur, alignItems: 'center' }}><View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><T s={11} w='800' c={C.ac}>{e.currency}</T></View></View>
                        <View style={{ width: W.imp, alignItems: 'center' }}><ImpactFolder impact={e.impact} /></View>
                        <View style={{ flex: 1, paddingHorizontal: 6 }}><T s={13} w={e.impact === 'High' ? '700' : '400'}>{e.title}</T></View>
                        <TouchableOpacity onPress={() => setOpenKey(isOpen ? null : rKey)} style={{ width: W.det, alignItems: 'center' }}><View style={{ backgroundColor: isOpen ? C.ac : C.bg, borderRadius: 6, borderWidth: 1, borderColor: isOpen ? C.ac : C.line, paddingHorizontal: 6, paddingVertical: 2 }}><T s={12}>📄</T></View></TouchableOpacity>
                        <T s={13} w='800' c={actColor} style={{ width: W.act, textAlign: 'right' }}>{hasAct ? e.actual : '—'}</T>
                        <T s={12} style={{ width: W.fcst, textAlign: 'right' }}>{e.forecast || '—'}</T>
                        <T s={12} c={C.mut} style={{ width: W.prev, textAlign: 'right' }}>{e.previous || '—'}</T>
                      </View>
                      {isOpen && info && (
                        <View style={{ backgroundColor: '#0b132e', borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingVertical: 10 }}>
                          <T s={12} style={{ marginBottom: 4 }}><T w='700' c={C.mut}>Measures: </T>{info.desc}</T>
                          <T s={12} style={{ marginBottom: 4 }}><T w='700' c={C.mut}>Why it matters: </T>{info.why}</T>
                          <T s={12}><T w='700' c={C.mut}>Usual effect: </T>{info.usual}</T>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>
    </>
  );
}

// ============================================================================
// 14. WEEKLY TOP PICKS (SORTING/FILTERING + CALIBRATED OPINION ENGINE) (P1.6, P5)
// ============================================================================

function relatedNewsFor(tags, news) {
  if (!news?.length || !tags?.length) return [];
  const w = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return news
    .filter(n => n.cur?.some(c => tags.includes(c)))
    .sort((a, b) => (w[b.impact] || 0) - (w[a.impact] || 0) || String(b.time).localeCompare(String(a.time)))
    .slice(0, 3);
}

function evaluateNonFxAsset(meta, dir, { A, fx, dash, assets, gold }) {
  const D = fx?.data || {}, usd = D.USD || {}, cad = D.CAD || {}, F = dash?.fred || {};
  const ad = meta.key === 'XAUUSD' ? gold : (assets?.data?.[meta.key] || null);
  const usdScore = fx?.scores?.USD?.totalScore || 0;
  const usdStance = usd.stance?.value ?? 0;
  const tips10 = F.tips10y?.value;
  const m1 = ad?.m1 != null ? ad.m1 * 100 : null;
  const fb = [];
  let modelScore = 0;

  if (meta.type === 'METAL' || meta.type === 'METAL_CROSS') {
    const qCur = meta.quote, qScore = fx?.scores?.[qCur]?.totalScore || 0;
    const rateF = -usdStance * 0.9 + (okN(tips10) ? (2.0 - tips10) * 0.45 : 0);
    const usdF = -qScore * 0.65;
    const havenF = A ? ((A.str[21].CHF + A.str[21].JPY) / 2) * 0.25 : 0;
    const momF = okN(m1) ? Math.max(-1.5, Math.min(1.5, m1 * 0.18)) : 0;
    modelScore = rateF + usdF + havenF + momF;
    fb.push({ k: 'RealYld', tag: 'US Real Yields & Fed Path', fav: rateF * dir > 0.2 ? 1 : rateF * dir < -0.2 ? -1 : 0, detail: `10Y TIPS ${okN(tips10) ? f2(tips10) + '%' : 'Unavailable'}, Fed guidance ${usd.centralBank?.guidance || 'Data-Dependent'}` });
    fb.push({ k: 'CCY', tag: `${qCur} Macro Pressure`, fav: usdF * dir > 0.2 ? 1 : usdF * dir < -0.2 ? -1 : 0, detail: `${qCur} 7-factor score ${signedF2(qScore)}` });
    fb.push({ k: 'Haven', tag: 'Safe-Haven Flows', fav: havenF * dir > 0.1 ? 1 : havenF * dir < -0.1 ? -1 : 0, detail: `1M CHF/JPY haven basket avg ${A ? pctRaw((A.str[21].CHF + A.str[21].JPY) / 2) : '—'}` });
  } else if (meta.type === 'INDEX') {
    const rateF = -usdStance * 1.0;
    const gdpF = okN(usd.gdp?.value) ? (usd.gdp.value - 1.8) * 0.6 : 0;
    const momF = okN(m1) ? Math.max(-1.5, Math.min(1.5, m1 * 0.22)) : 0;
    modelScore = rateF + gdpF + momF;
    fb.push({ k: 'Fed', tag: 'Fed Policy & Discount Rate', fav: rateF * dir > 0.2 ? 1 : rateF * dir < -0.2 ? -1 : 0, detail: `Fed rate ${okN(usd.rate?.value) ? f2(usd.rate.value) + '%' : 'Unavailable'} (${usd.centralBank?.guidance || 'Data-Dependent'})` });
    fb.push({ k: 'GDP', tag: 'US Growth Backdrop', fav: gdpF * dir > 0.15 ? 1 : gdpF * dir < -0.15 ? -1 : 0, detail: `US GDP y/y ${okN(usd.gdp?.value) ? f2(usd.gdp.value) + '%' : 'Unavailable'}` });
  } else if (meta.type === 'CRYPTO') {
    const liqF = -usdStance * 1.1 - usdScore * 0.45;
    const momF = okN(m1) ? Math.max(-1.5, Math.min(1.5, m1 * 0.1)) : 0;
    modelScore = liqF + momF;
    fb.push({ k: 'Liq', tag: 'USD Liquidity & Rate Cycle', fav: liqF * dir > 0.2 ? 1 : liqF * dir < -0.2 ? -1 : 0, detail: `USD score ${signedF2(usdScore)}, Fed guidance ${usd.centralBank?.guidance || 'Data-Dependent'}` });
  } else {
    const cadScore = fx?.scores?.CAD?.totalScore || 0;
    const petroF = cadScore * 0.55 - usdScore * 0.4;
    const momF = okN(m1) ? Math.max(-1.5, Math.min(1.5, m1 * 0.18)) : 0;
    modelScore = petroF + momF;
    fb.push({ k: 'Petro', tag: 'Petro-FX (CAD) & USD Pressure', fav: petroF * dir > 0.2 ? 1 : petroF * dir < -0.2 ? -1 : 0, detail: `CAD score ${signedF2(cadScore)} vs USD score ${signedF2(usdScore)}` });
  }
  if (okN(m1)) fb.push({ k: 'Mom', tag: '1M Price Momentum', fav: m1 * dir > 0.5 ? 1 : m1 * dir < -0.5 ? -1 : 0, detail: `${meta.sym} 1M return ${pctRaw(m1)}` });

  const conflicts = [];
  if (okN(m1) && Math.abs(m1) > 1.5 && Math.sign(m1) !== Math.sign(modelScore)) {
    conflicts.push(`1M price momentum (${pctRaw(m1)}) contradicts macro score (${signedF2(modelScore)}).`);
  }
  const conf = Math.round(Math.max(25, Math.min(90, 48 + Math.abs(modelScore) * 16 - conflicts.length * 18)));
  let signal = 'NEUTRAL / NO TRADE';
  let neutralReason = null;
  if (Math.abs(modelScore) < 1.0) {
    neutralReason = `Weak macro driver spread (${signedF2(modelScore)}, threshold ±1.00).`;
  } else if (conflicts.length && Math.abs(modelScore) < 1.8) {
    neutralReason = 'Macro drivers conflict with 1M price momentum.';
  } else if (modelScore >= 2.0 && !conflicts.length) signal = 'STRONG LONG';
  else if (modelScore >= 1.0) signal = 'LONG';
  else if (modelScore <= -2.0 && !conflicts.length) signal = 'STRONG SHORT';
  else if (modelScore <= -1.0) signal = 'SHORT';

  return {
    modelScore: Number(modelScore.toFixed(2)),
    signal,
    neutralReason,
    confidencePct: conf,
    conflicts,
    hasConflict: conflicts.length > 0,
    fb,
    price: ad?.price ?? ad?.value ?? null,
    d1: ad?.d1 ?? null,
    m1: ad?.m1 ?? null,
    source: ad?.source || 'Yahoo Finance',
    observationDate: ad?.observationDate || null
  };
}

function Picks({ A, fx, cal, news, dash, assets, intel, gold, scrollRef }) {
  const [form, setForm] = useState({ pair: '', bias: 'Long', note: '' });
  const [res, setRes] = useState(null);
  const [biasF, setBiasF] = useState('ALL');
  const [curF, setCurF] = useState('ALL');
  const [minConf, setMinConf] = useState(0);
  const [sortBy, setSortBy] = useState('CONF');
  const opinionY = useRef(0);

  const allPicks = useMemo(() => {
    if (!A || !intel) return [];
    const fxItems = (intel.pairSignals || []).map(p => ({
      id: p.pair,
      pair: p.pair,
      category: 'FX',
      currencies: [p.base, p.quote],
      signal: p.signal,
      spread: p.spread,
      confidencePct: p.confidencePct,
      hasConflict: p.hasConflict,
      conflicts: p.conflicts,
      neutralReason: p.neutralReason,
      price: p.spot,
      dp: p.quote === 'JPY' ? 3 : 5,
      newsTags: [p.base, p.quote],
      lastCalculated: p.lastCalculated,
      reasons: [
        `7-Factor Macro Spread: ${signedF2(p.spread)} (Real Yield Diff ${p.realYieldDiff != null ? signedF2(p.realYieldDiff) + '%' : '—'})`,
        `1M FX Momentum Spread: ${signedF2(p.momentumSpread1M)}% · COT OI Spread: ${p.cotSpreadOiPct != null ? signedF2(p.cotSpreadOiPct) + '%' : '—'}`,
        `Multi-Timeframe: ST ${p.multiTimeframe?.shortTerm?.bias} · MT ${p.multiTimeframe?.mediumTerm?.bias} · LT ${p.multiTimeframe?.longTerm?.bias}`
      ]
    }));

    const nonFxSyms = ['XAU/USD', 'XAG/USD', 'US30', 'NAS100', 'BTC/USD', 'USOIL'];
    const nonFxItems = nonFxSyms.map(sym => {
      const meta = resolveSymbol(sym);
      const ev = evaluateNonFxAsset(meta, 1, { A, fx, dash, assets, gold });
      return {
        id: sym,
        pair: sym,
        category: meta.type === 'METAL' ? 'Metals' : meta.type === 'INDEX' ? 'Indices' : meta.type === 'CRYPTO' ? 'Crypto' : 'Energy',
        currencies: [meta.quote, meta.key],
        signal: ev.signal,
        spread: ev.modelScore,
        confidencePct: ev.confidencePct,
        hasConflict: ev.hasConflict,
        conflicts: ev.conflicts,
        neutralReason: ev.neutralReason,
        price: ev.price,
        dp: meta.dp,
        newsTags: meta.newsTags,
        lastCalculated: intel.calculatedAt,
        reasons: ev.fb.map(x => `${x.tag}: ${x.detail}`)
      };
    });

    return [...fxItems, ...nonFxItems];
  }, [A, intel, fx, dash, assets, gold]);

  const filteredPicks = useMemo(() => {
    let list = allPicks.filter(p => {
      if (biasF === 'ACTIVE' && p.signal === 'NEUTRAL / NO TRADE') return false;
      if (biasF === 'LONG' && !p.signal.includes('LONG')) return false;
      if (biasF === 'SHORT' && !p.signal.includes('SHORT')) return false;
      if (biasF === 'NEUTRAL' && p.signal !== 'NEUTRAL / NO TRADE') return false;
      if (curF !== 'ALL' && !p.currencies.includes(curF) && p.category !== curF) return false;
      if (p.confidencePct < minConf) return false;
      return true;
    });
    if (sortBy === 'CONF') list.sort((a, b) => b.confidencePct - a.confidencePct || Math.abs(b.spread) - Math.abs(a.spread));
    else list.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
    return list.slice(0, 12);
  }, [allPicks, biasF, curF, minConf, sortBy]);

  if (!A || !intel) return <Wait />;

  const runOpinion = (pairStr, bias, note) => {
    const meta = resolveSymbol(pairStr);
    if (!meta) {
      setRes({ err: 'Enter a valid G8 FX pair (e.g. EUR/USD, USD/JPY) or asset (XAU/USD, XAG/USD, US30, NAS100, BTC/USD, USOIL).' });
      return;
    }
    const dir = bias === 'Long' ? 1 : -1;
    const relNews = relatedNewsFor(meta.newsTags, news);
    const evCal = (cal?.items || []).filter(e => e.impact === 'High' && meta.calCurs.includes(e.currency) && new Date(e.timestamp) > Date.now()).slice(0, 5);

    if (meta.type === 'FX') {
      const p = (intel.pairSignals || []).find(x => x.base === meta.base && x.quote === meta.quote);
      const rev = !p ? (intel.pairSignals || []).find(x => x.base === meta.quote && x.quote === meta.base) : null;
      const spread = p ? p.spread : rev ? -rev.spread : 0;
      const sigObj = p || rev;
      const aligned = (dir > 0 && spread >= 1.5) || (dir < 0 && spread <= -1.5);
      setRes({
        sym: meta.sym,
        bias,
        note,
        signal: sigObj?.signal || 'NEUTRAL / NO TRADE',
        confidencePct: sigObj?.confidencePct ?? 45,
        conflicts: sigObj?.conflicts || [],
        neutralReason: sigObj?.neutralReason,
        verdict: Math.abs(spread) < 1.5 ? ['Neutral — Insufficient macro edge (<1.50 spread)', C.warn] : aligned ? ['Supported by Calibrated Macro Model', C.up] : ['Contradicts Calibrated Macro Model', C.dn],
        reasons: [
          `Macro Spread: ${signedF2(spread)} (${meta.base} ${signedF2(fx?.scores?.[meta.base]?.totalScore)} vs ${meta.quote} ${signedF2(fx?.scores?.[meta.quote]?.totalScore)})`,
          `Real Yield Diff: ${sigObj?.realYieldDiff != null ? signedF2(p ? sigObj.realYieldDiff : -sigObj.realYieldDiff) + '%' : '—'}`,
          `1M Momentum Spread: ${signedF2(p ? sigObj?.momentumSpread1M : -(sigObj?.momentumSpread1M || 0))}%`
        ],
        relNews,
        evCal,
        lastCalculated: sigObj?.lastCalculated || new Date().toISOString()
      });
    } else {
      const ev = evaluateNonFxAsset(meta, dir, { A, fx, dash, assets, gold });
      const aligned = (dir > 0 && ev.modelScore >= 1.0) || (dir < 0 && ev.modelScore <= -1.0);
      setRes({
        sym: meta.sym,
        bias,
        note,
        signal: ev.signal,
        confidencePct: ev.confidencePct,
        conflicts: ev.conflicts,
        neutralReason: ev.neutralReason,
        verdict: Math.abs(ev.modelScore) < 1.0 ? ['Neutral — Mixed macro drivers', C.warn] : aligned ? ['Supported by Cross-Asset Drivers', C.up] : ['Against Cross-Asset Drivers', C.dn],
        reasons: ev.fb.map(x => `${x.tag}: ${x.detail}`),
        relNews,
        evCal,
        lastCalculated: new Date().toISOString()
      });
    }
    if (scrollRef?.current && opinionY.current > 0) {
      setTimeout(() => scrollRef.current.scrollTo({ y: Math.max(0, opinionY.current - 12), animated: true }), 50);
    }
  };

  return (
    <>
      <T s={24} w='800'>Weekly Top Picks</T>
      <Note>
        Multi-asset setups across 28 FX crosses, Metals (Unified Gold &amp; Silver), US Indices, Crypto, and Energy. Filter by bias, confidence %, currency, or asset class. Global Regime: {intel.macroRegime?.regime}.
      </Note>

      {/* Priority 5: Sorting & Filtering Controls */}
      <Card title='Filter & Sort Top Picks'>
        <Pills opts={[['ACTIVE', 'Actionable Only'], ['ALL', 'All (incl. Neutral)'], ['LONG', 'Longs'], ['SHORT', 'Shorts'], ['NEUTRAL', 'Neutral']]} val={biasF} set={setBiasF} />
        <Pills opts={[['ALL', 'All'], ['Metals', 'Metals'], ['Indices', 'Indices'], ['Crypto', 'Crypto'], ['Energy', 'Energy'], ...CUR.map(c => [c, c])]} val={curF} set={setCurF} />
        <Pills opts={[[0, 'Any Conf'], [55, '≥55% Conf'], [70, '≥70% Conf']]} val={minConf} set={setMinConf} />
        <Pills opts={[['CONF', 'Sort: Confidence %'], ['SPREAD', 'Sort: Score Spread']]} val={sortBy} set={setSortBy} style={{ marginBottom: 2 }} />
      </Card>

      {!filteredPicks.length && <Card><T c={C.mut}>No setups currently match your filters (weak spreads are automatically gated to NEUTRAL / NO TRADE).</T></Card>}

      {filteredPicks.map(p => {
        const isLong = p.signal.includes('LONG');
        const btnBias = isLong ? 'Long' : 'Short';
        const matchingNews = relatedNewsFor(p.newsTags, news);
        return (
          <Card key={p.id}>
            <Row>
              <Row style={{ justifyContent: 'flex-start' }}>
                <T s={17} w='800'>{p.pair}</T>
                <Tag text={p.category} bg={C.line} fg={C.mut} style={{ marginLeft: 8 }} />
              </Row>
              <SignalBadge signal={p.signal} />
            </Row>
            <T c={C.mut} s={12} style={{ marginTop: 4 }}>
              {p.price != null ? `Ref ${f2(p.price, p.dp)} · ` : 'Ref Unavailable · '}Score Spread <T w='800' c={col(p.spread)}>{signedF2(p.spread)}</T>
            </T>
            <ConfBar pctVal={p.confidencePct} />
            <ConflictBox conflicts={p.conflicts} neutralReason={p.neutralReason} />
            <View style={{ marginTop: 8 }}>
              {p.reasons.map((r, i) => <T key={i} s={12} style={{ marginBottom: 2 }}>• {r}</T>)}
            </View>
            {!!matchingNews.length && (
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.line }}>
                <T s={10} c={C.mut} w='800'>LIVE NEWS CATALYST</T>
                <T s={11} style={{ marginTop: 2 }}>{matchingNews[0].title} ({matchingNews[0].tone}, {matchingNews[0].sentimentConfidence}% conf)</T>
              </View>
            )}
            <Row style={{ marginTop: 8 }}>
              <Btn primary small t={`Stress-test ${btnBias} ${p.pair} →`} on={() => { setForm({ pair: p.pair, bias: btnBias, note: '' }); runOpinion(p.pair, btnBias, ''); }} />
              <T s={10} c={C.mut}>Calc: {fmtIstTime(p.lastCalculated)}</T>
            </Row>
          </Card>
        );
      })}

      {/* Trade Idea Stress-Tester */}
      <View onLayout={e => { opinionY.current = e.nativeEvent.layout.y; }}>
        <Card title='Multi-Asset Trade Idea → Calibrated Opinion'>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            {QUICK_PILLS.map(sym => (
              <TouchableOpacity key={sym} onPress={() => { setForm(f => ({ ...f, pair: sym })); runOpinion(sym, form.bias, form.note); }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, marginRight: 6, backgroundColor: form.pair.toUpperCase() === sym ? C.ac : C.bg, borderWidth: 1, borderColor: C.line }}>
                <T s={12} w='700'>{sym}</T>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Row style={{ marginBottom: 8 }}>
            <Inp label='Pair / Asset' v={form.pair} set={v => setForm({ ...form, pair: v })} kb='default' flex={2} ph='EUR/USD or XAU/USD' />
            <Btn t={form.bias} on={() => setForm(f => ({ ...f, bias: f.bias === 'Long' ? 'Short' : 'Long' }))} style={{ alignSelf: 'flex-end', backgroundColor: form.bias === 'Long' ? C.upBg : C.dnBg }} />
          </Row>
          <Inp label='Thesis Note (optional)' v={form.note} set={v => setForm({ ...form, note: v })} kb='default' ph='e.g. Real yield divergence after CPI' />
          <Btn primary t='Evaluate Trade Idea' on={() => runOpinion(form.pair, form.bias, form.note)} style={{ alignSelf: 'flex-start', marginTop: 10 }} />
        </Card>

        {res && (res.err ? <Card><T c={C.dn}>{res.err}</T></Card> : (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: res.verdict[1] }}>
            <Row>
              <T s={18} w='800'>{res.bias.toUpperCase()} {res.sym}</T>
              <SignalBadge signal={res.signal} />
            </Row>
            <T s={14} w='700' c={res.verdict[1]} style={{ marginTop: 4 }}>{res.verdict[0]}</T>
            <ConfBar pctVal={res.confidencePct} />
            <ConflictBox conflicts={res.conflicts} neutralReason={res.neutralReason} />
            <T s={10} c={C.mut} w='800' style={{ marginTop: 10 }}>DRIVERS</T>
            {res.reasons.map((r, i) => <T key={i} s={12} style={{ marginTop: 3 }}>• {r}</T>)}
            {!!res.evCal?.length && (
              <>
                <T s={10} c={C.mut} w='800' style={{ marginTop: 10 }}>UPCOMING HIGH-IMPACT RISKS (IST)</T>
                {res.evCal.map((e, i) => <T key={i} s={12} style={{ marginTop: 3 }}>🔴 {e.currency} {e.title} · {e.date} {e.time} IST</T>)}
              </>
            )}
            <T s={10} c={C.mut} style={{ marginTop: 8 }}>Calculated: {fmtIstTime(res.lastCalculated)}</T>
          </Card>
        ))}
      </View>
    </>
  );
}

// ============================================================================
// 15. RISK CALCULATOR & TRADE JOURNAL (ZERO alert()/confirm() CALLS)
// ============================================================================

function Risk({ pre }) {
  const [v, setV] = useState({ bal: '10000', risk: '1', entry: '', stop: '', target: '', pip: '10', size: '0.0001' });
  const u = k => x => setV({ ...v, [k]: x });
  useEffect(() => {
    if (pre) setV(x => ({ ...x, entry: String(pre.entry), size: String(pre.size), stop: '', target: '' }));
  }, [pre?.n]);

  const n = k => parseFloat(v[k]);
  const ok = ['bal', 'risk', 'entry', 'stop', 'pip', 'size'].every(k => !isNaN(n(k)));
  const sp = ok ? Math.abs(n('entry') - n('stop')) / n('size') : null;
  const cash = ok ? (n('bal') * n('risk')) / 100 : null;
  const lots = ok && sp > 0 ? cash / (sp * n('pip')) : null;
  const rr = !isNaN(n('target')) && ok && sp > 0 ? Math.abs(n('target') - n('entry')) / Math.abs(n('entry') - n('stop')) : null;

  return (
    <Card title={'Position Size Calculator' + (pre?.pair ? ' · ' + pre.pair : '')}>
      <Row style={{ marginBottom: 8 }}><Inp label='Account Balance' v={v.bal} set={u('bal')} /><Inp label='Risk %' v={v.risk} set={u('risk')} /></Row>
      <Row style={{ marginBottom: 8 }}><Inp label='Entry' v={v.entry} set={u('entry')} /><Inp label='Stop Loss' v={v.stop} set={u('stop')} /><Inp label='Take Profit' v={v.target} set={u('target')} /></Row>
      <Row style={{ marginBottom: 12 }}><Inp label='Pip value / lot' v={v.pip} set={u('pip')} /><Inp label='Pip size (JPY 0.01)' v={v.size} set={u('size')} /></Row>
      <Row><T c={C.mut}>Risk Amount</T><T w='700'>{f2(cash)}</T></Row>
      <Row><T c={C.mut}>Stop Distance (pips)</T><T w='700'>{f2(sp, 1)}</T></Row>
      <Row><T c={C.mut}>Position Size (lots)</T><T w='800' c={C.ac} s={18}>{f2(lots)}</T></Row>
      <Row><T c={C.mut}>Reward : Risk</T><T w='700'>{rr == null ? '—' : '1 : ' + f2(rr)}</T></Row>
    </Card>
  );
}

function journalStats(t) {
  const r = t.map(x => x.r), w = sum(r.filter(x => x > 0)), l = -sum(r.filter(x => x < 0));
  let e = 0, pk = 0, dd = 0;
  r.forEach(x => { e += x; pk = Math.max(pk, e); dd = Math.max(dd, pk - e); });
  return { n: r.length, wr: r.length ? (r.filter(x => x > 0).length / r.length) * 100 : 0, tot: sum(r), pf: l ? w / l : w ? Infinity : 0, ex: r.length ? sum(r) / r.length : 0, dd };
}
// == START INSERT: FEATURE E (PORTFOLIO EXPOSURE & CORRELATION GUARDRAIL) ==
const EXPOSURE_CUR = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU'];

const WHATIF_PRESETS = [
  {
    label: 'USD Stack (+2x USD)',
    trades: [
      { id: 'sim1', pair: 'USD/CHF', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' },
      { id: 'sim2', pair: 'USD/CAD', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' }
    ]
  },
  {
    label: 'Gold + EUR Short-USD',
    trades: [
      { id: 'sim3', pair: 'XAU/USD', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' },
      { id: 'sim4', pair: 'EUR/USD', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' }
    ]
  },
  {
    label: 'Diversified FX',
    trades: [
      { id: 'sim5', pair: 'EUR/USD', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' },
      { id: 'sim6', pair: 'AUD/JPY', side: 'LONG', lots: 1.0, riskPct: 1.0, status: 'OPEN' }
    ]
  }
];

function decomposeTradePair(rawPair) {
  const meta = resolveSymbol(rawPair);
  if (meta && EXPOSURE_CUR.includes(meta.base) && EXPOSURE_CUR.includes(meta.quote)) {
    return { sym: meta.sym, base: meta.base, quote: meta.quote, type: meta.type };
  }
  const clean = String(rawPair || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length === 6) {
    const b = clean.slice(0, 3), q = clean.slice(3, 6);
    if (EXPOSURE_CUR.includes(b) && EXPOSURE_CUR.includes(q) && b !== q) {
      return { sym: `${b}/${q}`, base: b, quote: q, type: b === 'XAU' || q === 'XAU' ? 'METAL' : 'FX' };
    }
  }
  return null;
}

function pairCorr30D(d1, d2, A, assets) {
  if (d1.sym === d2.sym) return { corr: 1.0, source: 'Identical Pair' };
  const M30 = A?.correlations?.['30D'];

  // 1. Direct 30D log-return correlation for FX-to-FX pairs from ECB history series
  if (d1.type === 'FX' && d2.type === 'FX' && A?.series) {
    const s1 = A.series(d1.base, d1.quote);
    const s2 = A.series(d2.base, d2.quote);
    if (s1?.length >= 31 && s2?.length >= 31) {
      const r1 = [], r2 = [];
      const a1 = s1.slice(-31), a2 = s2.slice(-31);
      for (let i = 1; i < a1.length; i++) {
        r1.push(Math.log(a1[i] / a1[i - 1]));
        r2.push(Math.log(a2[i] / a2[i - 1]));
      }
      return { corr: Number(cor(r1, r2).toFixed(2)), source: '30D FX Returns' };
    }
  }

  // 2. Fallback / XAU cross-check using live 30D currency correlation matrix + Gold/DXY 30D corr
  if (!M30) return null;
  const goldVsUsd = assets?.crossAssetDrivers?.gold?.corrVsDxy?.['30D'] ?? -0.55;
  const cCorr = (x, y) => {
    if (x === y) return 1;
    const ix = CUR.indexOf(x), iy = CUR.indexOf(y);
    if (ix >= 0 && iy >= 0) return M30[ix]?.[iy] ?? 0;
    const fxCur = x === 'XAU' ? y : x;
    const iFx = CUR.indexOf(fxCur), iUsd = CUR.indexOf('USD');
    if (fxCur === 'USD') return goldVsUsd;
    if (iFx >= 0 && iUsd >= 0) return Number((goldVsUsd * (M30[iFx]?.[iUsd] ?? 0)).toFixed(2));
    return 0;
  };

  const num = cCorr(d1.base, d2.base) - cCorr(d1.base, d2.quote) - cCorr(d1.quote, d2.base) + cCorr(d1.quote, d2.quote);
  const den = Math.sqrt(Math.max(0.0001, (2 - 2 * cCorr(d1.base, d1.quote)) * (2 - 2 * cCorr(d2.base, d2.quote))));
  return {
    corr: Number(Math.max(-1, Math.min(1, num / den)).toFixed(2)),
    source: d1.base === 'XAU' || d2.base === 'XAU' ? '30D Matrix + Gold/DXY' : '30D Currency Matrix'
  };
}

function analyzePortfolioExposure(activeTrades, A, assets) {
  const map = {};
  EXPOSURE_CUR.forEach(c => {
    map[c] = { cur: c, netCount: 0, netLots: 0, netRiskPct: 0, grossRiskPct: 0, sharePct: 0 };
  });

  const parsed = [];
  let totalOpenRiskPct = 0;
  let totalLots = 0;

  (activeTrades || []).forEach(t => {
    const dec = decomposeTradePair(t.pair);
    if (!dec) return;
    const dir = String(t.side || 'LONG').toUpperCase() === 'SHORT' ? -1 : 1;
    const lots = Math.max(0.01, parseFloat(t.lots) || 1.0);
    const riskPct = Math.max(0.1, parseFloat(t.riskPct) || 1.0);

    totalOpenRiskPct += riskPct;
    totalLots += lots;
    parsed.push({ ...t, ...dec, dir, lots, riskPct });

    map[dec.base].netCount += dir;
    map[dec.base].netLots += dir * lots;
    map[dec.base].netRiskPct += dir * riskPct;
    map[dec.base].grossRiskPct += riskPct;

    map[dec.quote].netCount -= dir;
    map[dec.quote].netLots -= dir * lots;
    map[dec.quote].netRiskPct -= dir * riskPct;
    map[dec.quote].grossRiskPct += riskPct;
  });

  const rows = EXPOSURE_CUR.map(c => map[c]);
  const totalAbsNetRisk = sum(rows.map(r => Math.abs(r.netRiskPct)));
  const maxAbsRisk = Math.max(...rows.map(r => Math.abs(r.netRiskPct)), 0.01);

  const warnings = [];
  rows.forEach(r => {
    r.sharePct = totalAbsNetRisk > 0 ? (Math.abs(r.netRiskPct) / totalAbsNetRisk) * 100 : 0;
    if (parsed.length >= 2 && r.sharePct > 40) {
      warnings.push({
        severity: r.sharePct >= 50 ? 'RED' : 'AMBER',
        type: 'CONCENTRATION',
        text: `${r.cur} accounts for ${r.sharePct.toFixed(0)}% of net open risk (${r.netCount > 0 ? '+' : ''}${r.netCount}x · ${signedF2(r.netRiskPct)}% risk · ${signedF2(r.netLots)} lots) — exceeds 40% limit.`
      });
    }
  });

  const pairCorrs = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const t1 = parsed[i], t2 = parsed[j];
      const res = pairCorr30D(t1, t2, A, assets);
      if (!res) continue;
      const dirCorr = Number((t1.dir * t2.dir * res.corr).toFixed(2));
      pairCorrs.push({ a: t1, b: t2, rawCorr: res.corr, dirCorr, source: res.source });

      if (dirCorr > 0.70) {
        warnings.push({
          severity: dirCorr >= 0.80 ? 'RED' : 'AMBER',
          type: 'CORRELATION',
          text: `High 30D Stacked Correlation (${signedF2(dirCorr)}): ${t1.side} ${t1.sym} & ${t2.side} ${t2.sym} move strongly together (${res.source}) — directional risk is compounded.`
        });
      } else if (Math.abs(res.corr) > 0.70 && dirCorr < -0.70) {
        warnings.push({
          severity: 'AMBER',
          type: 'HEDGE_OVERLAP',
          text: `Opposing 30D Correlation (${signedF2(res.corr)} raw / ${signedF2(dirCorr)} net): ${t1.side} ${t1.sym} & ${t2.side} ${t2.sym} largely cancel each other out.`
        });
      }
    }
  }

  return {
    parsed,
    rows,
    totalOpenRiskPct,
    totalLots,
    maxAbsRisk,
    pairCorrs,
    warnings,
    hasRed: warnings.some(w => w.severity === 'RED')
  };
}

function PortfolioExposureGuardrail({ trades, A, assets }) {
  const openJournalTrades = useMemo(
    () => (trades || []).filter(t => t.status === 'OPEN'),
    [trades]
  );
  const [simMode, setSimMode] = useState(false);
  const [simTrades, setSimTrades] = useState(WHATIF_PRESETS[0].trades);
  const [simInp, setSimInp] = useState({ pair: 'EUR/USD', side: 'LONG', lots: '1.0', riskPct: '1.0' });

  const usingSim = simMode || openJournalTrades.length === 0;
  const activeList = usingSim ? simTrades : openJournalTrades;
  const analysis = useMemo(() => analyzePortfolioExposure(activeList, A, assets), [activeList, A, assets]);

  const addSimTrade = () => {
    const dec = decomposeTradePair(simInp.pair);
    if (!dec) return;
    setSimTrades(prev => [
      ...prev,
      {
        id: 'sim_' + Date.now(),
        pair: dec.sym,
        side: simInp.side,
        lots: Math.max(0.01, parseFloat(simInp.lots) || 1.0),
        riskPct: Math.max(0.1, parseFloat(simInp.riskPct) || 1.0),
        status: 'OPEN'
      }
    ]);
  };

  return (
    <Card
      title='Portfolio Currency Exposure & 30D Correlation Risk Guardrail'
      style={{ borderColor: analysis.hasRed ? C.dn : analysis.warnings.length ? C.warn : C.line }}
      right={
        <TouchableOpacity
          onPress={() => setSimMode(v => !v)}
          style={{
            backgroundColor: usingSim ? C.acBg : C.upBg,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6
          }}
        >
          <T s={10} w='800' c='#fff'>
            {usingSim ? (openJournalTrades.length ? 'Mode: What-If Sim ⇄' : 'What-If Simulator (0 Open)') : `Live Open (${openJournalTrades.length}) ⇄`}
          </T>
        </TouchableOpacity>
      }
    >
      {/* What-If Simulator Controls (auto-active when 0 open trades, or manually toggled) */}
      {usingSim && (
        <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 9, marginBottom: 10, borderWidth: 1, borderColor: C.line }}>
          <T s={10} c={C.ac} w='800' style={{ marginBottom: 6 }}>
            {openJournalTrades.length === 0
              ? 'NO OPEN JOURNAL TRADES — QUICK WHAT-IF SIMULATION ACTIVE'
              : 'WHAT-IF PORTFOLIO SIMULATOR (DOES NOT MODIFY SAVED JOURNAL)'}
          </T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            {WHATIF_PRESETS.map(pr => (
              <TouchableOpacity
                key={pr.label}
                onPress={() => setSimTrades(pr.trades)}
                style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, marginRight: 6 }}
              >
                <T s={11} w='700'>{pr.label}</T>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setSimTrades([])}
              style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.dn, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 }}
            >
              <T s={11} w='700' c={C.dn}>Clear</T>
            </TouchableOpacity>
          </ScrollView>
          <Row style={{ marginBottom: 6 }}>
            <Inp label='Pair / XAU' v={simInp.pair} set={x => setSimInp(s => ({ ...s, pair: x }))} kb='default' ph='USD/CHF' flex={1.4} />
            <Inp label='Lots' v={simInp.lots} set={x => setSimInp(s => ({ ...s, lots: x }))} ph='1.0' flex={0.7} />
            <Inp label='Risk %' v={simInp.riskPct} set={x => setSimInp(s => ({ ...s, riskPct: x }))} ph='1.0' flex={0.7} />
            <Btn
              small
              t={simInp.side}
              on={() => setSimInp(s => ({ ...s, side: s.side === 'LONG' ? 'SHORT' : 'LONG' }))}
              style={{ alignSelf: 'flex-end', marginRight: 6, backgroundColor: simInp.side === 'LONG' ? C.upBg : C.dnBg }}
            />
            <Btn small primary t='+ Sim' on={addSimTrade} style={{ alignSelf: 'flex-end' }} />
          </Row>
          {simTrades.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
              {simTrades.map(st => (
                <TouchableOpacity
                  key={st.id}
                  onPress={() => setSimTrades(prev => prev.filter(x => x.id !== st.id))}
                  style={{ backgroundColor: st.side === 'LONG' ? C.upBg : C.dnBg, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginBottom: 4 }}
                >
                  <T s={10} w='800' c={st.side === 'LONG' ? C.upTx : C.dnTx}>
                    {st.side} {st.pair} ({st.lots}L · {st.riskPct}%) ✕
                  </T>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Portfolio Risk Summary */}
      <Row style={{ marginBottom: 8 }}>
        <T s={11} c={C.mut}>Active Positions: <T w='800'>{analysis.parsed.length}</T></T>
        <T s={11} c={C.mut}>Total Open Risk: <T w='800' c={analysis.totalOpenRiskPct > 3 ? C.warn : C.tx}>{f2(analysis.totalOpenRiskPct)}%</T></T>
        <T s={11} c={C.mut}>Gross Lots: <T w='800'>{f2(analysis.totalLots)}</T></T>
      </Row>

      {/* Concentration & Correlation Warning Callouts */}
      {analysis.warnings.length > 0 ? (
        <View
          style={{
            backgroundColor: analysis.hasRed ? '#2a0d14' : '#2c1a06',
            borderWidth: 1,
            borderColor: analysis.hasRed ? C.dn : C.warn,
            borderRadius: 8,
            padding: 9,
            marginBottom: 10
          }}
        >
          <T s={11} w='800' c={analysis.hasRed ? C.dnTx : C.warnTx}>
            {analysis.hasRed ? '🚨 CONCENTRATION & CORRELATION RISK ALERT' : '⚠ CONCENTRATION & CORRELATION WARNING'}
          </T>
          {analysis.warnings.map((w, idx) => (
            <T key={idx} s={11} c={w.severity === 'RED' ? C.dnTx : C.warnTx} style={{ marginTop: 4 }}>
              • [{w.type}] {w.text}
            </T>
          ))}
        </View>
      ) : analysis.parsed.length >= 2 ? (
        <View style={{ backgroundColor: '#0d2b1d', borderWidth: 1, borderColor: '#166534', borderRadius: 8, padding: 8, marginBottom: 10 }}>
          <T s={11} w='700' c={C.upTx}>✓ Portfolio Guardrail Clear: No currency exceeds 40% net exposure and no open pair correlation exceeds 0.70 (30D).</T>
        </View>
      ) : (
        <T s={11} c={C.mut} style={{ marginBottom: 10 }}>
          {analysis.parsed.length === 1
            ? 'Single open position (50%/50% base/quote split). Add a 2nd open trade to evaluate multi-pair concentration & 30D correlation overlap.'
            : 'Add open trades or pick a What-If preset above to inspect decomposed currency exposure.'}
        </T>
      )}

      {/* Visual Bi-Directional Bar Chart & Table of Net Currency Exposure */}
      <Row style={{ paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <T s={10} c={C.mut} w='800' style={{ width: 38 }}>CCY</T>
        <T s={10} c={C.mut} w='800' style={{ flex: 1, textAlign: 'center' }}>NET EXPOSURE BAR (SHORT ◀ | ▶ LONG)</T>
        <T s={10} c={C.mut} w='800' style={{ width: 38, textAlign: 'right' }}>NET</T>
        <T s={10} c={C.mut} w='800' style={{ width: 50, textAlign: 'right' }}>LOTS</T>
        <T s={10} c={C.mut} w='800' style={{ width: 54, textAlign: 'right' }}>RISK %</T>
        <T s={10} c={C.mut} w='800' style={{ width: 42, textAlign: 'right' }}>SHR</T>
      </Row>

      {analysis.rows.map(r => {
        const wPct = Math.min(100, (Math.abs(r.netRiskPct) / analysis.maxAbsRisk) * 100);
        const overLimit = analysis.parsed.length >= 2 && r.sharePct > 40;
        const isPos = r.netRiskPct > 0;
        const isNeg = r.netRiskPct < 0;
        return (
          <Row
            key={r.cur}
            style={{
              paddingVertical: 5,
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(30,42,82,0.5)',
              backgroundColor: overLimit ? 'rgba(245,158,11,0.08)' : 'transparent'
            }}
          >
            <T s={12} w='800' c={overLimit ? C.warn : r.netRiskPct !== 0 ? C.tx : C.mut} style={{ width: 38 }}>{r.cur}</T>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 12, marginHorizontal: 6 }}>
              <View style={{ flex: 1, alignItems: 'flex-end', backgroundColor: C.bg, height: 10, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, overflow: 'hidden' }}>
                {isNeg && <View style={{ width: `${wPct}%`, height: 10, backgroundColor: overLimit ? C.warn : C.dn }} />}
              </View>
              <View style={{ width: 1, height: 14, backgroundColor: C.line }} />
              <View style={{ flex: 1, alignItems: 'flex-start', backgroundColor: C.bg, height: 10, borderTopRightRadius: 3, borderBottomRightRadius: 3, overflow: 'hidden' }}>
                {isPos && <View style={{ width: `${wPct}%`, height: 10, backgroundColor: overLimit ? C.warn : C.up }} />}
              </View>
            </View>
            <T s={11} w='800' c={col(r.netCount)} style={{ width: 38, textAlign: 'right' }}>
              {r.netCount === 0 ? '0' : `${r.netCount > 0 ? '+' : ''}${r.netCount}x`}
            </T>
            <T s={11} c={r.netLots === 0 ? C.mut : C.tx} style={{ width: 50, textAlign: 'right' }}>
              {r.netLots === 0 ? '—' : signedF2(r.netLots, 2)}
            </T>
            <T s={11} w='700' c={col(r.netRiskPct)} style={{ width: 54, textAlign: 'right' }}>
              {r.netRiskPct === 0 ? '—' : `${signedF2(r.netRiskPct, 1)}%`}
            </T>
            <T s={10} w='800' c={overLimit ? C.warn : C.mut} style={{ width: 42, textAlign: 'right' }}>
              {r.sharePct > 0 ? `${Math.round(r.sharePct)}%` : '—'}
            </T>
          </Row>
        );
      })}

      {/* Live 30D Pairwise Correlation Cross-Check */}
      {analysis.pairCorrs.length > 0 && (
        <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
          <T s={10} c={C.mut} w='800' style={{ marginBottom: 4 }}>OPEN PAIR 30D CORRELATION CROSS-CHECK</T>
          {analysis.pairCorrs.map((pc, idx) => {
            const hot = pc.dirCorr > 0.70;
            return (
              <Row key={idx} style={{ paddingVertical: 3 }}>
                <T s={11} c={hot ? C.dnTx : C.tx}>
                  {pc.a.side} {pc.a.sym} vs {pc.b.side} {pc.b.sym}
                </T>
                <T s={11} w='800' c={hot ? C.dn : Math.abs(pc.rawCorr) > 0.70 ? C.warn : C.up}>
                  {signedF2(pc.dirCorr)} eff ({signedF2(pc.rawCorr)} raw)
                </T>
              </Row>
            );
          })}
        </View>
      )}
      {!A?.correlations?.['30D'] && (
        <T s={10} c={C.warn} style={{ marginTop: 6 }}>Live 30D currency correlation matrix is loading — pull to refresh to run pairwise checks.</T>
      )}
    </Card>
  );
}
// == END INSERT: FEATURE E ==
// == START REPLACE: Journal COMPONENT (adds OPEN/CLOSED status, Lots, Risk % & Feature E Guardrail) ==
function Journal({ trades, setTrades, A, assets }) {
  const [p, setP] = useState({ pair: '', side: 'LONG', status: 'OPEN', lots: '1.0', riskPct: '1.0', r: '', thesis: '' });
  const [bk, setBk] = useState('');
  const [msg, setMsg] = useState(null);
  const closedTrades = useMemo(() => trades.filter(t => t.status !== 'OPEN' && okN(t.r)), [trades]);
  const S = journalStats(closedTrades);

  const save = t => { setTrades(t); store.set('trades', t); };
  const add = () => {
    const isOpen = p.status === 'OPEN';
    const r = isOpen ? null : parseFloat(p.r);
    if (!p.pair.trim() || (!isOpen && isNaN(r))) {
      setMsg({ c: C.dn, t: isOpen ? 'Please enter a pair symbol.' : 'Please enter both a pair symbol and a numeric R result.' });
      return;
    }
    save([
      ...trades,
      {
        id: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        pair: p.pair.trim().toUpperCase(),
        side: p.side,
        status: p.status,
        lots: Math.max(0.01, parseFloat(p.lots) || 1.0),
        riskPct: Math.max(0.1, parseFloat(p.riskPct) || 1.0),
        r,
        thesis: p.thesis
      }
    ]);
    setP({ ...p, pair: '', r: '', thesis: '' });
    setMsg({ c: C.up, t: isOpen ? 'Open trade added to active exposure guardrail.' : 'Closed trade logged to journal.' });
  };
  const toggleStatus = id => {
    save(trades.map(t => (t.id === id ? { ...t, status: t.status === 'OPEN' ? 'CLOSED' : 'OPEN' } : t)));
  };
  const restore = () => {
    try {
      const j = JSON.parse(bk);
      if (!Array.isArray(j)) throw new Error('Expected array');
      save(j);
      setBk('');
      setMsg({ c: C.up, t: `Restored ${j.length} trades from backup.` });
    } catch {
      setMsg({ c: C.dn, t: 'Invalid backup JSON format.' });
    }
  };
  const csv = () => Share.share({ message: 'date,pair,side,status,lots,riskPct,r,thesis\n' + trades.map(t => [t.date, t.pair, t.side, t.status || 'CLOSED', t.lots || 1, t.riskPct || 1, t.r ?? '', '"' + (t.thesis || '').replace(/"/g, '""') + '"'].join(',')).join('\n') }).catch(() => {});

  return (
    <>
      <PortfolioExposureGuardrail trades={trades} A={A} assets={assets} />

      <Card title='Journal Performance (Closed Trades)'>
        <Row><T c={C.mut}>Closed Trades</T><T>{S.n}</T></Row>
        <Row><T c={C.mut}>Win Rate</T><T>{f2(S.wr, 1)}%</T></Row>
        <Row><T c={C.mut}>Total R</T><T c={col(S.tot)} w='700'>{signedF2(S.tot)}R</T></Row>
        <Row><T c={C.mut}>Profit Factor</T><T>{S.pf === Infinity ? '∞' : f2(S.pf)}</T></Row>
        <Row><T c={C.mut}>Expectancy (R)</T><T c={col(S.ex)}>{signedF2(S.ex)}R</T></Row>
        <Row><T c={C.mut}>Max Drawdown (R)</T><T c={C.dn}>{f2(S.dd)}R</T></Row>
      </Card>
      <Card title='Log Trade'>
        {!!msg && <T s={12} w='700' c={msg.c} style={{ marginBottom: 8 }}>{msg.t}</T>}
        <Row style={{ marginBottom: 8 }}>
          <Inp label='Pair / XAU' v={p.pair} set={x => setP({ ...p, pair: x })} kb='default' ph='EUR/USD' flex={1.3} />
          <Inp label='Lots' v={p.lots} set={x => setP({ ...p, lots: x })} ph='1.0' flex={0.7} />
          <Inp label='Risk %' v={p.riskPct} set={x => setP({ ...p, riskPct: x })} ph='1.0' flex={0.7} />
          {p.status === 'CLOSED' && <Inp label='R Result' v={p.r} set={x => setP({ ...p, r: x })} ph='1.5' flex={0.8} />}
        </Row>
        <Row style={{ marginBottom: 8, justifyContent: 'flex-start' }}>
          <Btn small t={p.side} on={() => setP({ ...p, side: p.side === 'LONG' ? 'SHORT' : 'LONG' })} style={{ marginRight: 8, backgroundColor: p.side === 'LONG' ? C.upBg : C.dnBg }} />
          <Btn small t={`Status: ${p.status}`} on={() => setP({ ...p, status: p.status === 'OPEN' ? 'CLOSED' : 'OPEN' })} style={{ backgroundColor: p.status === 'OPEN' ? C.acBg : C.line }} />
        </Row>
        <Inp label='Macro Thesis' v={p.thesis} set={x => setP({ ...p, thesis: x })} kb='default' ph='Real yield spread + clean COT' />
        <Btn primary t={p.status === 'OPEN' ? 'Add Open Position' : 'Log Closed Trade'} on={add} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
      </Card>
      <Card title='Export / Restore Backup'>
        <Row style={{ justifyContent: 'flex-start' }}>
          <Btn t='Export CSV' on={csv} style={{ marginRight: 8 }} />
          <Btn t='Export JSON' on={() => Share.share({ message: JSON.stringify(trades) }).catch(() => {})} />
        </Row>
        <TextInput value={bk} onChangeText={setBk} placeholder='Paste JSON backup array here' placeholderTextColor={C.mut} multiline style={{ color: C.tx, backgroundColor: C.bg, borderRadius: 8, padding: 8, marginTop: 8, minHeight: 44 }} />
        <Btn t='Restore JSON' on={restore} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
      </Card>
      {trades.slice().reverse().map(t => (
        <Card key={t.id} style={{ padding: 10, marginBottom: 6, borderColor: t.status === 'OPEN' ? C.ac : C.line }}>
          <Row>
            <Row style={{ justifyContent: 'flex-start' }}>
              <T w='700'>{t.pair} <T c={C.mut} s={11}>{t.side} · {t.lots || 1}L · {t.riskPct || 1}% · {t.date}</T></T>
            </Row>
            {t.status === 'OPEN' ? (
              <Tag text='OPEN' bg={C.acBg} fg='#fff' style={{ marginRight: 0, marginBottom: 0 }} />
            ) : (
              <T c={col(t.r)} w='700'>{t.r > 0 ? '+' : ''}{t.r}R</T>
            )}
          </Row>
          {!!t.thesis && <T c={C.mut} s={12} style={{ marginTop: 3 }}>{t.thesis}</T>}
          <Row style={{ marginTop: 6, justifyContent: 'flex-start' }}>
            <TouchableOpacity onPress={() => toggleStatus(t.id)} style={{ marginRight: 14 }}>
              <T c={C.ac} s={11} w='700'>{t.status === 'OPEN' ? 'Mark Closed' : 'Re-open Position'}</T>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => save(trades.filter(x => x.id !== t.id))}>
              <T c={C.dn} s={11}>Delete</T>
            </TouchableOpacity>
          </Row>
        </Card>
      ))}
    </>
  );
}
// == END REPLACE: Journal COMPONENT ==

// ============================================================================
// 16. ROOT APP SHELL
// ============================================================================

const NAV = [
  ['Analysis', [[0, 'Executive brief', '◐'], [9, 'Swing intel', '⚡'], [8, 'Weekly top picks', '★'], [1, 'Fundamentals', '◎'], [2, 'Pair scanner', '⇄'], [3, 'Macro & cross-asset', '▤']]],
  ['Market', [[4, 'Context news', '☰'], [7, 'Economic calendar', '◷']]],
  ['Tools', [[5, 'Risk calculator', '▣'], [6, 'Trade journal', '✎']]]
];
const TABS = [['Brief', 0], ['Swing', 9], ['Picks', 8], ['Fund', 1], ['Pairs', 2], ['Macro', 3], ['News', 4], ['Cal', 7], ['Risk', 5], ['Journal', 6]];

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const scrollRef = useRef(null);

  const [tab, setTab] = useState(0);
  const [hist, setHist] = useState(null);
  const [rates, setRates] = useState(null);
  const [dash, setDash] = useState(null);
  const [fx, setFx] = useState(null);
  const [intel, setIntel] = useState(null);
  const [cal, setCal] = useState(null);
  const [cot, setCot] = useState(null);
  const [assets, setAssets] = useState(null);
  const [news, setNews] = useState([]);
  const [conn, setConn] = useState('CONNECTING…');
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [trades, setTrades] = useState([]);
  const [pre, setPre] = useState(null);
  const [nf, setNfS] = useState(NF0);
  const [scoreModalCur, setScoreModalCur] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const setNf = v => { setNfS(v); store.set('newsf', v); };
  const seenNews = useRef(null);

  const loadNews = async () => {
    try {
      const r = await fetch(API + '/api/news');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const items = (await r.json()).items || [];
      if (seenNews.current) {
        items.filter(i => i.impact === 'HIGH' && !seenNews.current.has(i.id)).slice(0, 3).forEach(i => {
          Notifications.scheduleNotificationAsync({
            content: { title: `HIGH impact · ${(i.cur || []).join('/')}`, body: `${i.title} (${i.tone}, ${i.sentimentConfidence ?? '—'}% conf)` },
            trigger: null
          }).catch(() => {});
        });
      }
      seenNews.current = new Set([...(seenNews.current || []), ...items.map(i => i.id)]);
      setNews(items);
      store.set('news', items);
      return true;
    } catch {
      const c = await store.get('news', []);
      setNews(c);
      return false;
    }
  };

  const refresh = async (force = false) => {
    setBusy(true);
    const q = force === true ? '?force=1' : '';
    const ok = await Promise.all([
      loadEndpoint('/api/history' + q, 'hist', setHist),
      loadEndpoint('/api/rates' + q, 'rates', setRates),
      loadEndpoint('/api/dashboard' + q, 'dash', setDash),
      loadEndpoint('/api/fundamentals' + q, 'fx', setFx),
      loadEndpoint('/api/intelligence' + q, 'intel', setIntel),
      loadEndpoint('/api/calendar' + q, 'cal', setCal),
      loadEndpoint('/api/cot' + q, 'cot', setCot),
      loadEndpoint('/api/assets' + q, 'assets', setAssets),
      loadNews()
    ]);
    setConn(ok.every(Boolean) ? 'LIVE' : ok.some(Boolean) ? 'PARTIAL' : 'OFFLINE · cached');
    if (force) setRefreshTick(x => x + 1);
    setBusy(false);
  };

  useEffect(() => {
    (async () => {
      setTrades(await store.get('trades', []));
      const savedNf = await store.get('newsf', null);
      if (savedNf) setNfS({ ...NF0, ...savedNf });
      if (Platform.OS !== 'web') {
        try {
          await Notifications.setNotificationChannelAsync('news', { name: 'High-impact news', importance: Notifications.AndroidImportance.HIGH });
          await Notifications.requestPermissionsAsync();
        } catch {}
      }
      refresh(false);
    })();
    const i1 = setInterval(loadNews, 30000);
    const i2 = setInterval(() => loadEndpoint('/api/calendar', 'cal', setCal), 12e4);
    const i3 = setInterval(() => {
      loadEndpoint('/api/fundamentals', 'fx', setFx);
      loadEndpoint('/api/intelligence', 'intel', setIntel);
    }, 6e5);
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  }, []);

  const A = useMemo(() => computeClientAnalytics(hist), [hist]);
  const gold = useMemo(() => getUnifiedGoldFromState(intel, rates, dash, assets, fx), [intel, rates, dash, assets, fx]);
  const sendToRisk = o => { setPre({ ...o, n: Date.now() }); setTab(5); };

  const dot = conn === 'LIVE' ? C.up : conn.startsWith('OFF') ? C.dn : C.warn;
  const statusEl = (
    <Row style={{ justifyContent: 'flex-start' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, marginRight: 6 }} />
      <T c={C.mut} s={11} w='700'>{conn}</T>
    </Row>
  );

  const body = (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: wide ? 24 : 12, maxWidth: 1140, width: '100%', alignSelf: 'center' }}
      keyboardShouldPersistTaps='handled'
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => refresh(true)} tintColor={C.ac} colors={[C.ac]} />}
    >
      {(tab === 0 || tab === 4) && <NextHigh cal={cal} />}
      {tab === 0 && <Overview A={A} fx={fx} intel={intel} gold={gold} onOpenScore={setScoreModalCur} onOpenAudit={() => setAuditOpen(true)} onNavigate={setTab} />}
      {tab === 9 && <SwingIntel intel={intel} onOpenScore={setScoreModalCur} />}
      {tab === 1 && <Fundamentals fx={fx} cot={cot} onOpenScore={setScoreModalCur} />}
      {tab === 2 && <Scanner A={A} fx={fx} cot={cot} intel={intel} gold={gold} send={sendToRisk} onOpenScore={setScoreModalCur} />}
      {tab === 3 && <Macro d={dash} assets={assets} intel={intel} gold={gold} />}
      {tab === 4 && <News news={news} trades={trades} nf={nf} setNf={setNf} />}
      {tab === 5 && <Risk pre={pre} />}
      {tab === 6 && <Journal trades={trades} setTrades={setTrades} A={A} assets={assets} />}
      {tab === 7 && <EconCalendar cal={cal} refreshTick={refreshTick} />}
      {tab === 8 && <Picks A={A} fx={fx} cal={cal} news={news} dash={dash} assets={assets} intel={intel} gold={gold} scrollRef={scrollRef} />}
    </ScrollView>
  );

  const modals = (
    <>
      <ScoreBreakdownModal currency={scoreModalCur} fx={fx} onClose={() => setScoreModalCur(null)} />
      {auditOpen && <FreshnessAuditModal intel={intel} fx={fx} dash={dash} onClose={() => setAuditOpen(false)} />}
    </>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
        <View style={{ width: 255, backgroundColor: C.bgDeep, borderRightWidth: 1, borderRightColor: C.line, padding: 14 }}>
          <T s={17} w='800' style={{ marginBottom: 16 }}>FX Fundamentals <T c={C.ac}>Pro</T></T>
          {NAV.map(([sec, items]) => (
            <View key={sec} style={{ marginBottom: 14 }}>
              <T c={C.mut} s={10} w='800' style={{ marginBottom: 6, letterSpacing: 1 }}>{sec.toUpperCase()}</T>
              {items.map(([i, l, g]) => (
                <TouchableOpacity key={i} onPress={() => setTab(i)} style={{ flexDirection: 'row', padding: 10, borderRadius: 8, backgroundColor: tab === i ? C.card : 'transparent' }}>
                  <T c={tab === i ? C.ac : C.mut} style={{ width: 24 }}>{g}</T>
                  <T c={tab === i ? C.tx : C.mut} w={tab === i ? '700' : '400'}>{l}</T>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <View style={{ flex: 1 }} />
          {statusEl}
          <T s={10} c={C.mut} style={{ marginTop: 4 }}>v2.0 Institutional Engine</T>
        </View>
        <View style={{ flex: 1 }}>
          <SessionBar />
          <FreshnessBar intel={intel} fx={fx} dash={dash} onOpenAudit={() => setAuditOpen(true)} />
          <Row style={{ borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 24, paddingVertical: 6 }}>
            <T c={C.warn} s={10}>ECB daily reference rates · Research aid, not financial advice · Unified Gold: {gold?.price != null ? `$${f2(gold.price, 2)}` : 'Unavailable'}</T>
            <Btn small t={busy ? 'Refreshing…' : 'Refresh All'} on={() => refresh(true)} />
          </Row>
          {body}
        </View>
        {modals}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 8 }}>
      <StatusBar barStyle='light-content' backgroundColor={C.bg} />
      <Row style={{ paddingHorizontal: 14, paddingBottom: 4 }}>
        <T s={18} w='800'>FX Fundamentals <T c={C.ac}>Pro</T></T>
        {statusEl}
      </Row>
      <SessionBar />
      <FreshnessBar intel={intel} fx={fx} dash={dash} onOpenAudit={() => setAuditOpen(true)} />
      {body}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line }} contentContainerStyle={{ paddingBottom: 10 }}>
        {TABS.map(([t, i]) => (
          <TouchableOpacity key={t} onPress={() => setTab(i)} style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
            <T s={11} w='800' c={tab === i ? C.ac : C.mut}>{t}</T>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {modals}
    </View>
  );
}
