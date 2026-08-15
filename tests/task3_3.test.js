const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log("Running Task 3.3 tests...");

  // 1. Verify manifest.json exists and is valid JSON with required keys
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  assert(fs.existsSync(manifestPath), "manifest.json must exist");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert(manifest.name, "manifest must have name");
  assert(manifest.short_name, "manifest must have short_name");
  assert(manifest.start_url, "manifest must have start_url");
  assert(manifest.display, "manifest must have display");
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "manifest must have icons");

  // 2. Verify sw.js exists and contains install, activate, and fetch listeners
  const swPath = path.join(__dirname, '..', 'sw.js');
  assert(fs.existsSync(swPath), "sw.js must exist");
  const swContent = fs.readFileSync(swPath, 'utf8');

  assert(swContent.includes("addEventListener('install'"), "sw.js must handle install event");
  assert(swContent.includes("addEventListener('activate'"), "sw.js must handle activate event");
  assert(swContent.includes("addEventListener('fetch'"), "sw.js must handle fetch event");

  // 3. Verify index.html links manifest and registers SW
  const indexPath = path.join(__dirname, '..', 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  assert(indexContent.includes('rel="manifest"'), "index.html must link manifest.json");
  assert(indexContent.includes('navigator.serviceWorker.register'), "index.html must register service worker");

  console.log("✅ All Task 3.3 tests passed!");
}

runTests();
