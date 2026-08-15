# Coupon Wallet: Phases 1–6 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a coupon organizer from local-first PWA (Phase 1, ship this week) through to a cross-device sync, AI-powered capture, and purchase-time notifications (Phases 2–6).

**Architecture:** 
- **Phase 1:** Single HTML file, IndexedDB storage, calendar-delegated reminders, PWA manifest and service worker. No backend, no auth. Prioritizes speed-to-market over feature completeness.
- **Phases 2–3:** Migrate storage to Supabase Postgres with magic-link auth; add scheduled email digests and optional push notifications.
- **Phases 4–6:** AI-assisted coupon capture, browser extension for purchase-time surface, shared household wallet.

**Tech Stack:** 
- Phase 1: vanilla JS, IndexedDB, PWA (`manifest.json`, service worker)
- Phase 2+: Supabase Postgres, Edge Functions, Claude API (Phase 4)

**Spec:** `ADR-0001-coupon-wallet-phasing.md` (this repository)

## Global Constraints

- **Data model:** Field-for-field match to eventual Postgres schema from day one; Phase 2 storage swap must require only swapping four functions (`openDB`, `dbAll`, `dbPut`, `dbDelete`).
- **Phase 1 deployment:** Static hosting (Netlify Drop or Vercel); zero running cost.
- **Coupon immutability:** Expiry dates don't change; calendar-exported alarms are fire-and-forget.
- **Privacy:** No coupon data leaves the device in Phase 1; all processing stays client-side until Phase 2.
- **Naming:** Coupons have a schema of `{id, brand, code, discount_text, min_order_value, category, source_app, expiry_date, redeem_url, notes, reusable, used, used_at, created_at, updated_at}`. All code must use these exact field names for Phase 2 compatibility.

---

# PHASE 1: Local-First PWA (Sprint 1–3, Days 1–7)

**Goal:** Ship an installable, offline-capable coupon wallet by EOW. No server, no auth, no running cost.

## Phase 1 File Structure

**New files to create:**
- `index.html` — entire app (UI + logic, single file, no build step)
- `manifest.json` — PWA metadata (name, icons, display mode, start URL)
- `sw.js` — service worker for app-shell caching and offline support
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — home screen and splash icons

**Data persists in:** IndexedDB database `coupon-wallet` with object store `coupons`.

**Module boundaries (within `index.html`):**
- **Storage layer** (`dbOpen()`, `dbAll()`, `dbPut()`, `dbDelete()`, `dbClose()`) — IndexedDB calls only. This layer will be replaced in Phase 2.
- **Data layer** (coupon CRUD: `addCoupon()`, `updateCoupon()`, `markUsed()`, `markUnused()`, `deleteCoupon()`) — wraps storage, enforces schema
- **Business logic** (expiry classification, reminder exports) — no storage calls
- **UI layer** (DOM updates, event listeners) — render coupons, capture form input

## Phase 1: Sprint 1 (Day 1–2) — Core Storage and Data Model

### Task 1.1: Set up IndexedDB storage layer and seed schema

**Files:**
- Create: `index.html` (storage section only, ~50 lines)

**Interfaces:**
- Produces: `dbOpen()` → `Promise<IDBDatabase>`, idempotent
- Produces: `dbAll()` → `Promise<Array<Coupon>>`
- Produces: `dbPut(coupon)` → `Promise<string>` (returns coupon id, creates if new, updates if exists)
- Produces: `dbDelete(id)` → `Promise<void>`
- Produces: `dbClose()` → `Promise<void>`

**Schema (Coupon object):**
```javascript
{
  id: string,                    // UUID or timestamp-based, auto-generated
  brand: string,                 // e.g., "Amazon"
  code: string,                  // coupon code, e.g., "SAVE50"
  discount_text: string,         // e.g., "₹500 off" or "50% off"
  min_order_value: number | null,// ₹ amount, or null if no minimum
  category: string,              // e.g., "groceries", "flights", "electronics"
  source_app: string,            // e.g., "Cred", "Google Pay", "Myntra"
  expiry_date: string,           // 'YYYY-MM-DD' format
  redeem_url: string | null,     // link to checkout page
  notes: string,                 // user notes
  reusable: boolean,             // true = card benefit / recurring offer, don't retire on use
  used: boolean,                 // false = active, true = redeemed
  used_at: string | null,        // ISO timestamp when marked used
  created_at: string,            // ISO timestamp, set on insert
  updated_at: string             // ISO timestamp, set on insert or update
}
```

**Steps:**

- [ ] **Step 1: Write failing test for storage layer**

```javascript
// In index.html, add a test section (can be removed post-Phase-1)
async function testStorage() {
  const db = await dbOpen();
  const results = await dbAll();
  console.assert(Array.isArray(results), "dbAll should return an array");
  await dbClose();
}
```

- [ ] **Step 2: Run test to verify it fails**

Open `index.html` in browser, check console. Expect: `ReferenceError: dbOpen is not defined`

- [ ] **Step 3: Implement IndexedDB storage functions**

```javascript
let db = null;

async function dbOpen() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open("coupon-wallet", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onupgradeneeded = (e) => {
      const store = e.target.result.createObjectStore("coupons", { keyPath: "id" });
      store.createIndex("expiry", "expiry_date");
      store.createIndex("brand", "brand");
    };
  });
}

async function dbAll() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction("coupons", "readonly").objectStore("coupons").getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result || []);
  });
}

async function dbPut(coupon) {
  const db = await dbOpen();
  coupon.id = coupon.id || `coupon-${Date.now()}`;
  coupon.created_at = coupon.created_at || new Date().toISOString();
  coupon.updated_at = new Date().toISOString();
  
  return new Promise((resolve, reject) => {
    const req = db.transaction("coupons", "readwrite").objectStore("coupons").put(coupon);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(coupon.id);
  });
}

async function dbDelete(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction("coupons", "readwrite").objectStore("coupons").delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function dbClose() {
  if (db) db.close();
  db = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Refresh browser, check console. Expect: test passes silently (no assertion fails), `dbAll()` returns `[]` on first open.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add IndexedDB storage layer with schema"
```

---

### Task 1.2: Build data layer and coupon CRUD operations

**Files:**
- Modify: `index.html` (add data layer after storage section)

**Interfaces:**
- Consumes: `dbOpen()`, `dbAll()`, `dbPut()`, `dbDelete()` (from Task 1.1)
- Produces: `addCoupon(brand, code, discount_text, min_order_value, category, source_app, expiry_date, redeem_url, notes, reusable)` → `Promise<Coupon>`
- Produces: `updateCoupon(id, updates)` → `Promise<Coupon>`
- Produces: `markUsed(id)` → `Promise<Coupon>`
- Produces: `markUnused(id)` → `Promise<Coupon>`
- Produces: `deleteCoupon(id)` → `Promise<void>`
- Produces: `getCoupon(id)` → `Promise<Coupon | null>`

**Steps:**

- [ ] **Step 1: Write failing test for data layer**

```javascript
async function testDataLayer() {
  const coupon = await addCoupon(
    "Amazon", "SAVE50", "₹500 off", 1000, "electronics", "Cred",
    "2026-08-25", "https://amazon.in", "", false
  );
  console.assert(coupon.id, "Coupon should have an id");
  console.assert(coupon.brand === "Amazon", "Brand should match");
  console.assert(coupon.used === false, "New coupon should not be used");
}
```

- [ ] **Step 2: Run test to verify it fails**

Expect: `ReferenceError: addCoupon is not defined`

- [ ] **Step 3: Implement data layer functions**

```javascript
async function addCoupon(brand, code, discount_text, min_order_value, category, source_app, expiry_date, redeem_url, notes, reusable) {
  const coupon = {
    brand,
    code,
    discount_text,
    min_order_value,
    category,
    source_app,
    expiry_date,
    redeem_url: redeem_url || null,
    notes,
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
  return updateCoupon(id, { used: true, used_at: new Date().toISOString() });
}

async function markUnused(id) {
  return updateCoupon(id, { used: false, used_at: null });
}

async function deleteCoupon(id) {
  await dbDelete(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Expect: test passes, new coupon is in IndexedDB.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add data layer with coupon CRUD"
```

---

## Phase 1: Sprint 2 (Day 3–4) — UI and Expiry Triage

### Task 2.1: Build UI shell and expiry status computation

**Files:**
- Modify: `index.html` (add UI and business logic sections)

**Interfaces:**
- Consumes: `dbAll()`, `getCoupon()`, `addCoupon()`, `updateCoupon()`, `markUsed()`, `markUnused()`, `deleteCoupon()`
- Produces: `getExpireStatus(coupon)` → `{ status: string, daysUntilExpiry: number }`
  - status: `"active"`, `"expiring-soon"` (≤7 days), `"expires-today"`, `"expired"`, `"used"`
- Produces: `renderCoupons(coupons, filterCategory)` → updates DOM
- Produces: `renderForm()` → injects form HTML into page
- Produces: `initializeApp()` → runs on page load

**Steps:**

- [ ] **Step 1: Write HTML structure**

Add to `index.html` `<body>`:

```html
<div id="app">
  <header>
    <h1>Coupon Wallet</h1>
    <button id="exportBtn">Export backup</button>
    <button id="importBtn">Import backup</button>
  </header>

  <nav>
    <button class="filter" data-category="all">All</button>
    <button class="filter" data-category="groceries">Groceries</button>
    <button class="filter" data-category="flights">Flights</button>
    <button class="filter" data-category="electronics">Electronics</button>
    <input type="search" id="searchBox" placeholder="Search...">
  </nav>

  <section id="triageSection">
    <h2>Needs attention</h2>
    <div id="triageCoupons"></div>
  </section>

  <section id="formSection">
    <h2>Add coupon</h2>
    <form id="couponForm">
      <input type="text" id="brand" placeholder="Brand" required>
      <input type="text" id="code" placeholder="Coupon code" required>
      <input type="text" id="discount_text" placeholder="Discount (e.g., ₹500 off)" required>
      <input type="number" id="min_order_value" placeholder="Min order (optional)">
      <select id="category" required>
        <option value="">Category</option>
        <option value="groceries">Groceries</option>
        <option value="flights">Flights</option>
        <option value="electronics">Electronics</option>
        <option value="other">Other</option>
      </select>
      <input type="text" id="source_app" placeholder="Source (Cred, GPay, etc.)">
      <input type="date" id="expiry_date" required>
      <input type="url" id="redeem_url" placeholder="Redeem link (optional)">
      <textarea id="notes" placeholder="Notes (optional)"></textarea>
      <label><input type="checkbox" id="reusable"> Reusable offer</label>
      <button type="submit">Add coupon</button>
    </form>
  </section>

  <section id="listSection">
    <h2>Your coupons</h2>
    <div id="couponList"></div>
  </section>
</div>
```

- [ ] **Step 2: Implement expiry status computation**

```javascript
function getExpireStatus(coupon) {
  if (coupon.used) return { status: "used", daysUntilExpiry: -1 };
  
  const expiry = new Date(coupon.expiry_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  
  const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) return { status: "expired", daysUntilExpiry };
  if (daysUntilExpiry === 0) return { status: "expires-today", daysUntilExpiry };
  if (daysUntilExpiry <= 7) return { status: "expiring-soon", daysUntilExpiry };
  return { status: "active", daysUntilExpiry };
}

function shouldShowInTriage(coupon) {
  const { status } = getExpireStatus(coupon);
  return ["expiring-soon", "expires-today"].includes(status) && !coupon.used;
}
```

- [ ] **Step 3: Implement render functions**

```javascript
function renderCoupons(coupons, filterCategory = "all", searchTerm = "") {
  let filtered = coupons.slice();
  
  if (filterCategory !== "all") {
    filtered = filtered.filter(c => c.category === filterCategory);
  }
  
  if (searchTerm) {
    filtered = filtered.filter(c =>
      c.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }
  
  filtered.sort((a, b) => {
    const aStatus = getExpireStatus(a);
    const bStatus = getExpireStatus(b);
    return aStatus.daysUntilExpiry - bStatus.daysUntilExpiry;
  });
  
  const triageList = filtered.filter(shouldShowInTriage);
  const activeList = filtered.filter(c => !shouldShowInTriage(c));
  
  renderTriageSection(triageList);
  renderCouponList(activeList);
}

function renderTriageSection(coupons) {
  const triageDiv = document.getElementById("triageCoupons");
  if (coupons.length === 0) {
    triageDiv.innerHTML = "<p>All clear!</p>";
    return;
  }
  
  triageDiv.innerHTML = coupons.map(coupon => {
    const { status, daysUntilExpiry } = getExpireStatus(coupon);
    const statusText = status === "expires-today" ? "Expires today" : `${daysUntilExpiry} day(s) left`;
    return `
      <div class="coupon-card triage">
        <div class="coupon-header">
          <h3>${coupon.brand}</h3>
          <span class="status ${status}">${statusText}</span>
        </div>
        <p class="code">${coupon.code}</p>
        <p class="discount">${coupon.discount_text}</p>
        <button onclick="quickMarkUsed('${coupon.id}')">Mark used</button>
        <button onclick="editCoupon('${coupon.id}')">Edit</button>
      </div>
    `;
  }).join("");
}

function renderCouponList(coupons) {
  const listDiv = document.getElementById("couponList");
  listDiv.innerHTML = coupons.map(coupon => {
    const { status, daysUntilExpiry } = getExpireStatus(coupon);
    const expireText = status === "expired" ? "Expired" : `Expires ${coupon.expiry_date}`;
    return `
      <div class="coupon-card ${status}">
        <div class="coupon-header">
          <h3>${coupon.brand}</h3>
          <span class="status ${status}">${expireText}</span>
        </div>
        <p class="code">${coupon.code}</p>
        <p class="discount">${coupon.discount_text}</p>
        ${coupon.min_order_value ? `<p class="min-order">Min: ₹${coupon.min_order_value}</p>` : ""}
        <button onclick="quickMarkUsed('${coupon.id}')">Mark used</button>
        <button onclick="editCoupon('${coupon.id}')">Edit</button>
        <button onclick="deleteCoupon('${coupon.id}')">Delete</button>
      </div>
    `;
  }).join("");
}

async function initializeApp() {
  await dbOpen();
  const coupons = await dbAll();
  renderCoupons(coupons);
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById("couponForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    await addCoupon(
      form.brand.value,
      form.code.value,
      form.discount_text.value,
      form.min_order_value.value ? parseInt(form.min_order_value.value) : null,
      form.category.value,
      form.source_app.value,
      form.expiry_date.value,
      form.redeem_url.value,
      form.notes.value,
      form.reusable.checked
    );
    form.reset();
    const coupons = await dbAll();
    renderCoupons(coupons);
  });
  
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", async () => {
      const category = btn.dataset.category;
      const searchTerm = document.getElementById("searchBox").value;
      const coupons = await dbAll();
      renderCoupons(coupons, category, searchTerm);
    });
  });
  
  document.getElementById("searchBox").addEventListener("input", async (e) => {
    const searchTerm = e.target.value;
    const activeFilter = document.querySelector(".filter.active")?.dataset.category || "all";
    const coupons = await dbAll();
    renderCoupons(coupons, activeFilter, searchTerm);
  });
}

async function quickMarkUsed(id) {
  await markUsed(id);
  const coupons = await dbAll();
  renderCoupons(coupons);
}

async function editCoupon(id) {
  const coupon = await getCoupon(id);
  // TODO: Implement edit modal (Task 2.2)
}

window.addEventListener("load", initializeApp);
```

- [ ] **Step 4: Add minimal CSS**

Add to `index.html` `<head>`:

```html
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 1rem; max-width: 800px; margin: 0 auto; }
  header { margin-bottom: 2rem; }
  header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  header button { margin-right: 0.5rem; padding: 0.5rem 1rem; }
  
  nav { margin-bottom: 2rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  nav button { padding: 0.5rem 1rem; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; background: #f9f9f9; }
  nav button.active { background: #007bff; color: white; }
  
  section { margin-bottom: 2rem; }
  section h2 { margin-bottom: 1rem; }
  
  form { display: flex; flex-direction: column; gap: 0.5rem; }
  form input, form select, form textarea { padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; }
  form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
  
  .coupon-card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: #fafafa; }
  .coupon-card.triage { border-color: #ff9800; background: #fff3e0; }
  .coupon-card.expiring-soon .status { color: #ff9800; }
  .coupon-card.expires-today .status { color: #f44336; }
  .coupon-card.expired { opacity: 0.6; }
  .coupon-card.used { opacity: 0.5; }
  
  .coupon-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
  .coupon-header h3 { font-size: 1.2rem; }
  .status { font-size: 0.9rem; font-weight: bold; }
  
  .code { font-family: monospace; font-weight: bold; margin: 0.5rem 0; }
  .discount { font-size: 1.1rem; margin: 0.5rem 0; }
  .min-order { font-size: 0.9rem; color: #666; }
  
  .coupon-card button { margin-right: 0.5rem; margin-top: 0.5rem; padding: 0.4rem 0.8rem; font-size: 0.9rem; }
</style>
```

- [ ] **Step 5: Run and test in browser**

Open `index.html` via `python3 -m http.server 8000`. Add a test coupon, verify triage section shows it if expiry ≤ 7 days.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add UI with expiry triage, form, and coupon list"
```

---

### Task 2.2: Implement edit, undo, and duplicate detection

**Files:**
- Modify: `index.html` (add edit modal and undo logic)

**Interfaces:**
- Consumes: `getCoupon()`, `updateCoupon()`, `addCoupon()`
- Produces: `editCoupon(id)` → opens modal, saves edits
- Produces: `undo()` → reverts last action (add, update, delete)
- Produces: `checkDuplicate(brand, code)` → `boolean` (true if already exists)

**Steps:**

- [ ] **Step 1: Add edit modal HTML**

Insert before `</div>` in body:

```html
<div id="editModal" class="modal" style="display: none;">
  <div class="modal-content">
    <span class="close" onclick="closeEditModal()">&times;</span>
    <h2>Edit coupon</h2>
    <form id="editForm">
      <input type="hidden" id="editId">
      <input type="text" id="editBrand" placeholder="Brand" required>
      <input type="text" id="editCode" placeholder="Coupon code" required>
      <input type="text" id="editDiscount" placeholder="Discount" required>
      <input type="number" id="editMin" placeholder="Min order (optional)">
      <select id="editCategory" required>
        <option value="groceries">Groceries</option>
        <option value="flights">Flights</option>
        <option value="electronics">Electronics</option>
        <option value="other">Other</option>
      </select>
      <input type="text" id="editSourceApp" placeholder="Source app">
      <input type="date" id="editExpiry" required>
      <input type="url" id="editRedeemUrl" placeholder="Redeem link (optional)">
      <textarea id="editNotes" placeholder="Notes (optional)"></textarea>
      <label><input type="checkbox" id="editReusable"> Reusable offer</label>
      <button type="submit">Save changes</button>
    </form>
  </div>
</div>
```

Add CSS for modal:

```css
.modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; }
.modal-content { background: white; padding: 2rem; border-radius: 8px; max-width: 500px; width: 90%; }
.close { float: right; font-size: 1.5rem; cursor: pointer; }
```

- [ ] **Step 2: Implement duplicate detection**

```javascript
async function checkDuplicate(brand, code) {
  const all = await dbAll();
  return all.some(c => c.brand.toLowerCase() === brand.toLowerCase() && c.code.toLowerCase() === code.toLowerCase());
}
```

- [ ] **Step 3: Implement edit functions**

```javascript
async function editCoupon(id) {
  const coupon = await getCoupon(id);
  if (!coupon) return;
  
  document.getElementById("editId").value = coupon.id;
  document.getElementById("editBrand").value = coupon.brand;
  document.getElementById("editCode").value = coupon.code;
  document.getElementById("editDiscount").value = coupon.discount_text;
  document.getElementById("editMin").value = coupon.min_order_value || "";
  document.getElementById("editCategory").value = coupon.category;
  document.getElementById("editSourceApp").value = coupon.source_app;
  document.getElementById("editExpiry").value = coupon.expiry_date;
  document.getElementById("editRedeemUrl").value = coupon.redeem_url || "";
  document.getElementById("editNotes").value = coupon.notes;
  document.getElementById("editReusable").checked = coupon.reusable;
  
  document.getElementById("editModal").style.display = "flex";
}

function closeEditModal() {
  document.getElementById("editModal").style.display = "none";
}

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.getElementById("editId").value;
  
  await updateCoupon(id, {
    brand: form.getElementById("editBrand").value,
    code: form.getElementById("editCode").value,
    discount_text: form.getElementById("editDiscount").value,
    min_order_value: form.getElementById("editMin").value ? parseInt(form.getElementById("editMin").value) : null,
    category: form.getElementById("editCategory").value,
    source_app: form.getElementById("editSourceApp").value,
    expiry_date: form.getElementById("editExpiry").value,
    redeem_url: form.getElementById("editRedeemUrl").value,
    notes: form.getElementById("editNotes").value,
    reusable: form.getElementById("editReusable").checked
  });
  
  closeEditModal();
  const coupons = await dbAll();
  renderCoupons(coupons);
});
```

- [ ] **Step 4: Implement undo (keep a history stack)**

```javascript
let undoStack = [];

async function saveToHistory(action, data) {
  undoStack.push({ action, data, timestamp: Date.now() });
  if (undoStack.length > 20) undoStack.shift();
}

async function undo() {
  if (undoStack.length === 0) return alert("Nothing to undo");
  
  const { action, data } = undoStack.pop();
  
  if (action === "add") {
    await deleteCoupon(data.id);
  } else if (action === "update") {
    await dbPut(data.previousValue);
  } else if (action === "delete") {
    await dbPut(data.coupon);
  }
  
  const coupons = await dbAll();
  renderCoupons(coupons);
}
```

Wrap storage calls to track history (in `addCoupon`, `updateCoupon`, `deleteCoupon`):

```javascript
async function addCoupon(...args) {
  // ... existing code
  saveToHistory("add", { id: coupon.id });
  // ...
}
```

- [ ] **Step 5: Add undo button to header**

In form setup:

```javascript
document.getElementById("undoBtn").addEventListener("click", undo);
```

- [ ] **Step 6: Test and commit**

Add a coupon, edit it, delete it, hit Undo. Verify each undoes the last action.

```bash
git add index.html
git commit -m "feat: add edit modal, duplicate detection, undo"
```

---

## Phase 1: Sprint 3 (Day 5–7) — PWA, Calendar Export, JSON Import/Export, Deployment

### Task 3.1: Implement JSON export/import for backup and cross-device sync

**Files:**
- Modify: `index.html` (add export/import functions)

**Interfaces:**
- Consumes: `dbAll()`, `dbPut()`
- Produces: `exportJSON()` → downloads `coupon-wallet-backup.json`
- Produces: `importJSON(file)` → `Promise<{ added: number, skipped: number }>`

**Steps:**

- [ ] **Step 1: Implement export function**

```javascript
async function exportJSON() {
  const coupons = await dbAll();
  const json = JSON.stringify(coupons, null, 2);
  
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coupon-wallet-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Implement import function**

```javascript
async function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid JSON format");
        
        const existing = await dbAll();
        let added = 0, skipped = 0;
        
        for (const coupon of imported) {
          const duplicate = existing.find(c => c.brand === coupon.brand && c.code === coupon.code);
          if (duplicate) {
            skipped++;
          } else {
            await dbPut(coupon);
            added++;
          }
        }
        
        const coupons = await dbAll();
        renderCoupons(coupons);
        resolve({ added, skipped });
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsText(file);
  });
}

document.getElementById("importBtn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    try {
      const { added, skipped } = await importJSON(e.target.files[0]);
      alert(`Imported ${added} coupons (${skipped} duplicates skipped)`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  input.click();
});

document.getElementById("exportBtn").addEventListener("click", exportJSON);
```

- [ ] **Step 3: Test export/import**

Export, modify the JSON, import it back. Verify duplicates are skipped, new coupons are added.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add JSON export/import for backup and sync"
```

---

### Task 3.2: Implement calendar (ICS) export with three VALARM triggers

**Files:**
- Modify: `index.html` (add ICS export)

**Interfaces:**
- Consumes: `dbAll()`, `getCoupon()`
- Produces: `exportToCalendar(id)` → downloads `.ics` file for one coupon
- Produces: `exportAllToCalendar()` → downloads `.ics` file for all active coupons

**Steps:**

- [ ] **Step 1: Implement single-coupon ICS export**

```javascript
function generateICS(coupon) {
  const id = `coupon-${coupon.id}@coupon-wallet.local`;
  const created = new Date(coupon.created_at).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const modified = new Date(coupon.updated_at).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const expiry = coupon.expiry_date.replace(/-/g, "");
  
  const title = `${coupon.brand} coupon: ${coupon.code} (${coupon.discount_text})`;
  const description = `Code: ${coupon.code}\n${coupon.notes ? `Notes: ${coupon.notes}` : ""}${coupon.redeem_url ? `\nRedeem: ${coupon.redeem_url}` : ""}`;
  
  const alarms = `
BEGIN:VALARM
TRIGGER:-P7D
ACTION:DISPLAY
DESCRIPTION:${title} expires in 7 days
END:VALARM
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:${title} expires tomorrow
END:VALARM
BEGIN:VALARM
TRIGGER:-PT9H
ACTION:DISPLAY
DESCRIPTION:${title} expires today
END:VALARM`;
  
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Coupon Wallet//Local//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${id}
DTSTAMP:${created}
DTSTART:${expiry}
SUMMARY:${title}
DESCRIPTION:${description}
TRANSP:TRANSPARENT
STATUS:CONFIRMED
CREATED:${created}
LAST-MODIFIED:${modified}
${alarms}
END:VEVENT
END:VCALENDAR`;
}

async function exportToCalendar(id) {
  const coupon = await getCoupon(id);
  if (!coupon) return;
  
  const ics = generateICS(coupon);
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${coupon.brand}-${coupon.code}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportAllToCalendar() {
  const coupons = await dbAll();
  const active = coupons.filter(c => !c.used && getExpireStatus(c).status !== "expired");
  
  let ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Coupon Wallet//Local//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH`;
  
  for (const coupon of active) {
    ical += "\n" + generateICS(coupon).split("BEGIN:VCALENDAR")[1].split("END:VCALENDAR")[0];
  }
  
  ical += "\nEND:VCALENDAR";
  
  const blob = new Blob([ical], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `coupon-wallet-calendar-${new Date().toISOString().split("T")[0]}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Add "Add to calendar" button to coupon cards**

Update `renderCouponList` and `renderTriageSection`:

```javascript
<button onclick="exportToCalendar('${coupon.id}')">Add to calendar</button>
```

- [ ] **Step 3: Test calendar export**

Export a coupon to ICS, open it in your calendar app. Verify three alarms appear at correct times.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add ICS export with three VALARM triggers for calendar"
```

---

### Task 3.3: Create PWA manifest and service worker

**Files:**
- Create: `manifest.json`
- Create: `sw.js`

**Interfaces:**
- `manifest.json` declares app metadata (name, icons, theme color, start URL)
- `sw.js` implements app-shell caching and offline support

**Steps:**

- [ ] **Step 1: Add manifest.json**

```json
{
  "name": "Coupon Wallet",
  "short_name": "Coupons",
  "description": "Local-first coupon organizer with calendar-delegated reminders",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#007bff",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "categories": ["productivity", "utilities"]
}
```

- [ ] **Step 2: Add link to manifest in index.html head**

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#007bff">
```

- [ ] **Step 3: Create service worker (sw.js)**

```javascript
const CACHE_NAME = "coupon-wallet-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      // Offline fallback: return cached index.html for navigation requests
      if (event.request.mode === "navigate") {
        return caches.match("/index.html");
      }
    })
  );
});
```

- [ ] **Step 4: Register service worker in index.html**

Add to end of `<body>` or in a `<script>`:

```javascript
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(err => console.log("SW registration failed:", err));
}
```

- [ ] **Step 5: Test PWA install**

Serve via `python3 -m http.server 8000` (HTTPS or localhost). On Android Chrome, menu → Install app. On iOS Safari, Share → Add to Home Screen. Open offline and verify app still works.

- [ ] **Step 6: Commit**

```bash
git add manifest.json sw.js
git commit -m "feat: add PWA manifest and service worker for install and offline"
```

---

### Task 3.4: Add icons and finalize Phase 1 for deployment

**Files:**
- Create: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Update: `index.html` (add viewport meta, apple-touch-icon)

**Steps:**

- [ ] **Step 1: Generate placeholder icons**

Use an online tool (favicon-generator.org) or generate 192×192 and 512×512 PNG icons with your branding. For this task, use a simple blue/white design with the letter "C" for coupon.

Alternatively, create minimal placeholder SVG and convert to PNG:

```bash
# Create a simple SVG (use Figma or similar) and export as PNG
# For now, use a text-to-image tool or placeholder service
```

For Phase 1, you can use a simple online placeholder:

```bash
curl https://via.placeholder.com/192x192/007bff/ffffff?text=C -o icon-192.png
curl https://via.placeholder.com/512x512/007bff/ffffff?text=C -o icon-512.png
cp icon-512.png icon-maskable-512.png
```

- [ ] **Step 2: Add apple-touch-icon and viewport meta to index.html head**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Coupon Wallet">
```

- [ ] **Step 3: Test responsive design**

Test on mobile devices (real or DevTools). Verify form and coupon cards are readable and touch-friendly.

- [ ] **Step 4: Commit**

```bash
git add icon-192.png icon-512.png icon-maskable-512.png index.html
git commit -m "feat: add PWA icons and mobile meta tags"
```

---

### Task 3.5: Deploy to Netlify Drop and validate

**Files:**
- Already created; no new files

**Steps:**

- [ ] **Step 1: Prepare for deployment**

Verify all files are in the repo:
```bash
ls -la /Users/prashant/codebase/coupon-wallet/
```

Expected: `index.html`, `manifest.json`, `sw.js`, three icon PNGs

- [ ] **Step 2: Deploy to Netlify Drop**

1. Go to https://app.netlify.com/drop
2. Drag the entire `/coupon-wallet` folder into the drop zone
3. Netlify generates a temporary HTTPS URL (e.g., `coupon-wallet-abc123.netlify.app`)
4. Test:
   - Add a coupon
   - Export to calendar (check `.ics` downloads)
   - Export JSON backup
   - Install on home screen (Android & iOS)
   - Verify offline mode works (DevTools → Network → Offline)

- [ ] **Step 3: Verify all features work in production**

- [ ] **Step 4: Record the deployment URL**

Save the Netlify URL somewhere (or set up a custom domain later).

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "Phase 1 complete: local-first PWA, IndexedDB, calendar reminders, JSON backup"
```

---

## PHASE 2: Cross-Device Sync + Magic-Link Auth (Backlog, start when device friction bites)

**Goal:** Introduce persistent cross-device sync and basic auth without changing the UI or data model.

**Tech:** Supabase (Postgres + Row-Level Security) + magic-link auth

**High-level tasks:**
1. **Set up Supabase project:** Create Postgres table matching Phase 1 schema exactly
2. **Implement auth:** Magic-link sign-in (email → no password)
3. **Swap storage layer:** Replace `dbOpen()`, `dbAll()`, `dbPut()`, `dbDelete()` with Supabase calls
4. **Import path:** Phase 1 JSON export → Supabase (one-time bulk import)
5. **Test:** Verify all Phase 1 features work unchanged on top of Supabase

**Est. effort:** 1 day

---

## PHASE 3: Email Digests and Web Push (Backlog, start after Phase 2 is stable)

**Goal:** Send reminders beyond the calendar.

**Options:**
- **Weekly digest email:** "5 coupons expiring in the next 7 days" (low friction, good discovery)
- **Optional Web Push:** Same-day nudge (requires explicit user permission, can be ignored)

**High-level tasks:**
1. **Edge Function for digest:** Query coupons due in 7 days, format email, send via SendGrid/Mailgun
2. **Schedule:** Cron trigger every Monday 9 AM
3. **Web Push (optional):** Service worker subscribes to push channel on sign-in; Edge Function sends a push 24h before expiry for selected coupons

**Est. effort:** 1 day (digest), +1 day (push)

---

## PHASE 4: AI-Assisted Coupon Capture (Backlog, start when manual entry friction bites)

**Goal:** Extract coupon details from SMS, email, or screenshot with Claude.

**High-level tasks:**
1. **Paste-to-fields:** User pastes SMS/email → POST to Edge Function → Claude extracts `{brand, code, discount_text, expiry_date}` → returns JSON → prefills form
2. **Screenshot parsing:** Same flow, but Claude reads the image directly (no separate OCR)
3. **UI:** Modal with paste area, shows extracted fields, user clicks "Add" to confirm
4. **Cost:** ~₹0.05–0.10 per parse (Claude API); cost-effective at <500 coupons/month

**Est. effort:** 1 day

---

## PHASE 5: Chrome Extension for Purchase-Time Surface (Backlog, long-term)

**Goal:** Show a badge on retailer checkouts: "🎟 3 unused coupons for Amazon"

**High-level tasks:**
1. **Extension manifest:** Content script injects coupon badge
2. **Domain matching:** Read current tab's domain, match against coupon `redeem_url` domain
3. **Badge:** Click to open coupon details in side panel; optionally open coupon code in clipboard
4. **Sync:** Fetch active coupons from Supabase (Phase 2+ only)

**Est. effort:** 1 day

---

## PHASE 6: Household Sharing and Savings Tracker (Backlog, only if Phase 1–5 sustains daily use)

**Goal:** Share wallet across family members and track cumulative savings.

**High-level tasks:**
1. **Sharing:** Owner invites household members by email; each gets RLS-filtered access to shared coupons
2. **Mark as used:** Include `used_by` field (person's name) in update
3. **Savings tracker:** "₹ saved" = sum of `discount_text` parsed as ₹ amount × count of `used=true` coupons
4. **Forwarding email:** Auto-parse inbound coupon mail, add to wallet

**Est. effort:** 2–3 days

---

## Summary: Delivery Timeline

| Phase | Scope | Effort | Trigger | Timeline |
|-------|-------|--------|---------|----------|
| **1** | Local PWA, IndexedDB, calendar, JSON export | 3 days | Ship now | Aug 15–22 |
| **2** | Supabase + auth + sync | 1 day | After 2 weeks of use + cross-device frustration | Sep |
| **3** | Email digests + push | 1–2 days | After Phase 2 deployed | Sep–Oct |
| **4** | AI coupon extraction | 1 day | After manual entry friction surfaces | Oct |
| **5** | Chrome extension | 1 day | After checkout frustration | Oct–Nov |
| **6** | Household + savings | 2–3 days | Only if Phase 1–5 sustains daily use | Dec+ |

---

## Plan Complete

**Next step:** Execute Phase 1 tasks 1.1–3.5 above to ship the MVP by end of week. Two execution options available:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, with checkpoints for review

Which approach?
