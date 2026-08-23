const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ---- Savings tracker logic (mirrors index.html parseSavedAmount/totalSaved) ----
function parseSavedAmount(text) {
  if (!text) return 0;
  const m = String(text).match(/(?:₹|rs\.?\s*|\$)\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function totalSaved(coupons) {
  return coupons.reduce((sum, c) => sum + (c.used ? parseSavedAmount(c.discount_text) : 0), 0);
}

async function runTests() {
  console.log("Running Phase 6 Household & Savings Tracker tests...");

  const root = path.join(__dirname, '..');

  // =========== 1. Schema: household tables, columns, RLS ===========
  const schemaPath = path.join(root, 'supabase', 'schema.sql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');

  assert(schemaContent.includes("CREATE TABLE IF NOT EXISTS public.households"), "schema.sql must create households table");
  assert(schemaContent.includes("CREATE TABLE IF NOT EXISTS public.household_members"), "schema.sql must create household_members table");

  assert(schemaContent.includes("household_id UUID DEFAULT NULL"), "coupons must gain a nullable household_id column");
  assert(schemaContent.includes("used_by TEXT DEFAULT NULL"), "coupons must gain a used_by column");
  assert(schemaContent.includes("inbound_token TEXT NOT NULL UNIQUE"), "households must have a unique inbound_token for the forwarding address");
  assert(schemaContent.includes("DEFAULT auth.uid()"), "households.owner_id must default to the creating user");

  // RLS coverage
  for (const policy of [
    "Owners manage their household",
    "Members can view their household",
    "Members can view membership rows of their households",
    "Invited users can claim their invite",
    "Household owners can manage members",
    "Members can leave their household"
  ]) {
    assert(schemaContent.includes(policy), `schema.sql must define policy "${policy}"`);
  }
  assert(schemaContent.includes("ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY"),
    "RLS must be enabled on both new tables");

  // Household visibility must flow through membership, not just ownership
  assert(schemaContent.includes("m.user_id = auth.uid() AND m.status = 'active'"),
    "coupon SELECT policy must admit active household members");

  // Invitee claiming path
  assert(schemaContent.includes("email = auth.email()"), "membership policies must match invites by auth email");

  // =========== 2. Edge functions ===========
  const inboundPath = path.join(root, 'supabase', 'functions', 'inbound-coupon', 'index.ts');
  assert(fs.existsSync(inboundPath), "inbound-coupon edge function must exist");
  const inboundContent = fs.readFileSync(inboundPath, 'utf8');
  assert(inboundContent.includes("wallet\\+([a-f0-9]{8,64})@"), "inbound-coupon must extract the household token from wallet+<token>@ addresses");
  assert(inboundContent.includes("parseTextRuleBased"), "inbound-coupon must reuse the rule-based coupon parser");
  assert(inboundContent.includes(".eq('inbound_token', inboundToken)"),
    "inbound-coupon must look up households by inbound_token");
  assert(inboundContent.includes("user_id: household.owner_id"), "inbound-coupon inserts must be attributed to the household owner (FK to auth.users)");
  assert(inboundContent.includes("household_id: household.id"), "inbound-coupon inserts must tag the coupon with the household_id");

  const invitePath = path.join(root, 'supabase', 'functions', 'household-invite', 'index.ts');
  assert(fs.existsSync(invitePath), "household-invite edge function must exist");
  const inviteContent = fs.readFileSync(invitePath, 'utf8');
  assert(inviteContent.includes("RESEND_API_KEY"), "household-invite must send via Resend when configured");
  assert(inviteContent.includes("emailed: false") || inviteContent.includes("emailed:false"),
    "household-invite must degrade gracefully without an API key");

  // =========== 3. App UI & logic wiring ===========
  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  assert(indexContent.includes('id="hhBtn"'), "index.html must have a Household button");
  assert(indexContent.includes('id="hhModalBackdrop"'), "index.html must have the household modal");
  assert(indexContent.includes("claimPendingInvites"), "sign-in must auto-claim pending invites by email");
  assert(indexContent.includes("syncHousehold()"), "auth state changes must refresh household state");
  assert(indexContent.includes("parseSavedAmount"), "savings parser must exist in the app");
  assert(indexContent.includes("toLocaleString('en-IN')"), "₹-saved figure must use Indian digit grouping");
  assert(indexContent.includes("used_by=usedBy||null"), "mark-as-used must record who used it");
  assert(indexContent.includes("c.used_by=null;"), "un-use must clear used_by");
  assert(indexContent.includes("by '+esc(c.used_by)"), "tickets must show who used a shared coupon");

  // =========== 4. Savings math ===========
  assert.strictEqual(parseSavedAmount("₹500 off flight bookings"), 500);
  assert.strictEqual(parseSavedAmount("Rs. 1,200 off"), 1200, "comma-grouped amounts must parse");
  assert.strictEqual(parseSavedAmount("$25 off"), 25);
  assert.strictEqual(parseSavedAmount("50% off sitewide"), 0, "percent-off cannot become rupees — must contribute 0");
  assert.strictEqual(parseSavedAmount(""), 0);
  assert.strictEqual(parseSavedAmount(null), 0);

  const saved = totalSaved([
    { used: true, discount_text: "₹500 off" },
    { used: true, discount_text: "Rs. 250 cashback" },
    { used: false, discount_text: "₹9999 off" },      // unused → excluded
    { used: true, discount_text: "20% off" }           // percent → 0
  ]);
  assert.strictEqual(saved, 750, "totalSaved must sum flat discounts over used coupons only");

  // =========== 5. used_by lifecycle through storage ===========
  class MockLocalStore {
    constructor() { this.data = []; }
    async getAll() { return [...this.data]; }
    async put(c) {
      c.id = c.id || `local-${Date.now()}`;
      const i = this.data.findIndex(x => x.id === c.id);
      if (i !== -1) this.data[i] = c; else this.data.push(c);
      return c.id;
    }
    async delete(id) { this.data = this.data.filter(x => x.id !== id); }
  }

  const store = new MockLocalStore();
  await store.put({ id: "c1", brand: "Myntra", code: "STYLE500", discount_text: "₹500 off", expiry_date: "2026-09-01", used: false, used_by: null });

  // Mark used with attribution
  const coupon = (await store.getAll())[0];
  coupon.used = true;
  coupon.used_at = new Date().toISOString();
  coupon.used_by = "Priya";
  await store.put(coupon);

  let all = await store.getAll();
  assert.strictEqual(all[0].used, true);
  assert.strictEqual(all[0].used_by, "Priya", "used_by must persist through mark-as-used");

  // Un-use clears attribution
  all[0].used = false;
  all[0].used_at = null;
  all[0].used_by = null;
  await store.put(all[0]);
  all = await store.getAll();
  assert.strictEqual(all[0].used_by, null, "un-use must clear used_by");

  console.log("✅ All Phase 6 Household & Savings Tracker tests passed!");
}

runTests().catch(err => {
  console.error("❌ Phase 6 tests failed:", err);
  process.exit(1);
});
