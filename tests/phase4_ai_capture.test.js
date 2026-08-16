const assert = require('assert');
const fs = require('fs');
const path = require('path');

function parseTextRuleBased(text) {
  const clean = String(text || '').trim();

  // Code extraction
  const codeMatch = clean.match(/\b(code|use|promo|coupon)?\s*:?\s*([A-Z0-9]{4,15})\b/) ||
                    clean.match(/\b([A-Z0-9]{4,15})\b/);
  const code = codeMatch ? (codeMatch[2] || codeMatch[1]) : '';

  // Discount text
  const discountMatch = clean.match(/(₹|rs\.?|\$)\s*\d+(\s*off|\s*cashback)?|\b\d+%\s*off/i);
  const discount_text = discountMatch ? discountMatch[0] : '';

  // Min order value
  const minMatch = clean.match(/(min\.?|minimum)\s*(order|purchase|spend)?\s*:?\s*(₹|rs\.?|\$)?\s*(\d+)/i);
  const min_order_value = minMatch ? parseInt(minMatch[4], 10) : null;

  // Expiry date YYYY-MM-DD or DD/MM/YYYY
  const isoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const dmyMatch = !isoMatch && clean.match(/\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})\b/);

  let expiry_date = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  if (isoMatch) {
    expiry_date = isoMatch[0];
  } else if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    expiry_date = `${dmyMatch[3]}-${month}-${day}`;
  }

  // Brand heuristic (merchant the coupon is redeemed at)
  const brandMatch = clean.match(/\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)/i);
  const brand = brandMatch ? brandMatch[0] : 'Other';

  // Source app (where the SMS/notification came from), kept separate from brand
  const sourceMatch = clean.match(/\b(Cred|Paytm|PhonePe|GPay|Google Pay)\b/i);
  const source_app = sourceMatch ? sourceMatch[0] : 'SMS / Text';

  return {
    brand,
    code: code.toUpperCase(),
    discount_text: discount_text || 'Special Offer',
    min_order_value,
    category: 'Other',
    source_app,
    expiry_date,
    notes: clean.slice(0, 150)
  };
}

function runTests() {
  console.log("Running Phase 4 AI Capture tests...");

  // Test Sample 1: Cred SMS
  const sms1 = "Cred Alert: Use code SAVE500 on Amazon to get ₹500 off on min order ₹2000. Valid till 2026-08-25.";
  const res1 = parseTextRuleBased(sms1);

  assert.strictEqual(res1.brand.toLowerCase(), "amazon");
  assert.strictEqual(res1.code, "SAVE500");
  assert.strictEqual(res1.min_order_value, 2000);
  assert.strictEqual(res1.expiry_date, "2026-08-25");

  // Test Sample 2: Myntra Email
  const sms2 = "Exclusive Offer! Code MYNTRA50 gets you 50% off on your next purchase. Exp: 30/12/2026";
  const res2 = parseTextRuleBased(sms2);

  assert.strictEqual(res2.brand.toLowerCase(), "myntra");
  assert.strictEqual(res2.code, "MYNTRA50");
  assert.strictEqual(res2.discount_text.toLowerCase(), "50% off");
  assert.strictEqual(res2.expiry_date, "2026-12-30");

  // Verify Edge Function files exist
  const root = path.join(__dirname, '..');
  const parseFnPath = path.join(root, 'supabase', 'functions', 'parse-coupon', 'index.ts');
  assert(fs.existsSync(parseFnPath), "supabase/functions/parse-coupon/index.ts must exist");

  // Verify index.html UI integration
  const indexPath = path.join(root, 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  assert(indexContent.includes('id="aiBtn"'), "index.html must contain aiBtn button");
  assert(indexContent.includes('parseTextRuleBased'), "index.html must contain parseTextRuleBased");

  console.log("✅ All Phase 4 AI Capture tests passed!");
}

runTests();
