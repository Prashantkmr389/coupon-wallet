const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log("Running Phase 7 Capture & Archive tests...");

  // Exercise the app's REAL capture module and savings math.
  const { looksLikeCouponText, combineShareParams } = await import('../shared/capture.mjs');
  const { totalSaved } = await import('../shared/savings.mjs');

  const root = path.join(__dirname, '..');
  const indexContent = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const manifestContent = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const swContent = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const schemaContent = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
  const digestContent = fs.readFileSync(path.join(root, 'supabase', 'functions', 'weekly-digest', 'index.ts'), 'utf8');
  const nudgesContent = fs.readFileSync(path.join(root, 'supabase', 'functions', 'send-push-nudges', 'index.ts'), 'utf8');
  const extContent = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');

  // =========== 1. looksLikeCouponText (real module) ===========
  assert.strictEqual(looksLikeCouponText("Cred Alert: Use code SAVE500 on Amazon to get ₹500 off on min order ₹2000."), true);
  assert.strictEqual(looksLikeCouponText("Code MYNTRA50 gets you 50% off on everything."), true);
  assert.strictEqual(looksLikeCouponText("hello there friend"), false);

  // Deliberate decision: a bare code-like token is never enough —
  // order IDs / reference numbers would false-positive constantly.
  assert.strictEqual(looksLikeCouponText("SAVE500"), false, "bare code alone must NOT trigger");
  assert.strictEqual(looksLikeCouponText("Your order ID XB12KD99 has shipped"), false, "bare order ID must NOT trigger");

  // Each supporting signal qualifies on its own.
  assert.strictEqual(looksLikeCouponText("Use promo WINTER20 at checkout"), true, "keyword signal");
  assert.strictEqual(looksLikeCouponText("Grab XYZ1234 before 25/12/2026"), true, "date signal");
  assert.strictEqual(looksLikeCouponText("Show ABCD1234 at the Myntra counter"), true, "brand signal");
  assert.strictEqual(looksLikeCouponText("Flat ₹250 cashback on REF90210"), true, "amount signal");

  assert.strictEqual(looksLikeCouponText(""), false);
  assert.strictEqual(looksLikeCouponText(null), false);
  var long = new Array(301).join("SAVE500 ₹500 off ");   // >2000 chars, coupon-shaped
  assert.ok(long.length > 2000);
  assert.strictEqual(looksLikeCouponText(long), false, "over-long clipboard text must be ignored");

  // =========== 2. combineShareParams (real module) ===========
  assert.strictEqual(
    combineShareParams({ title: 'Check this out', text: 'Code SAVE500', url: 'https://x.co/a' }),
    'Check this out\nCode SAVE500\nhttps://x.co/a',
    "title+text+url merge with newlines"
  );
  assert.strictEqual(combineShareParams({ title: null, text: 'Code SAVE500', url: '' }), 'Code SAVE500', "missing parts are skipped");
  assert.strictEqual(combineShareParams({}), '', "all-empty parts → no share");
  assert.strictEqual(combineShareParams(null), '');
  var u = 'https://example.com/deal?ref=share';
  assert.strictEqual(
    combineShareParams({ title: 't', text: 'Look at this: ' + u, url: u }),
    't\nLook at this: ' + u,
    "url already inside text must not be duplicated"
  );
  var bigTitle = new Array(201).join('abcdefghij');      // 2000 chars exactly
  var merged = combineShareParams({ title: bigTitle, text: 'extra', url: 'u' });
  assert.strictEqual(merged.length, 2000, "combined share payload is capped at 2000 chars");

  // =========== 3. Schema: idempotent archived columns ===========
  assert(schemaContent.includes("ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE"),
    "schema.sql must add an idempotent archived boolean");
  assert(schemaContent.includes("ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL"),
    "schema.sql must add an idempotent archived_at timestamp");

  // =========== 4. Archive wiring in the app ===========
  assert(indexContent.includes('function liveCoupons()'), "a single liveCoupons() gate must exist");

  // Delete button archives — the 'delete' action branch must not hard-delete.
  var delStart = indexContent.indexOf("if(action==='delete'){");
  var restoreStart = indexContent.indexOf("if(action==='restore'){");
  assert(delStart !== -1 && restoreStart !== -1 && restoreStart > delStart,
    "list click handler must have delete (archive) and restore branches");
  var delBranch = indexContent.slice(delStart, restoreStart);
  assert(delBranch.includes('archived=true') && delBranch.includes('archived_at='),
    "delete action must set archived=true with a timestamp");
  assert(!delBranch.includes('dbDelete('), "delete action must NOT hard-delete anymore");

  // dbDelete still exists for delete-forever — the only hard-delete path.
  var foreverStart = indexContent.indexOf("if(action==='delete-forever'){");
  assert(foreverStart !== -1, "archive tickets must offer Delete forever");
  assert(indexContent.slice(foreverStart).includes('dbDelete(id)'),
    "delete-forever must call the real dbDelete");

  // liveCoupons applied at every default surface.
  assert(indexContent.includes('var live=liveCoupons().filter('), "renderStats must gate the live count through liveCoupons()");
  assert(indexContent.includes(':liveCoupons();'), "renderList must build its pool from liveCoupons() (or archived when toggled)");
  assert(indexContent.includes('exportCalendar(liveCoupons().filter('), "exportAllToCalendar must exclude archived rows");
  assert(indexContent.includes('return liveCoupons().filter(function(item){'),
    "checkDuplicate must exclude archived so re-adding works after archiving");

  // Savings tracker exemption — the durability point.
  assert.strictEqual(totalSaved([{ used: true, archived: true, discount_text: '₹200 off' }]), 200,
    "totalSaved keeps counting archived+used coupons");

  // Undo restores instead of reinserting; archive view exists.
  assert(delBranch.includes("'Undo'"), "archive delete keeps the existing Undo toast");
  assert(delBranch.includes('archived=false') && delBranch.includes('archived_at=null'),
    "Undo clears the archive flags");
  assert(indexContent.includes('id="archiveBtn"'), "index.html must have the 🗃 Archive view toggle");
  assert(indexContent.includes('state.showArchived'), "archive view state must exist");
  assert(indexContent.includes('data-action="restore"'), "archived tickets must render Restore");
  assert(indexContent.includes('data-action="delete-forever"'), "archived tickets must render Delete forever");

  // Server-side consumers hide archived rows too.
  assert(digestContent.includes(".eq('archived', false)"), "weekly-digest must exclude archived coupons");
  assert(nudgesContent.includes('.eq("archived", false)'), "send-push-nudges must exclude archived coupons");
  assert(extContent.includes('!c.archived'), "extension must filter archived coupons client-side");

  // =========== 5. Share target ===========
  assert.strictEqual(manifestContent.share_target.method, 'GET', "GET-based target: no SW POST handling needed");
  assert.strictEqual(manifestContent.share_target.action, './index.html', "action must stay inside scope ./");
  assert.strictEqual(manifestContent.share_target.params.text, 'text');
  assert(manifestContent.share_target.params.title === 'title' && manifestContent.share_target.params.url === 'url');
  assert(indexContent.includes('URLSearchParams(location.search)'), "init must parse shared query params");
  assert(indexContent.includes('history.replaceState'), "shared URL must be scrubbed so refresh/back doesn't re-trigger");
  assert(indexContent.includes('combineShareParams'), "share params must go through the shared capture module");

  // =========== 6. Clipboard quick-add + self-copy suppression ===========
  assert(indexContent.includes('clipboard-read'), "clipboard quick-add must check permission state");
  assert(indexContent.includes("'granted'"), "quick-add must run only when clipboard-read is already granted (never prompt on launch)");
  assert(indexContent.includes('lastCopiedCode'), "copy button must record the code for self-copy suppression");
  assert(indexContent.match(/lastCopiedCode/g).length >= 2, "both writer (copy handler) and reader (quick-add) must use lastCopiedCode");
  assert(indexContent.includes('looksLikeCouponText'), "quick-add must gate on the capture heuristic");

  // =========== 7. Prefill regression (the "undefined" id corruption) ===========
  assert(!indexContent.includes('form.id.value=coupon.id;'),
    "unguarded form.id.value=coupon.id must stay fixed — it wrote literal \"undefined\" ids and every AI capture overwrote the last one");
  assert(indexContent.includes("(coupon&&coupon.id)||''"), "openModal must guard against id-less objects");
  assert(indexContent.includes('function openModalPrefilled(parsed)'), "prefills must route through openModalPrefilled");
  assert((indexContent.match(/openModalPrefilled\(/g) || []).length >= 4,
    "all three prefill entry points (AI Capture, clipboard, share target) plus the definition must be present");

  // =========== 8. Service worker ===========
  assert(swContent.includes("'coupon-wallet-v3'"), "CACHE must bump so clients pick up Phase 7 assets");
  assert(swContent.includes("'./shared/capture.mjs'"), "SHELL must precache the new shared module");
  assert(swContent.includes("!c.archived"), "local push reminder math must ignore archived coupons");

  console.log("✅ All Phase 7 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Phase 7 tests failed:", err);
  process.exit(1);
});
