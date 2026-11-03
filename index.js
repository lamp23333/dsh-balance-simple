/**
 * Host half of the DeepSeek open-platform usage widget.
 *
 * The browser never receives the Platform credential. This module reads the
 * credential already stored by DSH's `deepseekAccount` service, queries the
 * official Platform usage APIs, and exposes only the derived monthly figures
 * through a same-origin JSON route.
 *
 * It also proxies two low-frequency public services: the Chinese statutory
 * holiday calendar (DeepSeek's off-peak rule is China-only) and an
 * authoritative clock (regional NTP, with an HTTP fallback).
 */

import dgram from 'node:dgram';

const ROUTE = '/dsh-deepseek-usage/widget';
const HOLIDAY_ROUTE = '/dsh-deepseek-usage/holidays';
const TIME_ROUTE = '/dsh-deepseek-usage/time';
const CLIENT_VERSION = '0.2.1';
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 20_000;
const MAX_BODY_BYTES = 512 * 1024;

const HOLIDAY_TTL_MS = 24 * 60 * 60 * 1000;
const TIME_TTL_MS = 6 * 60 * 60 * 1000;
const EXTERNAL_TIMEOUT_MS = 8_000;
const EXTERNAL_MAX_BYTES = 1024 * 1024;
const NTP_TIMEOUT_MS = 3_000;
const NTP_UNIX_EPOCH_OFFSET = 2_208_988_800;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

const holidayCache = new Map();
const timeCache = new Map();

const CHINA_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Kashgar',
]);

const NTP_SERVERS = {
  cn: ['ntp.aliyun.com', 'ntp.tencent.com', 'cn.pool.ntp.org'],
  us: ['time.nist.gov', 'us.pool.ntp.org', 'pool.ntp.org'],
  eu: ['time.cloudflare.com', 'europe.pool.ntp.org', 'pool.ntp.org'],
  asia: ['asia.pool.ntp.org', 'time.cloudflare.com', 'pool.ntp.org'],
  global: ['pool.ntp.org', 'time.cloudflare.com'],
};

const HOLIDAY_SOURCES = [
  {
    id: 'jiejiariapi',
    url: (year) => `https://api.jiejiariapi.com/v1/holidays/${year}`,
  },
  {
    id: 'holiday-cn',
    url: (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
  },
];

export const name = 'dsh-balance-simple';
export const inject = ['webServer'];

class PlatformFailure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

async function readExternalText(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > EXTERNAL_MAX_BYTES) {
    throw new Error('external response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > EXTERNAL_MAX_BYTES) {
    throw new Error('external response is too large');
  }
  return text;
}

async function fetchExternalJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'dsh-balance-simple/1.0',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`external request returned HTTP ${response.status}`);
    const text = await readExternalText(response);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseHolidayDays(payload, year) {
  const rows = Array.isArray(payload?.days)
    ? payload.days
    : payload && typeof payload === 'object'
      ? Object.values(payload)
      : [];
  const days = new Set();
  const prefix = `${year}-`;
  for (const row of rows) {
    if (!row || row.isOffDay !== true || !isDateKey(row.date)) continue;
    if (!row.date.startsWith(prefix)) continue;
    days.add(row.date);
  }
  return [...days].sort();
}

async function loadHolidayYear(year) {
  const cached = holidayCache.get(year);
  if (cached && Date.now() - cached.fetchedAt < HOLIDAY_TTL_MS) return cached;

  let result = { days: [], source: 'unavailable', fetchedAt: Date.now() };
  for (const source of HOLIDAY_SOURCES) {
    try {
      const payload = await fetchExternalJson(source.url(year));
      const days = parseHolidayDays(payload, year);
      // An empty future-year file means the calendar is not published yet.
      if (days.length === 0) continue;
      result = { days, source: source.id, fetchedAt: Date.now() };
      break;
    } catch {
      // Try the next public calendar source.
    }
  }
  holidayCache.set(year, result);
  return result;
}

async function holidayPayload(searchParams) {
  const beijingYear = new Date(Date.now() + BEIJING_OFFSET_MS).getUTCFullYear();
  const years = [];
  const rawYears = searchParams.get('years') ?? '';
  for (const part of rawYears.split(',')) {
    const year = Number(part);
    if (Number.isInteger(year) && year >= 2020 && year <= 2100 && !years.includes(year)) {
      years.push(year);
    }
  }
  if (years.length === 0) years.push(beijingYear, beijingYear + 1);
  if (years.length > 3) years.length = 3;

  const rows = await Promise.all(
    years.map(async (year) => [year, await loadHolidayYear(year)]),
  );
  const payload = {
    ok: true,
    years: {},
    sources: {},
    fetchedAt: Date.now(),
    cityRule: 'CN',
  };
  for (const [year, row] of rows) {
    payload.years[year] = row.days;
    payload.sources[year] = row.source;
  }
  return payload;
}

function normalizeTimezone(raw) {
  const zone = typeof raw === 'string' ? raw.trim().slice(0, 80) : '';
  if (!zone || !/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/.test(zone)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

function regionForTimezone(zone) {
  if (CHINA_TIMEZONES.has(zone)) return 'cn';
  if (/^America\//.test(zone)) return 'us';
  if (/^Europe\//.test(zone)) return 'eu';
  if (/^Asia\//.test(zone)) return 'asia';
  return 'global';
}

function ntpTimestampToUnixMs(seconds, fraction) {
  return (seconds - NTP_UNIX_EPOCH_OFFSET) * 1000 + (fraction / 2 ** 32) * 1000;
}

function queryNtp(host) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b;
    const t1 = Date.now();
    const seconds = Math.floor(t1 / 1000) + NTP_UNIX_EPOCH_OFFSET;
    const fraction = Math.floor(((t1 % 1000) / 1000) * 2 ** 32);
    packet.writeUInt32BE(seconds >>> 0, 40);
    packet.writeUInt32BE(fraction >>> 0, 44);

    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      if (error) reject(error);
      else resolve(value);
    };

    timer = setTimeout(() => finish(new Error('ntp timeout')), NTP_TIMEOUT_MS);
    socket.once('error', (error) => finish(error));
    socket.once('message', (message) => {
      const t4 = Date.now();
      if (message.length < 48) {
        finish(new Error('ntp short response'));
        return;
      }
      const mode = message[0] & 0x7;
      if (mode !== 4 && mode !== 5) {
        finish(new Error('ntp invalid mode'));
        return;
      }
      const stratum = message[1];
      if (stratum < 1 || stratum > 15) {
        finish(new Error('ntp invalid stratum'));
        return;
      }
      const t2 = ntpTimestampToUnixMs(message.readUInt32BE(32), message.readUInt32BE(36));
      const t3 = ntpTimestampToUnixMs(message.readUInt32BE(40), message.readUInt32BE(44));
      if (!Number.isFinite(t2) || !Number.isFinite(t3) || t2 === 0 || t3 === 0) {
        finish(new Error('ntp invalid timestamp'));
        return;
      }
      const offset = (t2 - t1 + (t3 - t4)) / 2;
      if (!Number.isFinite(offset) || Math.abs(offset) > MAX_CLOCK_SKEW_MS) {
        finish(new Error('ntp implausible offset'));
        return;
      }
      finish(null, {
        epochMs: Math.round(t4 + offset),
        offsetMs: Math.round(offset),
        delayMs: Math.round(t4 - t1 - (t3 - t2)),
        provider: host,
        transport: 'ntp',
      });
    });

    try {
      socket.send(packet, 0, packet.length, 123, host, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function queryHttpTime(zone) {
  const payload = await fetchExternalJson(
    `https://timeapi.io/api/TimeZone/zone?timeZone=${encodeURIComponent(zone)}`,
  );
  const local = payload?.currentLocalTime;
  const offsetSeconds = Number(payload?.currentUtcOffset?.seconds);
  if (typeof local !== 'string' || !local || !Number.isFinite(offsetSeconds)) {
    throw new Error('time API returned an invalid payload');
  }
  const localWithMilliseconds = local.replace(/(\.\d{1,3})\d+$/, '$1');
  const wallMs = Date.parse(`${localWithMilliseconds}Z`);
  const epochMs = wallMs - offsetSeconds * 1000;
  if (!Number.isFinite(epochMs) || Math.abs(epochMs - Date.now()) > MAX_CLOCK_SKEW_MS) {
    throw new Error('time API returned an implausible time');
  }
  return {
    epochMs: Math.round(epochMs),
    offsetMs: 0,
    delayMs: 0,
    provider: 'timeapi.io',
    transport: 'http',
  };
}

async function loadTime(zone) {
  const cached = timeCache.get(zone);
  if (cached && Date.now() - cached.fetchedAt < TIME_TTL_MS) return cached;

  const region = regionForTimezone(zone);
  const hosts = NTP_SERVERS[region] ?? NTP_SERVERS.global;
  const attempts = await Promise.allSettled(hosts.map((host) => queryNtp(host)));
  const ntp = attempts.find((attempt) => attempt.status === 'fulfilled');
  let result = ntp ? ntp.value : null;
  if (!result) {
    try {
      result = await queryHttpTime(zone);
    } catch {
      // Fall through to stale cache, if any.
    }
  }
  if (!result) {
    if (cached) return { ...cached, stale: true };
    throw new Error('authoritative time unavailable');
  }

  const value = { ...result, zone, region, fetchedAt: Date.now() };
  timeCache.set(zone, value);
  return value;
}

async function timePayload(zone) {
  const normalized = normalizeTimezone(zone);
  return { ok: true, ...(await loadTime(normalized)) };
}

function readClientMeta(searchParams) {
  const rawLocale = searchParams.get('locale') ?? 'zh-CN';
  const locale = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(rawLocale)
    ? rawLocale.slice(0, 32)
    : 'zh-CN';
  const timezoneOffsetSeconds = clampInteger(
    searchParams.get('tz'),
    -86_400,
    86_400,
    -new Date().getTimezoneOffset() * 60,
  );
  return { version: CLIENT_VERSION, locale, timezoneOffsetSeconds };
}

function monthFor(timezoneOffsetSeconds) {
  const shifted = new Date(Date.now() + timezoneOffsetSeconds * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const today = [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return { year, month, today };
}

function platformHeaders(session, meta) {
  return {
    ...(session.requestHeaders ?? {}),
    'x-dsh-auth-token': session.token,
    'x-client-bundle-id': '',
    'x-client-platform': 'web',
    'x-client-version': CLIENT_VERSION,
    'x-client-locale': /^zh/i.test(meta.locale) ? 'zh_CN' : 'en_US',
    'x-client-timezone-offset': String(meta.timezoneOffsetSeconds),
    accept: 'application/json',
  };
}

async function readLimitedText(response) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PlatformFailure('protocol', 'response is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new PlatformFailure('protocol', 'response is too large');
  }
  return text;
}

async function fetchPlatformJson(url, session, meta) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: platformHeaders(session, meta),
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch {
    throw new PlatformFailure('unavailable', 'platform request failed');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new PlatformFailure('auth', 'platform rejected the session');
  }
  if (!response.ok) {
    throw new PlatformFailure('unavailable', `platform returned HTTP ${response.status}`);
  }

  const text = await readLimitedText(response);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new PlatformFailure('protocol', 'platform returned invalid JSON');
  }
  if (!payload || typeof payload !== 'object') {
    throw new PlatformFailure('protocol', 'platform returned an invalid envelope');
  }
  if (payload.code !== 0) {
    throw new PlatformFailure(payload.code === 40_003 ? 'auth' : 'rejected', 'platform rejected the request');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object') {
    throw new PlatformFailure('protocol', 'platform returned no data');
  }
  if (data.biz_code !== undefined && data.biz_code !== 0) {
    throw new PlatformFailure(data.biz_code === 40_003 ? 'auth' : 'rejected', 'platform rejected the request');
  }
  return data.biz_data ?? null;
}

function failureCode(error, fallback) {
  return error instanceof PlatformFailure ? error.code : fallback;
}

function usageRoot(bizData) {
  const value = Array.isArray(bizData) ? bizData[0] : bizData;
  if (!value || typeof value !== 'object') return { total: [], days: [] };
  return {
    total: Array.isArray(value.total) ? value.total : [],
    days: Array.isArray(value.days) ? value.days : [],
  };
}

function emptyUsage() {
  return { prompt: 0, cacheHit: 0, cacheMiss: 0, completion: 0, requests: 0 };
}

function addAmountRows(rows, totals) {
  if (!Array.isArray(rows)) return;
  for (const model of rows) {
    const usage = model && Array.isArray(model.usage) ? model.usage : [];
    for (const item of usage) {
      const amount = Number(item?.amount);
      if (!Number.isFinite(amount)) continue;
      switch (item?.type) {
        case 'PROMPT_TOKEN':
          totals.prompt += amount;
          break;
        case 'PROMPT_CACHE_HIT_TOKEN':
          totals.cacheHit += amount;
          break;
        case 'PROMPT_CACHE_MISS_TOKEN':
          totals.cacheMiss += amount;
          break;
        case 'RESPONSE_TOKEN':
          totals.completion += amount;
          break;
        case 'REQUEST':
          totals.requests += amount;
          break;
        default:
          break;
      }
    }
  }
}

function addCostRows(rows, totals) {
  if (!Array.isArray(rows)) return;
  for (const model of rows) {
    const usage = model && Array.isArray(model.usage) ? model.usage : [];
    for (const item of usage) {
      if (item?.type === 'REQUEST') continue;
      const amount = Number(item?.amount);
      if (Number.isFinite(amount)) totals.cost += amount;
    }
  }
}

function promptTotal(totals) {
  return Math.max(totals.prompt, totals.cacheHit + totals.cacheMiss);
}

function roundCost(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildUsage(amountRoot, costRoot, month, year, today) {
  const totals = emptyUsage();
  addAmountRows(amountRoot.total, totals);
  const prompt = promptTotal(totals);
  const totalTokens = prompt + totals.completion;

  const costTotal = costRoot === null ? null : { cost: 0 };
  if (costTotal !== null) addCostRows(costRoot.total, costTotal);

  const byDate = new Map();
  const touch = (date) => {
    let entry = byDate.get(date);
    if (entry === undefined) {
      entry = {
        date,
        tokens: 0,
        requests: 0,
        cost: costRoot === null ? null : 0,
      };
      byDate.set(date, entry);
    }
    return entry;
  };

  for (const day of amountRoot.days) {
    if (!day || typeof day.date !== 'string') continue;
    const daily = emptyUsage();
    addAmountRows(day.data, daily);
    const entry = touch(day.date);
    entry.tokens += promptTotal(daily) + daily.completion;
    entry.requests += daily.requests;
  }
  if (costRoot !== null) {
    for (const day of costRoot.days) {
      if (!day || typeof day.date !== 'string') continue;
      const daily = { cost: 0 };
      addCostRows(day.data, daily);
      touch(day.date).cost = (touch(day.date).cost ?? 0) + daily.cost;
    }
  }

  const days = [...byDate.values()]
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map((entry) => ({
      date: entry.date,
      tokens: Math.round(entry.tokens),
      requests: Math.round(entry.requests),
      cost: entry.cost === null ? null : roundCost(entry.cost),
    }));

  const cacheInput = totals.cacheHit + totals.cacheMiss;
  return {
    month,
    year,
    totals: {
      cacheHitTokens: Math.round(totals.cacheHit),
      cacheMissTokens: Math.round(totals.cacheMiss),
      promptTokens: Math.round(prompt),
      completionTokens: Math.round(totals.completion),
      totalTokens: Math.round(totalTokens),
      requests: Math.round(totals.requests),
      cost: costTotal === null ? null : roundCost(costTotal.cost),
    },
    cacheHitRate: cacheInput > 0 ? totals.cacheHit / cacheInput : null,
    days,
  };
}

function walletView(balance, bonusWallets) {
  const wallets = Array.isArray(balance) ? balance : [];
  const normal = wallets.find((wallet) => wallet?.currency === 'CNY') ?? wallets[0];
  if (!normal) return null;
  const bonus = Array.isArray(bonusWallets)
    ? bonusWallets.find((wallet) => wallet?.currency === normal.currency)
    : undefined;
  return {
    currency: String(normal.currency ?? 'CNY'),
    amount: String(normal.balance ?? '0'),
    bonus: bonus ? String(bonus.balance ?? '0') : null,
  };
}

function profileView(profile) {
  if (!profile) return null;
  const name = typeof profile.name === 'string' && profile.name.trim() !== '' ? profile.name : null;
  const contact =
    typeof profile.contact === 'string' && profile.contact.trim() !== '' ? profile.contact : null;
  if (name === null && contact === null) return null;
  return { name, contact };
}

export function apply(ctx) {
  let cached = null;
  let inFlight = null;

  async function load(meta) {
    const { year, month, today } = monthFor(meta.timezoneOffsetSeconds);
    const account = ctx.get('deepseekAccount');
    if (account === undefined) {
      return {
        ok: true,
        status: 'unavailable',
        account: null,
        balance: null,
        usage: null,
        errors: { account: 'unavailable', usage: 'unavailable' },
        fetchedAt: Date.now(),
      };
    }

    let session = null;
    try {
      session = await account.getPlatformSession();
    } catch {
      session = null;
    }
    if (!session) {
      return {
        ok: true,
        status: 'signed-out',
        account: null,
        balance: null,
        usage: null,
        errors: {},
        fetchedAt: Date.now(),
      };
    }

    const cacheKey = [
      session.origin,
      session.userId ?? '',
      year,
      month,
      meta.timezoneOffsetSeconds,
    ].join('|');
    if (cached !== null && cached.key === cacheKey && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
    if (inFlight !== null && inFlight.key === cacheKey) return inFlight.promise;

    const promise = (async () => {
      const [profileResult, balanceResult, amountResult, costResult] = await Promise.allSettled([
        account.getProfile(meta),
        account.getBalance(meta),
        fetchPlatformJson(
          (() => {
            const url = new URL('/api/v0/usage/amount', session.origin);
            url.searchParams.set('month', String(month));
            url.searchParams.set('year', String(year));
            return url;
          })(),
          session,
          meta,
        ),
        fetchPlatformJson(
          (() => {
            const url = new URL('/api/v0/usage/cost', session.origin);
            url.searchParams.set('month', String(month));
            url.searchParams.set('year', String(year));
            return url;
          })(),
          session,
          meta,
        ),
      ]);

      const profile =
        profileResult.status === 'fulfilled' && profileResult.value?.status === 'ready'
          ? profileResult.value.value
          : null;
      const balance =
        balanceResult.status === 'fulfilled' && balanceResult.value?.status === 'ready'
          ? balanceResult.value.value
          : null;
      const bonusWallets =
        balanceResult.status === 'fulfilled' && balanceResult.value?.status === 'ready'
          ? balanceResult.value.bonusWallets
          : null;

      const errors = {};
      const amountRoot =
        amountResult.status === 'fulfilled' ? usageRoot(amountResult.value) : null;
      const costRoot = costResult.status === 'fulfilled' ? usageRoot(costResult.value) : null;

      if (amountRoot === null) {
        errors.usage = failureCode(amountResult.reason, 'unavailable');
      }
      if (costRoot === null) {
        errors.cost = failureCode(costResult.reason, 'unavailable');
      }
      if (
        profileResult.status === 'rejected' &&
        balanceResult.status === 'rejected'
      ) {
        errors.account = 'unavailable';
      }

      const usage = amountRoot === null ? null : buildUsage(amountRoot, costRoot, month, year, today);
      const accountView = profileView(profile);
      const balanceData = walletView(balance, bonusWallets);

      return {
        ok: true,
        status: usage === null ? 'partial' : 'ready',
        account: accountView,
        balance: balanceData,
        usage,
        errors,
        fetchedAt: Date.now(),
      };
    })();

    inFlight = { key: cacheKey, promise };
    try {
      const value = await promise;
      cached = { key: cacheKey, at: Date.now(), value };
      return value;
    } finally {
      if (inFlight !== null && inFlight.promise === promise) inFlight = null;
    }
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '') {
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    }
    return req.headers['sec-fetch-site'] !== 'cross-site';
  }

  function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'content-length': Buffer.byteLength(body, 'utf8'),
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
            return;
          }
          const url = new URL(req.url ?? ROUTE, 'http://localhost');
          const meta = readClientMeta(url.searchParams);
          try {
            sendJson(res, 200, await load(meta));
          } catch {
            sendJson(res, 500, { ok: false, error: 'unavailable' });
          }
        },
      }),
    'dsh-balance-simple: same-origin usage endpoint',
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: HOLIDAY_ROUTE,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
            return;
          }
          const url = new URL(req.url ?? HOLIDAY_ROUTE, 'http://localhost');
          try {
            sendJson(res, 200, await holidayPayload(url.searchParams));
          } catch {
            sendJson(res, 200, {
              ok: false,
              error: 'holiday-unavailable',
              years: {},
              sources: {},
              fetchedAt: Date.now(),
            });
          }
        },
      }),
    'dsh-balance-simple: China statutory holiday endpoint',
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: TIME_ROUTE,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' });
            return;
          }
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }));
            return;
          }
          const url = new URL(req.url ?? TIME_ROUTE, 'http://localhost');
          try {
            sendJson(res, 200, await timePayload(url.searchParams.get('tz')));
          } catch {
            sendJson(res, 200, {
              ok: false,
              error: 'time-unavailable',
              zone: normalizeTimezone(url.searchParams.get('tz')),
              fetchedAt: Date.now(),
            });
          }
        },
      }),
    'dsh-balance-simple: authoritative time endpoint',
  );
}
