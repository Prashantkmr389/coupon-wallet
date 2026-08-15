const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log("Running Phase 3 Email Digest & Web Push tests...");

  const root = path.join(__dirname, '..');

  // 1. Verify Edge Function files exist
  const edgeFnPath = path.join(root, 'supabase', 'functions', 'weekly-digest', 'index.ts');
  const edgeConfigPath = path.join(root, 'supabase', 'functions', 'weekly-digest', 'config.json');

  assert(fs.existsSync(edgeFnPath), "weekly-digest/index.ts must exist");
  assert(fs.existsSync(edgeConfigPath), "weekly-digest/config.json must exist");

  const edgeConfig = JSON.parse(fs.readFileSync(edgeConfigPath, 'utf8'));
  assert.strictEqual(edgeConfig.schedule, "0 9 * * 1", "Cron schedule must be Monday 9 AM");

  const edgeFnContent = fs.readFileSync(edgeFnPath, 'utf8');
  assert(edgeFnContent.includes("formatDigestEmail"), "Edge function must format digest emails");
  assert(edgeFnContent.includes("expiringCoupons"), "Edge function must check expiring coupons");

  // 2. Verify push_subscriptions table in schema.sql
  const schemaPath = path.join(root, 'supabase', 'schema.sql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');

  assert(schemaContent.includes("CREATE TABLE IF NOT EXISTS public.push_subscriptions"), "schema.sql must create push_subscriptions table");
  assert(schemaContent.includes("endpoint TEXT NOT NULL UNIQUE"), "push_subscriptions must store endpoint");

  // 3. Verify Service Worker push event listener in sw.js
  const swPath = path.join(root, 'sw.js');
  const swContent = fs.readFileSync(swPath, 'utf8');

  assert(swContent.includes("addEventListener('push'"), "sw.js must contain push listener");
  assert(swContent.includes("addEventListener('notificationclick'"), "sw.js must contain notificationclick listener");

  // 4. Verify index.html Web Push toggle
  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  assert(indexContent.includes('id="pushBtn"'), "index.html must have pushBtn toggle button");
  assert(indexContent.includes('enableWebPush'), "index.html must contain enableWebPush handler");

  console.log("✅ All Phase 3 Email Digest & Web Push tests passed!");
}

runTests();
