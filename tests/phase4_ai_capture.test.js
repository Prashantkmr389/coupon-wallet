const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log("Running Phase 4 AI Capture tests...");

  // Exercise the REAL parser — the exact module shared by index.html,
  // parse-coupon, and inbound-coupon.
  const { parseTextRuleBased } = await import('../shared/coupon-parser.mjs');

  // Test Sample 1: Cred SMS
  const sms1 = "Cred Alert: Use code SAVE500 on Amazon to get ₹500 off on min order ₹2000. Valid till 2026-08-25.";
  const res1 = parseTextRuleBased(sms1);

  assert.strictEqual(res1.brand.toLowerCase(), "amazon");
  assert.strictEqual(res1.code, "SAVE500");
  assert.strictEqual(res1.min_order_value, 2000);
  assert.strictEqual(res1.expiry_date, "2026-08-25");
  assert.match(res1.discount_text, /₹500/);
  assert.strictEqual(res1.source_app, "Cred");

  // Test Sample 2: Myntra Email
  const sms2 = "Exclusive Offer! Code MYNTRA50 gets you 50% off on your next purchase. Exp: 30/12/2026";
  const res2 = parseTextRuleBased(sms2);

  assert.strictEqual(res2.brand.toLowerCase(), "myntra");
  assert.strictEqual(res2.code, "MYNTRA50");
  assert.strictEqual(res2.discount_text.toLowerCase(), "50% off");
  assert.strictEqual(res2.expiry_date, "2026-12-30");
  assert.strictEqual(res2.source_app, "SMS / Text", "no source app mentioned → default");

  // Test Sample 3: nothing extractable → sane defaults, no crash
  const res3 = parseTextRuleBased("hello there friend");
  assert.ok(res3.expiry_date.match(/^\d{4}-\d{2}-\d{2}$/), "default expiry must be ISO");
  assert.strictEqual(res3.brand, "Other");
  assert.strictEqual(res3.notes.length <= 150, true);

  // Single source of truth wiring:
  const root = path.join(__dirname, '..');
  const parseFnPath = path.join(root, 'supabase', 'functions', 'parse-coupon', 'index.ts');
  assert(fs.existsSync(parseFnPath), "supabase/functions/parse-coupon/index.ts must exist");
  const inboundFnPath = path.join(root, 'supabase', 'functions', 'inbound-coupon', 'index.ts');
  assert(fs.existsSync(inboundFnPath), "supabase/functions/inbound-coupon/index.ts must exist");

  for (const fnPath of [parseFnPath, inboundFnPath]) {
    const src = fs.readFileSync(fnPath, 'utf8');
    assert(src.includes("shared/coupon-parser.mjs"), `${path.basename(path.dirname(fnPath))} must import the shared parser`);
    assert(!src.includes("codeMatch = clean.match"), `${path.basename(path.dirname(fnPath))} must not carry a copied parser body`);
  }

  // Verify index.html UI integration (imports the module rather than defining it)
  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert(indexContent.includes('id="aiBtn"'), "index.html must contain aiBtn button");
  assert(indexContent.includes("from './shared/coupon-parser.mjs'"), "index.html must import the shared parser");
  assert(!indexContent.includes("function parseTextRuleBased"), "index.html must not redefine the parser");

  console.log("✅ All Phase 4 AI Capture tests passed!");
}

runTests().catch(err => {
  console.error("❌ Phase 4 tests failed:", err);
  process.exit(1);
});
