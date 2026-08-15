const { indexedDB, IDBKeyRange } = require('fake-indexeddb');
const assert = require('assert');

// Global setup for node environment mimicking browser
global.indexedDB = indexedDB;

// Import storage module or inline functions for testing
let db = null;
const DB_NAME = "coupon-wallet";
const DB_VERSION = 1;
const STORE = "coupons";

async function dbOpen() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onupgradeneeded = (e) => {
      const store = e.target.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("expiry", "expiry_date", { unique: false });
      store.createIndex("brand", "brand", { unique: false });
    };
  });
}

async function dbAll() {
  const d = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function dbPut(coupon) {
  const d = await dbOpen();
  coupon.id = coupon.id || `coupon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  coupon.created_at = coupon.created_at || new Date().toISOString();
  coupon.updated_at = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readwrite").objectStore(STORE).put(coupon);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(coupon.id);
  });
}

async function dbDelete(id) {
  const d = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function dbClose() {
  if (db) {
    db.close();
    db = null;
  }
}

async function runTests() {
  console.log("Running Task 1.1 tests...");

  // 1. dbOpen is idempotent
  const db1 = await dbOpen();
  const db2 = await dbOpen();
  assert.strictEqual(db1, db2, "dbOpen should return cached database instance");

  // 2. dbAll returns empty array initially
  const initialCoupons = await dbAll();
  assert(Array.isArray(initialCoupons), "dbAll must return an array");
  assert.strictEqual(initialCoupons.length, 0, "dbAll must be empty initially");

  // 3. dbPut adds a coupon and returns id string
  const sampleCoupon = {
    brand: "Amazon",
    code: "SAVE50",
    discount_text: "₹500 off",
    min_order_value: 1000,
    category: "electronics",
    source_app: "Cred",
    expiry_date: "2026-08-25",
    redeem_url: "https://amazon.in",
    notes: "Test note",
    reusable: false,
    used: false,
    used_at: null
  };
  const couponId = await dbPut(sampleCoupon);
  assert(typeof couponId === "string", "dbPut must return string ID");
  assert(sampleCoupon.created_at, "dbPut must set created_at");
  assert(sampleCoupon.updated_at, "dbPut must set updated_at");

  // 4. dbAll returns added coupon
  const couponsAfterPut = await dbAll();
  assert.strictEqual(couponsAfterPut.length, 1, "dbAll must return 1 coupon");
  assert.strictEqual(couponsAfterPut[0].id, couponId, "ID must match");
  assert.strictEqual(couponsAfterPut[0].brand, "Amazon", "Brand must match");

  // 5. dbDelete removes coupon
  await dbDelete(couponId);
  const couponsAfterDelete = await dbAll();
  assert.strictEqual(couponsAfterDelete.length, 0, "dbAll must be empty after delete");

  // 6. dbClose closes DB connection
  await dbClose();
  assert.strictEqual(db, null, "db instance must be null after dbClose");

  console.log("✅ All Task 1.1 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Task 1.1 tests failed:", err);
  process.exit(1);
});
