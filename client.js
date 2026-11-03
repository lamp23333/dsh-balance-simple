window.__ModuleLoader__.load({
  id: 'dsh-balance-simple',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-balance-simple';
    const ENDPOINT = '/dsh-deepseek-usage/widget';
    const HOLIDAY_ENDPOINT = '/dsh-deepseek-usage/holidays';
    const TIME_ENDPOINT = '/dsh-deepseek-usage/time';
    const REFRESH_MS = 30_000;
    const HOLIDAY_REFRESH_MS = 24 * 60 * 60 * 1000;
    const TIME_REFRESH_MS = 6 * 60 * 60 * 1000;
    const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

    /*
     * DeepSeek's current API pricing (Beijing time, UTC+8):
     * peak = Monday-Friday, 09:00-12:00 and 14:00-18:00, excluding Chinese
     * statutory holidays; every other time, including weekends and holidays,
     * is off-peak. Weekends stay off-peak even on a makeup workday because
     * the published rule is Monday-Friday. The 2026 dates below are the
     * official State Council schedule:
     * https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
     * 2027-01-01 is included because New Year's Day is a fixed statutory
     * holiday; add the rest of the 2027 calendar when it is published.
     */
    const CN_OFF_DAYS = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07',
      '2027-01-01',
    ]);

    const en = {
      metaTitle: 'DeepSeek Platform Balance',
      metaDescription:
        'Shows live open-platform balance and usage for the DeepSeek account behind the current API, above the sidebar account avatar.',
      title: 'Platform balance',
      live: 'Refreshes every 30 seconds',
      tokensThisMonth: 'tokens this month',
      costThisMonth: 'cost this month',
      requests: 'requests',
      cacheHit: 'cache hit',
      cacheMiss: 'cache miss',
      output: 'output',
      cacheRate: 'cache rate',
      hitShort: 'hit',
      missShort: 'miss',
      outShort: 'out',
      balance: 'balance',
      peak: 'Peak',
      valley: 'Off-peak',
      toValley: 'to off-peak',
      toPeak: 'to peak',
      loading: 'Loading balance',
      retry: 'Retry',
      signedOut: 'No open-platform account connected',
      signedOutHint: 'Sign in to DeepSeek in Settings → Account to see balance and usage here.',
      usageUnavailable: 'Usage data is temporarily unavailable',
      authExpired: 'The platform session has expired. Sign in again in Settings → Account.',
      accountUnavailable: 'The account service is unavailable',
      unknownAccount: 'DeepSeek account',
      notConnected: 'Not connected',
      stale: 'Refresh failed, showing the last reading',
      updated: 'Updated',
      refresh: 'Refresh balance',
    };

    const zh = {
      metaTitle: 'DeepSeek 开放平台余额',
      metaDescription: '在当前 API 对应的 DeepSeek 账号头像上方，实时显示开放平台余额、用量与峰谷计价倒计时。',
      title: '开放平台余额',
      live: '每 30 秒自动刷新',
      tokensThisMonth: '本月 Token',
      costThisMonth: '本月消费',
      requests: '次请求',
      cacheHit: '缓存命中',
      cacheMiss: '缓存未命中',
      output: '输出',
      cacheRate: '缓存命中率',
      hitShort: '命中',
      missShort: '未命中',
      outShort: '输出',
      balance: '余额',
      peak: '峰时',
      valley: '谷时',
      toValley: '距谷时',
      toPeak: '距峰时',
      loading: '正在获取余额',
      retry: '重试',
      signedOut: '未连接开放平台账号',
      signedOutHint: '请先在 设置 → 账号 中登录 DeepSeek，即可在此查看余额和用量。',
      usageUnavailable: '用量数据暂时不可用',
      authExpired: '开放平台登录已失效，请在 设置 → 账号 中重新登录。',
      accountUnavailable: '账号服务当前不可用',
      unknownAccount: 'DeepSeek 账号',
      notConnected: '未连接',
      stale: '刷新失败，正在显示上次数据',
      updated: '更新于',
      refresh: '刷新余额',
    };

    const CSS = `
/*
 * The footer action slot is a list, and its host row is a horizontal flex
 * container. The shipped Cordis action claims the full row width, so a card
 * placed beside it would be squeezed to zero. Turn the slot outlet into a
 * column only while this card is mounted: the shipped action keeps its row,
 * and the usage card sits directly above the account avatar. The outlet is
 * normally display:contents, hence the important display override.
 */
[data-slot="sidebar.footer.action"]:has(.dsu-card) {
  display: flex !important;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}
[data-slot="sidebar.footer.action"]:has(.dsu-compact) {
  width: auto;
  align-items: center;
}
.dsu-card {
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  width: auto;
  align-self: stretch;
  min-width: 0;
  flex: none;
  margin: 2px 2px 6px;
  padding: 8px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1);
  background: var(--dsw-menu-surface-fill, color-mix(in srgb, var(--dsw-alias-bg-layer-1) 64%, transparent));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%));
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
}
/*
 * The sidebar itself is an opaque surface, so a backdrop filter alone is
 * invisible there. Add a soft, theme-tinted highlight behind the content:
 * the blur is then visible as a frosted wash even when the material sits on
 * a flat sidebar fill. The native backdrop-filter above still does the real
 * work wherever the surface is translucent.
 */
.dsu-card::before {
  content: "";
  position: absolute;
  inset: -35% -25%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(60% 70% at 20% 0%, color-mix(in srgb, #fff 62%, transparent), transparent 72%),
    radial-gradient(70% 70% at 100% 100%, color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent), transparent 72%);
  filter: blur(24px);
  opacity: .55;
}
.dsu-card > * {
  position: relative;
  z-index: 1;
}
.dsu-compact::before {
  display: none;
}
.dsu-live {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
}
.dsu-live.is-busy {
  animation: dsu-pulse 1s ease-in-out infinite;
}
.dsu-live.is-warn {
  background: var(--dsw-alias-state-warn-primary);
}
.dsu-live.is-off {
  background: var(--dsw-alias-label-tertiary);
}
.dsu-refresh {
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font: inherit;
}
.dsu-refresh:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsu-refresh:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dsu-refresh:disabled {
  cursor: default;
  opacity: 0.55;
}
.dsu-refresh-icon {
  display: inline-block;
  font-size: 14px;
  line-height: 1;
}
.dsu-refresh.is-busy .dsu-refresh-icon {
  animation: dsu-spin 0.9s linear infinite;
}
.dsu-hero {
  min-width: 0;
}
.dsu-hero-top {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 20px;
  min-width: 0;
}
.dsu-hero-spacer {
  flex: 1 1 auto;
  min-width: 0;
}
.dsu-hero-label {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dsu-balance-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}
.dsu-balance {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsu-pricing {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-bottom: 2px;
  text-align: right;
}
.dsu-price-state {
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.02em;
}
.dsu-price-state.is-peak {
  color: var(--dsw-alias-state-warn-primary);
}
.dsu-price-state.is-valley {
  color: var(--dsw-alias-state-success-primary);
}
.dsu-price-countdown {
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsu-usage-head {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsu-usage-label {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  white-space: nowrap;
}
.dsu-usage-tokens {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsu-usage-cost {
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsu-bar {
  display: flex;
  height: 4px;
  margin-top: 5px;
  border-radius: 99px;
  overflow: hidden;
  background: var(--dsw-alias-border-l2);
}
.dsu-seg {
  height: 100%;
  min-width: 2px;
}
.dsu-seg-hit {
  background: var(--dsw-alias-brand-primary);
}
.dsu-seg-miss {
  background: var(--dsw-alias-state-warn-primary);
}
.dsu-seg-out {
  background: var(--dsw-alias-state-success-primary);
}
.dsu-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 7px;
  min-width: 0;
  margin-top: 5px;
}
.dsu-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.dsu-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 2px;
}
.dsu-legend-value {
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsu-legend-label {
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  white-space: nowrap;
}
.dsu-foot {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dsu-foot span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsu-note {
  margin-top: 4px;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsu-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 7px 1px 2px;
}
.dsu-empty-title {
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-weight: 500;
}
.dsu-empty-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  line-height: 1.4;
}
.dsu-empty button {
  margin-top: 3px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 9.5px;
}
.dsu-empty button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsu-compact {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: auto;
  min-height: 58px;
  align-self: center;
  margin: 4px auto 0;
  padding: 4px 2px 3px;
  gap: 1px;
  border: 0;
  border-radius: 14px;
  --dsu-bg: color-mix(in srgb, var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1)) 94%, #000);
  --dsu-brightness: 0.95;
  background: var(--dsu-bg);
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  text-align: center;
  cursor: default;
  font: inherit;
  color: var(--dsw-alias-label-primary);
}
@supports ((backdrop-filter: brightness(0.9)) or (-webkit-backdrop-filter: brightness(0.9))) {
  .dsu-compact {
    background: transparent;
    -webkit-backdrop-filter: brightness(var(--dsu-brightness));
    backdrop-filter: brightness(var(--dsu-brightness));
  }
}
/*
 * The collapsed tile is display-only; refresh lives in the expanded card.
 * Dark mode uses a white overlay instead of brightness(), because brightness
 * is multiplicative and almost invisible on a near-black sidebar.
 * Scoped to .dsu-compact so the expanded card's glass material is untouched.
 */
body[data-ds-dark-theme] .dsu-card.dsu-compact {
  background: rgba(255, 255, 255, 0.08);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
/* The expanded card's ::before is a light-theme highlight. In dark mode keep
 * only the blurred material, without the white glow. */
body[data-ds-dark-theme] .dsu-card:not(.dsu-compact)::before {
  display: none;
}
/* Guard the expanded card against compact-only variables leaking in. */
.dsu-card:not(.dsu-compact) {
  --dsu-bg: initial;
  --dsu-brightness: initial;
}
.dsu-compact-label {
  display: block;
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  line-height: 1.05;
  letter-spacing: 0.02em;
}
.dsu-compact-value {
  display: block;
  max-width: 100%;
  margin-top: 1px;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsu-compact-state {
  display: block;
  max-width: 100%;
  margin-top: 2px;
  overflow: hidden;
  font-size: 8px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  text-align: center;
  text-overflow: clip;
  white-space: nowrap;
}
.dsu-compact-state.is-peak {
  color: var(--dsw-alias-state-warn-primary);
}
.dsu-compact-state.is-valley {
  color: var(--dsw-alias-state-success-primary);
}
.dsu-compact-countdown {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 7.5px;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  text-align: center;
  text-overflow: clip;
  white-space: nowrap;
}
.dsu-compact.is-error .dsu-compact-value {
  color: var(--dsw-alias-state-error-primary);
}
.dsu-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.dsu-sk {
  display: block;
  height: 8px;
  border-radius: 4px;
  background: var(--dsw-alias-border-l2);
  animation: dsu-pulse 1.2s ease-in-out infinite;
}
.dsu-sk-value {
  width: 82%;
  height: 16px;
}
.dsu-sk-bar {
  width: 100%;
  height: 5px;
}
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .dsu-card:not(.dsu-compact) {
    background: var(--dsw-alias-bg-layer-1);
  }
}
@keyframes dsu-spin {
  to { transform: rotate(360deg); }
}
@keyframes dsu-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .dsu-refresh.is-busy .dsu-refresh-icon,
  .dsu-live.is-busy,
  .dsu-sk {
    animation: none;
  }
}
`;

    function numberLocale(getLocale) {
      try {
        return getLocale() || navigator.language || 'en';
      } catch {
        return 'en';
      }
    }

    function compactNumber(value, getLocale) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      try {
        return new Intl.NumberFormat(numberLocale(getLocale), {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(number);
      } catch {
        return String(Math.round(number));
      }
    }

    function integerNumber(value, getLocale) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      try {
        return new Intl.NumberFormat(numberLocale(getLocale), {
          maximumFractionDigits: 0,
        }).format(number);
      } catch {
        return String(Math.round(number));
      }
    }

    function moneyNumber(value, currency, getLocale) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      try {
        return new Intl.NumberFormat(numberLocale(getLocale), {
          style: 'currency',
          currency: currency || 'CNY',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(number);
      } catch {
        return `${number.toFixed(2)} ${currency || 'CNY'}`;
      }
    }

    function compactMoney(value, currency, getLocale) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      const digits = Math.abs(number) < 100 ? 1 : 0;
      try {
        return new Intl.NumberFormat(numberLocale(getLocale), {
          style: 'currency',
          currency: currency || 'CNY',
          notation: 'compact',
          maximumFractionDigits: digits,
          currencyDisplay: 'narrowSymbol',
        }).format(number);
      } catch {
        return moneyNumber(value, currency, getLocale);
      }
    }

    function timeText(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString();
      } catch {
        return '';
      }
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function beijingParts(timestamp) {
      const date = new Date(timestamp + BEIJING_OFFSET_MS);
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
      };
    }

    function dateKey(parts) {
      return `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}`;
    }

    function isHoliday(parts, holidayYears) {
      const remote = holidayYears?.[parts.year];
      if (remote && typeof remote.has === 'function' && remote.size > 0) {
        return remote.has(dateKey(parts));
      }
      // Before the remote calendar arrives, or when that year has not been
      // published yet, keep the bundled fallback.
      return CN_OFF_DAYS.has(dateKey(parts));
    }

    function isPeakDay(parts, holidayYears = null) {
      if (isHoliday(parts, holidayYears)) return false;
      return parts.weekday >= 1 && parts.weekday <= 5;
    }

    function beijingBoundary(parts, minutes) {
      return (
        Date.UTC(
          parts.year,
          parts.month,
          parts.day,
          Math.floor(minutes / 60),
          minutes % 60,
          0,
          0,
        ) - BEIJING_OFFSET_MS
      );
    }

    function shiftDate(parts, days) {
      const date = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
      };
    }

    /*
     * Returns the current pricing state and the next boundary. All schedule
     * comparisons use Beijing time, independent of the device time zone.
     */
    function pricingState(timestamp, holidayYears = null) {
      const parts = beijingParts(timestamp);
      const peakDay = isPeakDay(parts, holidayYears);
      const minutes = parts.minutes;
      const peak =
        peakDay &&
        ((minutes >= 9 * 60 && minutes < 12 * 60) ||
          (minutes >= 14 * 60 && minutes < 18 * 60));

      let target;
      if (peak) {
        target = beijingBoundary(parts, minutes < 12 * 60 ? 12 * 60 : 18 * 60);
      } else if (peakDay && minutes < 9 * 60) {
        target = beijingBoundary(parts, 9 * 60);
      } else if (peakDay && minutes >= 12 * 60 && minutes < 14 * 60) {
        target = beijingBoundary(parts, 14 * 60);
      } else {
        for (let offset = 1; offset <= 370; offset += 1) {
          const next = shiftDate(parts, offset);
          if (isPeakDay(next, holidayYears)) {
            target = beijingBoundary(next, 9 * 60);
            break;
          }
        }
      }

      return {
        peak,
        labelKey: peak ? 'peak' : 'valley',
        countdownKey: peak ? 'toValley' : 'toPeak',
        target: target ?? timestamp,
      };
    }

    function formatCountdown(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    function UsageCard(props) {
      const { wide = true, t, getLocale } = props;
      const expanded = wide !== false;
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(false);
      const [now, setNow] = React.useState(() => Date.now());
      const [holidayYears, setHolidayYears] = React.useState(null);
      const [clockOffset, setClockOffset] = React.useState(0);
      const requestId = React.useRef(0);
      const controller = React.useRef(null);
      const holidayController = React.useRef(null);
      const timeController = React.useRef(null);
      const holidayLoadedAt = React.useRef(0);
      const timeLoadedAt = React.useRef(0);

      const load = React.useCallback(async () => {
        const id = ++requestId.current;
        controller.current?.abort();
        const current = new AbortController();
        controller.current = current;
        setLoading(true);
        try {
          const params = new URLSearchParams({
            locale: navigator.language || 'zh-CN',
            tz: String(-new Date().getTimezoneOffset() * 60),
          });
          const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: current.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          if (!payload || payload.ok !== true) throw new Error('invalid payload');
          if (id !== requestId.current) return;
          setData(payload);
          setError(false);
          setLoading(false);
        } catch {
          if (current.signal.aborted || id !== requestId.current) return;
          setError(true);
          setLoading(false);
        }
      }, []);

      const loadHolidays = React.useCallback(async () => {
        holidayController.current?.abort();
        const current = new AbortController();
        holidayController.current = current;
        holidayLoadedAt.current = Date.now();
        const year = beijingParts(Date.now() + clockOffset).year;
        try {
          const params = new URLSearchParams({ years: `${year},${year + 1}` });
          const response = await fetch(`${HOLIDAY_ENDPOINT}?${params.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: current.signal,
          });
          if (!response.ok) return;
          const payload = await response.json();
          if (current.signal.aborted || !payload || payload.ok !== true) return;
          if (!payload.years || typeof payload.years !== 'object') return;

          const remote = {};
          for (const [key, days] of Object.entries(payload.years)) {
            if (!/^\d{4}$/.test(key) || !Array.isArray(days) || days.length === 0) continue;
            const valid = days.filter(
              (day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day),
            );
            if (valid.length > 0) remote[key] = new Set(valid);
          }
          if (Object.keys(remote).length > 0) setHolidayYears(remote);
        } catch {
          // The bundled fallback remains active.
        }
      }, [clockOffset]);

      const loadTime = React.useCallback(async () => {
        timeController.current?.abort();
        const current = new AbortController();
        timeController.current = current;
        timeLoadedAt.current = Date.now();
        try {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          const response = await fetch(`${TIME_ENDPOINT}?tz=${encodeURIComponent(zone)}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            signal: current.signal,
          });
          if (!response.ok) return;
          const payload = await response.json();
          if (current.signal.aborted || !payload || payload.ok !== true) return;
          const epochMs = Number(payload.epochMs);
          if (!Number.isFinite(epochMs)) return;
          /*
           * epochMs is the authoritative clock reading captured when the Host
           * resolved NTP. The Host caches that payload for six hours, so using
           * Date.now() here would treat a cached reading as current and shift
           * the countdown backwards by the age of the cache. Anchor the offset
           * to the payload's fetch time instead.
           */
          const fetchedAt = Number(payload.fetchedAt);
          const anchor = Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : Date.now();
          const offset = epochMs - anchor;
          if (!Number.isFinite(offset) || Math.abs(offset) > 7 * 24 * 60 * 60 * 1000) return;
          setClockOffset(offset);
        } catch {
          // Device time remains the fallback.
        }
      }, []);

      React.useEffect(() => {
        loadHolidays();
        const timer = window.setInterval(loadHolidays, HOLIDAY_REFRESH_MS);
        const onVisibility = () => {
          if (
            document.visibilityState === 'visible' &&
            Date.now() - holidayLoadedAt.current > 12 * 60 * 60 * 1000
          ) {
            loadHolidays();
          }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          holidayController.current?.abort();
        };
      }, [loadHolidays]);

      React.useEffect(() => {
        loadTime();
        const timer = window.setInterval(loadTime, TIME_REFRESH_MS);
        const refreshIfStale = () => {
          if (Date.now() - timeLoadedAt.current > 60 * 60 * 1000) loadTime();
        };
        const onVisibility = () => {
          if (document.visibilityState === 'visible') refreshIfStale();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', refreshIfStale);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', refreshIfStale);
          timeController.current?.abort();
        };
      }, [loadTime]);

      React.useEffect(() => {
        load();
        const timer = window.setInterval(() => {
          if (document.visibilityState !== 'hidden') load();
        }, REFRESH_MS);
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load();
        };
        const onFocus = () => load();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onFocus);
          requestId.current += 1;
          controller.current?.abort();
        };
      }, [load]);

      React.useEffect(() => {
        const tick = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(tick);
      }, []);

      const usage = data?.usage ?? null;
      const totals = usage?.totals ?? null;
      const balance = data?.balance ?? null;
      const rate = usage?.cacheHitRate ?? null;
      const rateText = rate === null ? '—' : `${Math.round(rate * 100)}%`;
      const signedOut = data?.status === 'signed-out';
      const unavailable = data?.status === 'unavailable';
      const usageError = data?.errors?.usage ?? null;
      const hasWarning = error || usageError !== null || data?.errors?.cost !== undefined;
      const updated = data?.fetchedAt ? `${t('updated')} ${timeText(data.fetchedAt)}` : undefined;
      const titleText = updated ?? t('balance');
      const balanceText = balance
        ? moneyNumber(balance.amount, balance.currency, getLocale)
        : '—';
      const compactValue = balance
        ? compactMoney(balance.amount, balance.currency, getLocale)
        : data === null && loading
          ? '…'
          : error
            ? '!'
            : '—';
      const adjustedNow = now + clockOffset;
      const pricing = pricingState(adjustedNow, holidayYears);
      const countdownText = formatCountdown(pricing.target - adjustedNow);
      const pricingLabel = t(pricing.labelKey);
      const countdownLabel = t(pricing.countdownKey);
      const pricingText = `${pricingLabel} · ${countdownLabel} ${countdownText}`;
      const compactTitle = `${t('balance')} ${balanceText}${updated ? ` · ${updated}` : ''} · ${pricingText}`;
      const compactError = error && !balance;
      const liveClass = loading
        ? 'dsu-live is-busy'
        : signedOut || unavailable
          ? 'dsu-live is-off'
          : hasWarning
            ? 'dsu-live is-warn'
            : 'dsu-live';

      // The 56px rail cannot fit the full card, so it gets a display-only
      // balance tile. Refreshing stays in the expanded card; the tile still
      // updates through the normal polling and focus/visibility refresh.
      if (!expanded) {
        return h(
          'div',
          {
            className: `dsu-card dsu-compact${compactError ? ' is-error' : ''}`,
            title: compactTitle,
            'aria-label': compactTitle,
            'aria-busy': loading,
          },
          h('style', null, CSS),
          h('span', { className: 'dsu-compact-label' }, t('balance')),
          h('b', { className: 'dsu-compact-value' }, compactValue),
          h(
            'span',
            { className: `dsu-compact-state ${pricing.peak ? 'is-peak' : 'is-valley'}` },
            pricingLabel,
          ),
          h('span', { className: 'dsu-compact-countdown' }, countdownText),
        );
      }

      let body;
      if (data === null && loading) {
        body = h(
          'div',
          { className: 'dsu-skeleton', 'aria-label': t('loading'), role: 'status' },
          h('span', { className: 'dsu-sk dsu-sk-value' }),
          h('span', { className: 'dsu-sk dsu-sk-bar' }),
        );
      } else if (signedOut) {
        body = h(
          'div',
          { className: 'dsu-empty' },
          h('span', { className: 'dsu-empty-title' }, t('signedOut')),
          h('span', { className: 'dsu-empty-hint' }, t('signedOutHint')),
        );
      } else if (data === null || unavailable || usage === null) {
        const message = unavailable
          ? t('accountUnavailable')
          : usageError === 'auth'
            ? t('authExpired')
            : t('usageUnavailable');
        body = h(
          'div',
          { className: 'dsu-empty' },
          h('span', { className: 'dsu-empty-title' }, message),
          h(
            'button',
            { type: 'button', onClick: () => load(), disabled: loading },
            t('retry'),
          ),
        );
      } else {
        const segments = [
          { key: 'hit', value: totals.cacheHitTokens },
          { key: 'miss', value: totals.cacheMissTokens },
          { key: 'out', value: totals.completionTokens },
        ].filter((segment) => segment.value > 0);
        const barLabel = `${t('cacheHit')} ${compactNumber(totals.cacheHitTokens, getLocale)}, ${t(
          'cacheMiss',
        )} ${compactNumber(totals.cacheMissTokens, getLocale)}, ${t('output')} ${compactNumber(
          totals.completionTokens,
          getLocale,
        )}`;
        body = h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dsu-hero' },
            h(
              'div',
              { className: 'dsu-hero-top' },
              h('span', { className: 'dsu-hero-label' }, t('balance')),
              h('span', { className: 'dsu-hero-spacer' }),
              h('span', {
                className: liveClass,
                role: 'img',
                'aria-label': t('live'),
                title: t('live'),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: `dsu-refresh${loading ? ' is-busy' : ''}`,
                  onClick: () => load(),
                  disabled: loading,
                  'aria-label': t('refresh'),
                  title: t('refresh'),
                },
                h('span', { className: 'dsu-refresh-icon', 'aria-hidden': true }, '↻'),
              ),
            ),
            h(
              'div',
              { className: 'dsu-balance-row' },
              h('b', { className: 'dsu-balance', title: balanceText }, balanceText),
              h(
                'div',
                { className: 'dsu-pricing', title: pricingText },
                h(
                  'span',
                  { className: `dsu-price-state ${pricing.peak ? 'is-peak' : 'is-valley'}` },
                  pricingLabel,
                ),
                h(
                  'span',
                  { className: 'dsu-price-countdown' },
                  `${countdownLabel} ${countdownText}`,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsu-usage-head' },
            h('span', { className: 'dsu-usage-label' }, t('tokensThisMonth')),
            h('b', { className: 'dsu-usage-tokens' }, compactNumber(totals.totalTokens, getLocale)),
            h(
              'span',
              { className: 'dsu-usage-cost' },
              totals.cost === null
                ? '—'
                : moneyNumber(totals.cost, balance?.currency ?? 'CNY', getLocale),
            ),
          ),
          h(
            'div',
            { className: 'dsu-bar', role: 'img', 'aria-label': barLabel },
            segments.length === 0
              ? null
              : segments.map((segment) =>
                  h('span', {
                    key: segment.key,
                    className: `dsu-seg dsu-seg-${segment.key}`,
                    style: { width: `${(segment.value / totals.totalTokens) * 100}%` },
                  }),
                ),
          ),
          h(
            'div',
            { className: 'dsu-legend' },
            h(
              'span',
              { className: 'dsu-legend-item', title: t('cacheHit') },
              h('span', { className: 'dsu-dot', style: { background: 'var(--dsw-alias-brand-primary)' } }),
              h('span', { className: 'dsu-legend-value' }, compactNumber(totals.cacheHitTokens, getLocale)),
              h('span', { className: 'dsu-legend-label' }, t('hitShort')),
            ),
            h(
              'span',
              { className: 'dsu-legend-item', title: t('cacheMiss') },
              h('span', {
                className: 'dsu-dot',
                style: { background: 'var(--dsw-alias-state-warn-primary)' },
              }),
              h('span', { className: 'dsu-legend-value' }, compactNumber(totals.cacheMissTokens, getLocale)),
              h('span', { className: 'dsu-legend-label' }, t('missShort')),
            ),
            h(
              'span',
              { className: 'dsu-legend-item', title: t('output') },
              h('span', {
                className: 'dsu-dot',
                style: { background: 'var(--dsw-alias-state-success-primary)' },
              }),
              h('span', { className: 'dsu-legend-value' }, compactNumber(totals.completionTokens, getLocale)),
              h('span', { className: 'dsu-legend-label' }, t('outShort')),
            ),
          ),
          h(
            'div',
            { className: 'dsu-foot' },
            h(
              'span',
              null,
              `${integerNumber(totals.requests, getLocale)} ${t('requests')}`,
            ),
            h('span', null, `${t('cacheRate')} ${rateText}`),
          ),
          hasWarning ? h('div', { className: 'dsu-note' }, t('stale')) : null,
        );
      }

      return h(
        'section',
        {
          className: 'dsu-card',
          'aria-label': t('balance'),
          'aria-busy': loading,
          title: titleText,
        },
        h('style', null, CSS),
        body,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { en, zh }),
          'dsh-balance-simple: dictionaries',
        );
        const t = ctx.locale.bind(NS);
        const getLocale = () => ctx.locale.getSnapshot().active;
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'dsh-balance-simple',
              order: 10,
              locale: NS,
              inject: () => ({ getLocale }),
            },
            UsageCard,
          ),
        );
      },
    };
  },
});
