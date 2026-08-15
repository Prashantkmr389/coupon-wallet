const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log("Running Task 3.4 tests...");

  const root = path.join(__dirname, '..');
  const icon192 = path.join(root, 'icon-192.png');
  const icon512 = path.join(root, 'icon-512.png');
  const iconMaskable = path.join(root, 'icon-maskable-512.png');

  assert(fs.existsSync(icon192), "icon-192.png must exist");
  assert(fs.existsSync(icon512), "icon-512.png must exist");
  assert(fs.existsSync(iconMaskable), "icon-maskable-512.png must exist");

  assert(fs.statSync(icon192).size > 100, "icon-192.png must be non-empty");
  assert(fs.statSync(icon512).size > 100, "icon-512.png must be non-empty");
  assert(fs.statSync(iconMaskable).size > 100, "icon-maskable-512.png must be non-empty");

  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  assert(indexContent.includes('name="viewport"'), "index.html must have viewport meta");
  assert(indexContent.includes('viewport-fit=cover'), "index.html must include viewport-fit=cover");
  assert(indexContent.includes('rel="apple-touch-icon"'), "index.html must have apple-touch-icon link");
  assert(indexContent.includes('name="theme-color"'), "index.html must have theme-color meta");

  console.log("✅ All Task 3.4 tests passed!");
}

runTests();
