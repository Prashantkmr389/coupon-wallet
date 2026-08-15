const assert = require('assert');

function checkDuplicate(coupons, brand, code) {
  const b = (brand || '').trim().toLowerCase();
  const c = (code || '').trim().toLowerCase();
  return coupons.some(item => item.brand.toLowerCase() === b && item.code.toLowerCase() === c);
}

class UndoManager {
  constructor() {
    this.stack = [];
  }

  push(action, data) {
    this.stack.push({ action, data, timestamp: Date.now() });
    if (this.stack.length > 20) this.stack.shift();
  }

  undo(state) {
    if (this.stack.length === 0) return null;
    const entry = this.stack.pop();
    const { action, data } = entry;

    if (action === "add") {
      state.coupons = state.coupons.filter(c => c.id !== data.id);
    } else if (action === "update") {
      const idx = state.coupons.findIndex(c => c.id === data.previousValue.id);
      if (idx !== -1) state.coupons[idx] = { ...data.previousValue };
    } else if (action === "delete") {
      state.coupons.push({ ...data.coupon });
    }
    return entry;
  }
}

function runTests() {
  console.log("Running Task 2.2 tests...");

  const coupons = [
    { id: "1", brand: "Amazon", code: "SAVE50" },
    { id: "2", brand: "Myntra", code: "FASHION100" }
  ];

  // 1. checkDuplicate returns true for existing brand + code case-insensitively
  assert.strictEqual(checkDuplicate(coupons, "amazon", "save50"), true);
  assert.strictEqual(checkDuplicate(coupons, "Amazon", "SAVE50"), true);
  assert.strictEqual(checkDuplicate(coupons, "Amazon", "SAVE100"), false);
  assert.strictEqual(checkDuplicate(coupons, "Flipkart", "SAVE50"), false);

  // 2. Undo stack handling
  const undoMgr = new UndoManager();
  const state = { coupons: [...coupons] };

  // Test undo add
  undoMgr.push("add", { id: "3" });
  state.coupons.push({ id: "3", brand: "Zomato", code: "FOOD20" });
  assert.strictEqual(state.coupons.length, 3);
  undoMgr.undo(state);
  assert.strictEqual(state.coupons.length, 2);
  assert.strictEqual(state.coupons.find(c => c.id === "3"), undefined);

  // Test undo update
  const original = { ...state.coupons[0] };
  state.coupons[0].code = "MODIFIED";
  undoMgr.push("update", { previousValue: original });
  undoMgr.undo(state);
  assert.strictEqual(state.coupons[0].code, "SAVE50");

  // Test undo delete
  const deleted = state.coupons.pop();
  undoMgr.push("delete", { coupon: deleted });
  undoMgr.undo(state);
  assert.strictEqual(state.coupons.length, 2);

  console.log("✅ All Task 2.2 tests passed!");
}

runTests();
