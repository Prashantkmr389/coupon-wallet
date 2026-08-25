/* Capture heuristics (Phase 7): deciding whether clipboard text looks like
   a coupon, and combining Web Share Target params into one text blob for
   the parser. Pure functions — no DOM, no network — so tests run them as
   shipped code, same as the other shared modules. */

/* Deliberate decision: a code-like token alone is NOT enough. Bare order
   IDs and reference numbers ("Your order ID XB12KD99 has shipped") are
   uppercase tokens too, so we require a supporting signal — an amount,
   a coupon keyword, a date, or a known brand — before offering capture.
   A bare code can never false-positive on this heuristic, which is also
   why app-copied codes don't need persisted suppression state. */
export function looksLikeCouponText(text) {
  var clean = String(text == null ? '' : text).trim();
  if (!clean || clean.length > 2000) return false;
  if (!/\b[A-Z0-9]{4,15}\b/.test(clean)) return false;
  return /(?:₹|rs\.?|\$)\s*\d+|\b\d+%\s*off/i.test(clean)
    || /\b(coupon|promo|code|offer|cashback|deal)\b/i.test(clean)
    || /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{4}\b/.test(clean)
    || /\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)\b/i.test(clean);
}

/* Merge share_target's title/text/url params into one parser-ready string.
   Android apps commonly put the link in both text and url — keep one copy.
   Capped at 2000 chars purely to bound regex work downstream (the parser
   truncates notes to 150 anyway). Returns '' when there is nothing. */
export function combineShareParams(parts) {
  parts = parts || {};
  var title = String(parts.title == null ? '' : parts.title).trim();
  var text = String(parts.text == null ? '' : parts.text).trim();
  var url = String(parts.url == null ? '' : parts.url).trim();
  if (url && text.indexOf(url) !== -1) url = '';
  var out = [title, text, url].filter(Boolean).join('\n');
  return out.length > 2000 ? out.slice(0, 2000) : out;
}
