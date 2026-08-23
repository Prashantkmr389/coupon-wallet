const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

// ---- Execute sw.js notification-copy logic in a sandbox with a fake IDB ----
function loadSwHelpers(coupons) {
  const src = read('sw.js');
  // The Web Push section holds both the pure helpers and the push listener;
  // take it whole — listener registration becomes a no-op in the sandbox.
  const cut = src.indexOf('/* ---------------- Web Push');
  const idb = {
    open(name, version) {
      return {
        set onerror(fn) { /* not triggered */ },
        set onsuccess(fn) { fn.call(this); },
        get result() {
          return {
            transaction(_store, _mode) {
              return {
                objectStore() {
                  return {
                    getAll() {
                      return {
                        set onerror(fn) { void fn; },
                        set onsuccess(fn) { this.result = coupons; fn.call(this); },
                        result: null
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const sandbox = {
    console, indexedDB: idb,
    self: { indexedDB: idb, addEventListener() {} } // listener registration becomes a no-op
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(cut) + `
    this.__exports = { daysUntil, buildReminderPayload, readCoupons };
  `, sandbox);
  return sandbox.__exports;
}

async function runTests() {
  console.log("Running Web Push delivery tests...");

  // =========== 1. Key generator script ===========
  const genPath = path.join(root, 'scripts', 'generate-vapid-keys.mjs');
  assert(fs.existsSync(genPath), "VAPID key generator script must exist");
  const genSrc = read(genPath.replace(/\\/g, '/').replace(root + '/', ''));
  assert(genSrc.includes("'ECDSA'") && genSrc.includes("'P-256'"), "generator must produce a P-256 ECDSA pair");

  // =========== 2. Sender Edge Function ===========
  const fnDir = path.join(root, 'supabase', 'functions', 'send-push-nudges');
  assert(fs.existsSync(path.join(fnDir, 'index.ts')), "send-push-nudges function must exist");

  const cfg = JSON.parse(read('supabase/functions/send-push-nudges/config.json'));
  assert.strictEqual(cfg.schedule, "0 9 * * *", "nudge cron must run daily at 9am (day-before nudges)");

  const fn = read('supabase/functions/send-push-nudges/index.ts');
  for (const secret of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    assert(fn.includes(secret), `function must read ${secret} from env secrets`);
  }
  assert(fn.includes('req.method === "GET"') && fn.includes('publicKey'),
    "GET must serve the VAPID public key to the client");
  assert(fn.includes('.eq("expiry_date", iso(tomorrow))'),
    "must target coupons expiring tomorrow (day-before nudge)");
  assert(fn.includes('from("push_subscriptions")'), "must read saved subscriptions");
  assert(fn.includes('vapid t='), "requests must carry VAPID authorization");
  assert(fn.includes('ES256') && fn.includes('SHA-256'),
    "JWT must be signed ES256/SHA-256 per RFC 8292");
  assert(fn.includes('res.status === 404 || res.status === 410'),
    "gone endpoints must be pruned from the table");
  assert(!fn.includes('aes128gcm') && !fn.includes('"Content-Encoding"'),
    "payload-less design: no hand-rolled RFC 8291 encryption to get wrong");

  // =========== 3. Client subscribe flow ===========
  const indexContent = read('index.html');
  assert(!indexContent.includes('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgTzkrxw_3-q4Z0X_Y123'),
    "the hardcoded demo VAPID key must be gone — mismatched keys silently never deliver");
  assert(indexContent.includes('cw_vapid_public'), "client must cache the resolved public key");
  assert(indexContent.includes("invoke('send-push-nudges',{ method:'GET' })"),
    "client must fetch the public key from the edge function");
  assert(indexContent.includes('urlBase64ToUint8Array'),
    "base64url public key must be converted for applicationServerKey");
  assert(indexContent.includes("Sign in first"), "guests must be told why push can't be enabled");

  // =========== 4. Service worker payload handling ===========
  const sw = read('sw.js');
  assert(sw.includes("event.data") && sw.includes("readCoupons"),
    "SW must handle both explicit payloads and bare pushes");
  assert(sw.includes("indexedDB.open('coupon-wallet',1)"),
    "bare pushes must read the local wallet mirror");

  const today = new Date();
  const iso = offsetDays => new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays))
    .toISOString().split('T')[0];

  let h = loadSwHelpers([]);
  let p = await h.buildReminderPayload(await h.readCoupons());
  assert.strictEqual(p.title, 'Coupon Wallet Reminder', "empty wallet → generic fallback copy");

  h = loadSwHelpers([
    { brand: 'A', code: 'A1', expiry_date: iso(1), used: false },
    { brand: 'B', code: 'B2', expiry_date: iso(1), used: false },
    { brand: 'C', code: 'C3', expiry_date: iso(5), used: false },
    { brand: 'D', code: 'D4', expiry_date: iso(30), used: false },   // outside window
    { brand: 'E', code: 'E5', expiry_date: iso(1), used: true },     // consumed → excluded
    { brand: 'F', code: 'F6', expiry_date: iso(-1) }                  // expired → excluded
  ]);
  p = await h.buildReminderPayload(await h.readCoupons());
  assert(p.title.includes('2 coupons expire tomorrow'), `tomorrow count wrong: ${p.title}`);
  assert(p.body.includes('1 more this week'), `weekly remainder wrong: ${p.body}`);

  h = loadSwHelpers([{ brand: 'G', code: 'G7', expiry_date: iso(6), used: false }]);
  p = await h.buildReminderPayload(await h.readCoupons());
  assert(p.title.includes('1 coupon expiring this week'), `week-only case wrong: ${p.title}`);

  // Reusable-but-used stays live; used non-reusable does not.
  h = loadSwHelpers([
    { brand: 'H', code: 'H8', expiry_date: iso(1), used: true, reusable: true }
  ]);
  p = await h.buildReminderPayload(await h.readCoupons());
  assert(p.title.includes('1 coupon'), `reusable used coupon must still surface: ${p.title}`);

  console.log("✅ All Web Push delivery tests passed!");
}

runTests().catch(err => {
  console.error("❌ Web Push delivery tests failed:", err);
  process.exit(1);
});
