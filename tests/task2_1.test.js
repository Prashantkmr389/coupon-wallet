const assert = require('assert');

async function runTests() {
  console.log("Running Task 2.1 tests...");

  // Exercise the app's REAL expiry logic (shared/expiry.mjs) — the same
  // module index.html imports.
  const { daysUntil, getExpireStatus, statusOf, daysLabel } = await import('../shared/expiry.mjs');

  const today = "2026-08-15";
  const d = (s) => new Date(s + "T00:00:00Z");

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

  // 9. Omitting `now` uses the current day (production path)
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  assert.strictEqual(daysUntil(tomorrowIso), 1);
  assert.strictEqual(getExpireStatus({ used: false, reusable: false, expiry_date: tomorrowIso }).status, "expiring-soon");

  console.log("✅ All Task 2.1 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Task 2.1 tests failed:", err);
  process.exit(1);
});
