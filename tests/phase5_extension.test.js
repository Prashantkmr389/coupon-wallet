const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');

function read(p) { return fs.readFileSync(path.join(extDir, p), 'utf8'); }

// ---- Load background.js matching logic in a sandbox (no chrome APIs needed
// ---- for the pure functions; they're defined before any chrome.* call). ----
function loadMatchingLogic() {
  const src = read('background.js');
  // Cut the file at the first chrome.* usage: everything above is pure logic.
  const cut = src.indexOf('/* ---------------- badges');
  const sandbox = { URL };               // URL is a platform global, not a JS intrinsic
  vm.createContext(sandbox);
  vm.runInContext(src.slice(0, cut) + `
    this.__exports = { daysUntil, hostOf, domainsMatch, isSpendable, couponMatchesHost, matchesForHost };
    this.couponCache = couponCache;
  `, sandbox);
  return {
    api: sandbox.__exports,
    // Bare assignment (no `let`) so we mutate the existing lexical binding.
    setCache(list) {
      vm.runInContext(`couponCache = ${JSON.stringify(list)};`, sandbox);
    }
  };
}

async function runTests() {
  console.log("Running Phase 5 Chrome Extension tests...");

  // The extension can't import from the web root (MV3 packaging), so
  // background.js carries a necessary copy of daysUntil — guard that it
  // stays behaviourally identical to shared/expiry.mjs.
  const { daysUntil: sharedDaysUntil } = await import('../shared/expiry.mjs');

  // =========== 1. Manifest (MV3) ===========
  const manifest = JSON.parse(read('manifest.json'));
  assert.strictEqual(manifest.manifest_version, 3, "must be a Manifest V3 extension");
  assert.ok(manifest.background.service_worker === 'background.js', "MV3 service worker required");
  assert.ok(manifest.action.default_popup === 'popup.html', "toolbar action must open popup");
  assert.deepStrictEqual(
    manifest.permissions.sort(),
    ['alarms', 'scripting', 'storage', 'tabs'],
    "permissions must be minimal: storage/tabs/alarms/scripting"
  );
  assert.ok(manifest.host_permissions.includes("https://*.supabase.co/*"),
    "needs host permission to call Supabase REST");
  assert.ok(manifest.host_permissions.some(h => h.includes('coupoun.netlify.app')),
    "needs host permission on the deployed wallet app for the session bridge");
  assert.ok(!manifest.content_scripts, "no persistent content scripts — bridge runs on demand");

  // =========== 2. Background: session + sync + badge wiring ===========
  const bg = read('background.js');
  assert(bg.includes('grant_type=refresh_token'), "must refresh expired tokens via Supabase auth endpoint");
  assert(bg.includes('/rest/v1/coupons?select=*'), "must fetch coupons via REST");
  assert(bg.includes('apikey: session.key'), "requests must carry the anon key");
  assert(bg.includes('Authorization: `Bearer ${session.access_token}`'), "requests must carry the user JWT");
  assert(bg.includes('setBadgeText'), "must paint per-tab badges");
  assert(bg.includes('chrome.tabs.onUpdated.addListener'), "badge must update on navigation");
  assert(bg.includes('periodInMinutes'), "coupon cache must re-sync periodically");
  assert(bg.includes('c.used && !c.reusable') || bg.includes('(c.used && !c.reusable)'),
    "used non-reusable coupons must be excluded from badges");

  // =========== 3. Matching logic behaviour ===========
  const m = loadMatchingLogic();
  const today = new Date();
  const iso = offsetDays => {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays));
    return d.toISOString().split('T')[0];
  };

  assert.strictEqual(m.api.daysUntil(iso(0)), 0);
  assert.strictEqual(m.api.daysUntil(iso(-1)), -1);
  assert.ok(m.api.daysUntil(iso(7)) <= 7 && m.api.daysUntil(iso(7)) >= 6);

  // Behavioural parity between the extension's copy and the canonical module
  for (const offset of [-30, -1, 0, 1, 7, 8, 365]) {
    assert.strictEqual(m.api.daysUntil(iso(offset)), sharedDaysUntil(iso(offset)),
      `background.js daysUntil diverged from shared/expiry.mjs at +${offset}d`);
  }
  for (const garbage of ['', 'not-a-date', '2026-13-99']) {
    assert.strictEqual(m.api.daysUntil(garbage), sharedDaysUntil(garbage),
      "garbage-input sentinel must match too");
  }

  assert.strictEqual(m.api.hostOf('https://www.amazon.in/gp/cart'), 'amazon.in');
  assert.strictEqual(m.api.hostOf('not a url'), '');
  assert.ok(m.api.domainsMatch('makemytrip.com', 'www.makemytrip.com'));
  assert.ok(!m.api.domainsMatch('amazon.in', 'flipkart.com'));

  m.setCache([
    { brand: 'MakeMyTrip', code: 'FLIGHT500', expiry_date: iso(10), used: false,
      redeem_url: 'https://www.makemytrip.com/offer' },
    { brand: 'Myntra', code: 'STYLE200', expiry_date: iso(-1), used: false,
      redeem_url: 'https://myntra.com' },                       // expired → hidden
    { brand: 'Amazon', code: 'USED100', expiry_date: iso(30), used: true,
      redeem_url: 'https://amazon.in' },                        // used, not reusable → hidden
    { brand: 'Amazon', code: 'REUSE50', expiry_date: iso(30), used: true, reusable: true }, // no URL…
    { brand: 'Swiggy', code: 'EAT99', expiry_date: iso(2), used: false }                    // …brand hint only
  ]);

  const mm = m.api.matchesForHost('www.makemytrip.com');
  assert.strictEqual(mm.length, 1, "redeem_url domain must match across www");
  assert.strictEqual(mm[0].code, 'FLIGHT500');

  const amz = m.api.matchesForHost('amazon.in');
  assert.strictEqual(amz.length, 1, "expired and consumed coupons must never surface");
  assert.strictEqual(amz[0].code, 'REUSE50', "reusable used coupon stays live; brand hint covers missing redeem_url");

  const swiggy = m.api.matchesForHost('swiggy.com');
  assert.strictEqual(swiggy.length, 1, "BRAND_DOMAINS hint must match without redeem_url");
  assert.strictEqual(swiggy[0].code, 'EAT99');

  // Soonest-expiry first so the best code is on top.
  m.setCache([
    { brand: 'Zomato', code: 'LATER', expiry_date: iso(20), used: false },
    { brand: 'Zomato', code: 'SOON', expiry_date: iso(1), used: false }
  ]);
  assert.strictEqual(m.api.matchesForHost('zomato.com')[0].code, 'SOON');

  assert.strictEqual(m.api.matchesForHost('').length, 0, "no host → no matches");
  assert.strictEqual(m.api.matchesForHost('unknown-shop.example').length, 0, "unrelated site → no matches");

  // =========== 4. Popup & options wiring ===========
  const popupJs = read('popup.js');
  assert(popupJs.includes("type: 'getMatches'"), "popup must ask background for matches");
  assert(popupJs.includes('clipboard.writeText'), "popup must offer one-click copy");
  assert(popupJs.includes('.replaceChildren(') || popupJs.includes('replaceChildren('),
    "popup must build coupon nodes via DOM APIs (no data-in-HTML templates)");
  assert(!/innerHTML\s*=\s*`[^`]*\$\{/.test(popupJs),
    "popup must not interpolate API data into innerHTML templates");

  const optionsJs = read('options.js');
  assert(optionsJs.includes('sb-.*-auth-token'), "options must locate the supabase-js session key pattern");
  assert(optionsJs.includes('cw_supabase_url'), "options must read the app's stored Supabase URL");
  assert(optionsJs.includes('saveSession'), "options must hand the session to the background worker");
  assert(optionsJs.includes('supabase\\.co'), "options must validate the scraped URL shape before saving");
  assert(fs.existsSync(path.join(extDir, 'popup.html')), "popup.html must exist");
  assert(fs.existsSync(path.join(extDir, 'options.html')), "options.html must exist");
  assert(fs.existsSync(path.join(extDir, 'icons', 'icon512.png')), "icon asset must exist");

  console.log("✅ All Phase 5 Chrome Extension tests passed!");
}

runTests().catch(err => {
  console.error("❌ Phase 5 tests failed:", err);
  process.exit(1);
});
