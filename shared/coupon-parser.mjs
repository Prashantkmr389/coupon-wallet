/* Rule-based coupon extraction from raw SMS/email text. Single source of
   truth shared by the web app (offline AI-capture fallback), the
   parse-coupon and inbound-coupon Edge Functions, and the tests. */

export function parseTextRuleBased(text) {
  var clean = String(text || '').trim();

  // Code extraction (uppercase alphanumeric 4-15 chars)
  var codeMatch = clean.match(/\b(code|use|promo|coupon)?\s*:?\s*([A-Z0-9]{4,15})\b/) ||
                  clean.match(/\b([A-Z0-9]{4,15})\b/);
  var code = codeMatch ? (codeMatch[2] || codeMatch[1]) : '';

  // Discount text (e.g. ₹500 off, 50% OFF, Rs 200 Cashback)
  var discountMatch = clean.match(/(₹|rs\.?|\$)\s*\d+(\s*off|\s*cashback)?|\b\d+%\s*off/i);
  var discount_text = discountMatch ? discountMatch[0] : '';

  // Min order value
  var minMatch = clean.match(/(min\.?|minimum)\s*(order|purchase|spend)?\s*:?\s*(₹|rs\.?|\$)?\s*(\d+)/i);
  var min_order_value = minMatch ? parseInt(minMatch[4], 10) : null;

  // Expiry: YYYY-MM-DD preferred, DD/MM/YYYY fallback, else +14 days
  var isoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  var dmyMatch = !isoMatch && clean.match(/\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})\b/);

  var expiry_date = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  if (isoMatch) {
    expiry_date = isoMatch[0];
  } else if (dmyMatch) {
    var day = dmyMatch[1].padStart(2, '0');
    var month = dmyMatch[2].padStart(2, '0');
    expiry_date = dmyMatch[3] + '-' + month + '-' + day;
  }

  // Brand heuristic (merchant the coupon is redeemed at)
  var brandMatch = clean.match(/\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)/i);
  var brand = brandMatch ? brandMatch[0] : 'Other';

  // Source app (where the SMS/notification came from), kept separate from brand
  var sourceMatch = clean.match(/\b(Cred|Paytm|PhonePe|GPay|Google Pay)\b/i);
  var source_app = sourceMatch ? sourceMatch[0] : 'SMS / Text';

  return {
    brand: brand,
    code: code.toUpperCase(),
    discount_text: discount_text || 'Special Offer',
    min_order_value: min_order_value,
    category: 'Other',
    source_app: source_app,
    expiry_date: expiry_date,
    notes: clean.slice(0, 150)
  };
}
