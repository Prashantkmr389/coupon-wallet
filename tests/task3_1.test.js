const assert = require('assert');

function parseAndDeduplicateImport(existingCoupons, importedData) {
  const incoming = (importedData && importedData.coupons) || (Array.isArray(importedData) ? importedData : null);
  if (!Array.isArray(incoming)) throw new Error("Invalid backup format");

  const existingMap = {};
  existingCoupons.forEach(c => {
    existingMap[`${c.brand}|${c.code}`.toLowerCase()] = true;
  });

  let added = 0;
  let skipped = 0;
  const toInsert = [];

  incoming.forEach(c => {
    if (!c || !c.brand || !c.code || !c.expiry_date) return;
    const key = `${c.brand}|${c.code}`.toLowerCase();
    if (existingMap[key]) {
      skipped++;
    } else {
      existingMap[key] = true;
      added++;
      toInsert.push({ ...c, id: c.id || `coupon-${Date.now()}` });
    }
  });

  return { added, skipped, toInsert };
}

function runTests() {
  console.log("Running Task 3.1 tests...");

  const existing = [
    { id: "1", brand: "Amazon", code: "SAVE50", expiry_date: "2026-08-25" }
  ];

  const backupData = {
    app: "coupon-wallet",
    version: 1,
    coupons: [
      { id: "1", brand: "Amazon", code: "SAVE50", expiry_date: "2026-08-25" }, // duplicate
      { id: "2", brand: "Uber", code: "RIDE20", expiry_date: "2026-08-30" }    // new
    ]
  };

  const result = parseAndDeduplicateImport(existing, backupData);
  assert.strictEqual(result.added, 1, "Should add 1 new coupon");
  assert.strictEqual(result.skipped, 1, "Should skip 1 duplicate coupon");
  assert.strictEqual(result.toInsert[0].brand, "Uber", "New coupon brand should be Uber");

  console.log("✅ All Task 3.1 tests passed!");
}

runTests();
