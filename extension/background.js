/* Coupon Wallet extension — background service worker.
   Reuses the session of the signed-in web app (see options.js connect flow):
   stores Supabase URL/key/JWT, refreshes tokens, syncs coupons, and paints
   a per-tab badge when the active retailer matches unused coupons. */

const APP_ORIGINS = ['https://coupoun.netlify.app', 'http://localhost:8000'];
const REFRESH_ALARM = 'cw-refresh';
const SESSION_KEY = 'cw_session';

// Brand-name fallbacks for coupons without a redeem_url. Keys are lowercase brand values.
const BRAND_DOMAINS = {
  amazon: 'amazon.in',
  flipkart: 'flipkart.com',
  myntra: 'myntra.com',
  makemytrip: 'makemytrip.com',
  zomato: 'zomato.com',
  swiggy: 'swiggy.com'
};

/* ---------------- session ---------------- */

async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

async function saveSession(session) {
  if (!session) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

function tokenIsFresh(session) {
  if (!session || !session.expires_at) return false;
  // refresh a minute early to avoid mid-request expiry
  return Date.now() < (session.expires_at - 60) * 1000;
}

async function refreshSession(session) {
  try {
    const res = await fetch(`${session.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: session.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const data = await res.json();
    if (!data.access_token || !data.expires_at) throw new Error('no token in refresh response');

    const next = {
      ...session,
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_at: data.expires_at,
      user_email: data.user?.email || session.user_email
    };
    await saveSession(next);
    return next;
  } catch (err) {
    console.warn('[coupon-wallet] session refresh failed:', err.message);
    await saveSession(null);
    await clearAllBadges();
    return null;
  }
}

// Returns a usable session or null; transparently refreshes first if needed.
async function requireSession() {
  let session = await getSession();
  if (!session) return null;
  if (!tokenIsFresh(session)) session = await refreshSession(session);
  return session && tokenIsFresh(session) ? session : null;
}

/* ---------------- coupon sync & matching ---------------- */

let couponCache = [];

async function fetchCoupons() {
  const session = await requireSession();
  if (!session) { couponCache = []; return []; }

  const url = `${session.url}/rest/v1/coupons?select=*`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: session.key,
        Authorization: `Bearer ${session.access_token}`
      }
    });
    if (res.status === 401) {           // dead token → one retry after refresh
      const next = await refreshSession(await getSession());
      if (!next) return [];
      return fetchCoupons();
    }
    if (!res.ok) throw new Error(`coupons fetch failed: ${res.status}`);
    // Archived coupons are hidden from every surface, badges included.
    const rows = await res.json();
    couponCache = (rows || []).filter(c => !c.archived);
    chrome.storage.session?.set({ coupon_count: String(couponCache.length) });
    return couponCache;
  } catch (err) {
    console.warn('[coupon-wallet] coupon sync failed:', err.message);
    return couponCache;                 // stale cache beats nothing
  }
}

function daysUntil(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  if (!p[0]) return -9999;
  const exp = Date.UTC(p[0], p[1] - 1, p[2]);
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((exp - today) / 86400000);
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); }
  catch (_e) { return ''; }
}

function domainsMatch(a, b) {
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

// A coupon is surfaceable while shopping only if it's still spendable:
// not used (unless reusable) and not expired.
function isSpendable(c) {
  if (!c || !c.expiry_date) return false;
  if (c.used && !c.reusable) return false;
  return daysUntil(c.expiry_date) >= 0;
}

function couponMatchesHost(c, host) {
  const redeem = hostOf(c.redeem_url);
  if (redeem && domainsMatch(redeem, host)) return true;
  const hint = BRAND_DOMAINS[String(c.brand || '').toLowerCase()];
  return !!(hint && domainsMatch(hint, host));
}

function matchesForHost(host) {
  if (!host) return [];
  return couponCache
    .filter(c => isSpendable(c) && couponMatchesHost(c, host))
    .sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date));
}

/* ---------------- badges ---------------- */

async function updateBadge(tabId, url) {
  const host = hostOf(url);
  const matches = matchesForHost(host);
  try {
    if (matches.length) {
      await chrome.action.setBadgeText({ tabId, text: String(matches.length) });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#B4791F' });
      await chrome.action.setTitle({
        tabId,
        title: `🎟 ${matches.length} coupon${matches.length === 1 ? '' : 's'} for ${host}`
      });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (_e) { /* tab closed mid-update */ }
}

async function clearAllBadges() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    try { await chrome.action.setBadgeText({ tabId: t.id, text: '' }); } catch (_e) {}
  }
}

/* ---------------- events ---------------- */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    updateBadge(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  updateBadge(tabId, tab.url);
});

// Periodic re-sync keeps expiry/used state honest between page visits.
chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 20 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) refreshAndRepaint();
});

async function refreshAndRepaint() {
  await fetchCoupons();
  const tabs = await chrome.tabs.query({ active: true });
  for (const t of tabs) updateBadge(t.id, t.url);
}

/* ---------------- messages (popup / options) ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'getMatches': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const session = await getSession();
        sendResponse({
          host: hostOf(tab?.url),
          matches: matchesForHost(hostOf(tab?.url)),
          connected: !!await requireSession(),
          user_email: session?.user_email || null
        });
        break;
      }
      case 'saveSession':            // handed over by the options connect flow
        await saveSession(msg.session);
        await fetchCoupons().then(() => refreshAndRepaint());
        sendResponse({ ok: true });
        break;
      case 'disconnect':
        await saveSession(null);
        couponCache = [];
        await clearAllBadges();
        sendResponse({ ok: true });
        break;
      case 'syncNow':
        await fetchCoupons();
        await refreshAndRepaint();
        sendResponse({ ok: true, count: couponCache.length });
        break;
      default:
        sendResponse({ error: 'unknown message' });
    }
  })();
  return true;                        // async sendResponse
});
