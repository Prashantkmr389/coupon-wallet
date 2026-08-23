/* Expiry triage math. All day arithmetic is UTC-safe so the app, service
   worker, and tests agree regardless of local timezone.
   `now` is injectable for deterministic tests; production callers omit it. */

export function daysUntil(dateStr, now) {
  var p = String(dateStr).split('-').map(Number);
  // Garbage/missing dates get a sentinel rather than NaN so status math
  // stays boolean-clean: such coupons triage as expired ("needs attention")
  // and the label reads 'No valid expiry' instead of leaking the number.
  if (!p[0]) return -9999;
  var exp = Date.UTC(p[0], p[1] - 1, p[2]);
  var n = now || new Date();
  var today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((exp - today) / 86400000);
}

export function getExpireStatus(c, now) {
  if (c.used && !c.reusable) return { status: 'used', daysUntilExpiry: -1 };
  var d = daysUntil(c.expiry_date, now);
  if (d < 0) return { status: 'expired', daysUntilExpiry: d };
  if (d === 0) return { status: 'expires-today', daysUntilExpiry: 0 };
  if (d <= 7) return { status: 'expiring-soon', daysUntilExpiry: d };
  return { status: 'active', daysUntilExpiry: d };
}

// Coarse status used for stamp styling and grouping.
export function statusOf(c, now) {
  var res = getExpireStatus(c, now);
  if (res.status === 'expiring-soon' || res.status === 'expires-today') return 'soon';
  return res.status;
}

export function stampFor(s) {
  return { active: 'Active', soon: 'Expiring soon', expired: 'Expired', used: 'Used' }[s];
}

export function daysLabel(c, now) {
  if (c.used && !c.reusable) return 'Marked used';
  var d = daysUntil(c.expiry_date, now);
  if (d === -9999) return 'No valid expiry';
  if (d < 0) return 'Expired ' + Math.abs(d) + 'd ago';
  if (d === 0) return 'Expires today';
  if (d === 1) return '1 day left';
  return d + ' days left';
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(dateStr) {
  var p = String(dateStr).split('-').map(Number);
  return p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
}
