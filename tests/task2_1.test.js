const assert = require('assert');

function getExpireStatus(coupon, nowStr) {
  if (coupon.used && !coupon.reusable) {
    return { status: "used", daysUntilExpiry: -1 };
  }

  const p = String(coupon.expiry_date).split('-').map(Number);
  const exp = Date.UTC(p[0], p[1] - 1, p[2]);

  let today;
  if (nowStr) {
    const np = String(nowStr).split('-').map(Number);
    today = Date.UTC(np[0], np[1] - 1, np[2]);
  } else {
    const n = new Date();
    today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  }

  const daysUntilExpiry = Math.round((exp - today) / 86400000);

  if (daysUntilExpiry < 0) return { status: "expired", daysUntilExpiry };
  if (daysUntilExpiry === 0) return { status: "expires-today", daysUntilExpiry };
  if (daysUntilExpiry <= 7) return { status: "expiring-soon", daysUntilExpiry };
  return { status: "active", daysUntilExpiry };
}

function runTests() {
  console.log("Running Task 2.1 tests...");

  const today = "2026-08-15";

  // 1. Used coupon
  const cUsed = { used: true, reusable: false, expiry_date: "2026-08-20" };
  assert.strictEqual(getExpireStatus(cUsed, today).status, "used");

  // 2. Expired coupon
  const cExpired = { used: false, reusable: false, expiry_date: "2026-08-10" };
  const resExpired = getExpireStatus(cExpired, today);
  assert.strictEqual(resExpired.status, "expired");
  assert.strictEqual(resExpired.daysUntilExpiry, -5);

  // 3. Expires today
  const cToday = { used: false, reusable: false, expiry_date: "2026-08-15" };
  const resToday = getExpireStatus(cToday, today);
  assert.strictEqual(resToday.status, "expires-today");
  assert.strictEqual(resToday.daysUntilExpiry, 0);

  // 4. Expiring soon (<= 7 days)
  const cSoon = { used: false, reusable: false, expiry_date: "2026-08-20" };
  const resSoon = getExpireStatus(cSoon, today);
  assert.strictEqual(resSoon.status, "expiring-soon");
  assert.strictEqual(resSoon.daysUntilExpiry, 5);

  // 5. Active (> 7 days)
  const cActive = { used: false, reusable: false, expiry_date: "2026-08-30" };
  const resActive = getExpireStatus(cActive, today);
  assert.strictEqual(resActive.status, "active");
  assert.strictEqual(resActive.daysUntilExpiry, 15);

  // 6. Reusable used coupon stays active / status according to expiry
  const cReusable = { used: true, reusable: true, expiry_date: "2026-08-20" };
  assert.strictEqual(getExpireStatus(cReusable, today).status, "expiring-soon");

  console.log("✅ All Task 2.1 tests passed!");
}

runTests();
