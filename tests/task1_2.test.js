const { indexedDB } = require('fake-indexeddb');
const assert = require('assert');

global.indexedDB = indexedDB;

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

// Data Layer implementation
async function addCoupon(brand, code, discount_text, min_order_value, category, source_app, expiry_date, redeem_url, notes, reusable) {
  const coupon = {
    brand: (brand || '').trim(),
    code: (code || '').trim(),
    discount_text: (discount_text || '').trim(),
    min_order_value: min_order_value == null || min_order_value === '' ? null : Number(min_order_value),
    category: category || 'Other',
    source_app: source_app || 'Other',
    expiry_date,
    redeem_url: (redeem_url || '').trim() || null,
    notes: (notes || '').trim(),
    reusable: !!reusable,
    used: false,
    used_at: null
  };
  await dbPut(coupon);
  return coupon;
}

async function getCoupon(id) {
  const all = await dbAll();
  return all.find(c => c.id === id) || null;
}

async function updateCoupon(id, updates) {
  const coupon = await getCoupon(id);
  if (!coupon) throw new Error(`Coupon ${id} not found`);
  Object.assign(coupon, updates);
  await dbPut(coupon);
  return coupon;
}

async function markUsed(id) {
  const now = new Date().toISOString();
  return updateCoupon(id, { used: true, used_at: now });
}

async function markUnused(id) {
  return updateCoupon(id, { used: false, used_at: null });
}

async function deleteCoupon(id) {
  await dbDelete(id);
}

async function runTests() {
  console.log("Running Task 1.2 tests...");

  // 1. Add coupon
  const added = await addCoupon(
    " Amazon ", " SAVE50 ", " ₹500 off ", 1000, "electronics", "Cred",
    "2026-08-25", "https://amazon.in", "  notes  ", false
  );
  assert(added.id, "Coupon must have id");
  assert.strictEqual(added.brand, "Amazon", "Brand should be trimmed");
  assert.strictEqual(added.code, "SAVE50", "Code should be trimmed");
  assert.strictEqual(added.used, false, "New coupon used should be false");
  assert.strictEqual(added.used_at, null, "New coupon used_at should be null");

  // 2. Get coupon
  const fetched = await getCoupon(added.id);
  assert.deepStrictEqual(fetched, added, "Fetched coupon should match added coupon");

  // 3. Update coupon
  const updated = await updateCoupon(added.id, { discount_text: "₹600 off" });
  assert.strictEqual(updated.discount_text, "₹600 off", "discount_text updated");

  // 4. Mark used
  const used = await markUsed(added.id);
  assert.strictEqual(used.used, true, "used should be true");
  assert(used.used_at, "used_at should be populated");

  // 5. Mark unused
  const unused = await markUnused(added.id);
  assert.strictEqual(unused.used, false, "used should be false");
  assert.strictEqual(unused.used_at, null, "used_at should be null");

  // 6. Delete coupon
  await deleteCoupon(added.id);
  const postDelete = await getCoupon(added.id);
  assert.strictEqual(postDelete, null, "Coupon should be null after delete");

  console.log("✅ All Task 1.2 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Task 1.2 tests failed:", err);
  process.exit(1);
});
