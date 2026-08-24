/* Savings tracker math. "₹ saved" sums flat discount amounts over coupons
   actually marked used; percent-off offers contribute nothing because they
   can't become rupees without an order value. */

export function parseSavedAmount(text) {
  if (!text) return 0;
  var m = String(text).match(/(?:₹|rs\.?\s*|\$)\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return 0;
  var n = parseFloat(m[1].replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

export function totalSaved(coupons) {
  return coupons.reduce(function (sum, c) {
    return sum + (c.used ? parseSavedAmount(c.discount_text) : 0);
  }, 0);
}

export function fmtMoney(n) {
  return n.toLocaleString('en-IN');
}
