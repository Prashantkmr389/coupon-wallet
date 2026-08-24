const assert = require('assert');

async function runTests() {
  console.log("Running Task 2.1 tests...");

  // Exercise the app's REAL expiry logic (shared/expiry.mjs) — the same
  // module index.html imports.
  const { daysUntil, getExpireStatus, statusOf, daysLabel } = await import('../shared/expiry.mjs');

  const today = "2026-08-15";
  // Local-midnight construction: daysUntil reads LOCAL components from the
  // injected clock, so the clock must be built from local components too.
  // A UTC-midnight Date is the previous local day west of UTC (verified
  // failing under TZ=America/Los_Angeles).
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };

  // 1. Used coupon
  const cUsed = { used: true, reusable: false, expiry_date: "2026-08-20" };
  assert.strictEqual(getExpireStatus(cUsed, d(today)).status, "used");

  // 2. Expired coupon
  const cExpired = { used: false, reusable: false, expiry_date: "2026-08-10" };
  const resExpired = getExpireStatus(cExpired, d(today));
  assert.strictEqual(resExpired.status, "expired");
  assert.strictEqual(resExpired.daysUntilExpiry, -5);

  // 3. Expires today
  const cToday = { used: false, reusable: false, expiry_date: "2026-08-15" };
  const resToday = getExpireStatus(cToday, d(today));
  assert.strictEqual(resToday.status, "expires-today");
  assert.strictEqual(resToday.daysUntilExpiry, 0);

  // 4. Expiring soon boundary: day 7 is 'soon', day 8 is not
  assert.strictEqual(getExpireStatus({ used: false, reusable: false, expiry_date: "2026-08-22" }, d(today)).status, "expiring-soon");
  assert.strictEqual(getExpireStatus({ used: false, reusable: false, expiry_date: "2026-08-23" }, d(today)).status, "active");
  const resSoon = getExpireStatus({ used: false, reusable: false, expiry_date: "2026-08-20" }, d(today));
  assert.strictEqual(resSoon.daysUntilExpiry, 5);

  // 5. Active (> 7 days)
  const cActive = { used: false, reusable: false, expiry_date: "2026-08-30" };
  const resActive = getExpireStatus(cActive, d(today));
  assert.strictEqual(resActive.status, "active");
  assert.strictEqual(resActive.daysUntilExpiry, 15);

  // 6. Reusable used coupon stays live per its expiry date
  const cReusable = { used: true, reusable: true, expiry_date: "2026-08-20" };
  assert.strictEqual(getExpireStatus(cReusable, d(today)).status, "expiring-soon");

  // 7. Coarse grouping status collapses today+soon into 'soon'
  assert.strictEqual(statusOf(cToday, d(today)), "soon");
  assert.strictEqual(statusOf(cActive, d(today)), "active");

  // 8. Human labels
  assert.strictEqual(daysLabel(cToday, d(today)), "Expires today");
  assert.strictEqual(daysLabel(cExpired, d(today)), "Expired 5d ago");
  assert.strictEqual(daysLabel({ used: false, reusable: false, expiry_date: "2026-08-16" }, d(today)), "1 day left");
  assert.strictEqual(daysLabel({ used: true, reusable: false, expiry_date: "2026-09-01" }, d(today)), "Marked used");

  // 8b. Garbage/missing expiry: triages as expired but never leaks the
  // -9999 sentinel into user-facing text.
  const cGarbage = { used: false, reusable: false, expiry_date: "" };
  assert.strictEqual(daysUntil("", d(today)), -9999);
  assert.strictEqual(getExpireStatus(cGarbage, d(today)).status, "expired");
  assert.strictEqual(daysLabel(cGarbage, d(today)), "No valid expiry");

  // 9. Omitting `now` uses the current day (production path).
  // Tomorrow is built from local components — a UTC+24h ISO date can land
  // two calendar days ahead of local "tomorrow" near midnight west of UTC.
  const n = new Date();
  const tmr = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  const tomorrowIso = tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0');
  assert.strictEqual(daysUntil(tomorrowIso), 1);
  assert.strictEqual(getExpireStatus({ used: false, reusable: false, expiry_date: tomorrowIso }).status, "expiring-soon");

  console.log("✅ All Task 2.1 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Task 2.1 tests failed:", err);
  process.exit(1);
});
