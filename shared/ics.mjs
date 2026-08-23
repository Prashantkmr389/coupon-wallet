/* ICS (RFC 5545) calendar export. Three VALARM triggers per coupon:
   −7 days, −1 day, and 09:00 on expiry day. */

export function icsEscape(t) {
  return String(t == null ? '' : t)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 limits lines to 75 OCTETS, not characters — '₹' is three bytes
// in UTF-8, so folding by string length overflows and some calendar apps
// reject the whole file. Count bytes, never split multi-byte characters.
export function byteLen(s) {
  return (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(s).length
                                              : unescape(encodeURIComponent(s)).length;
}

export function fold(line) {
  if (byteLen(line) <= 75) return line;
  var out = '', cur = '', limit = 75, pieces = [];
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    // Keep surrogate pairs (emoji) intact.
    if (ch.charCodeAt(0) >= 0xD800 && ch.charCodeAt(0) <= 0xDBFF && i + 1 < line.length) {
      ch += line[++i];
    }
    if (byteLen(cur + ch) > limit) {
      pieces.push(cur); cur = ch; limit = 74; // continuation lines lose 1 octet to the leading space
    } else cur += ch;
  }
  pieces.push(cur);
  out = pieces[0];
  for (var j = 1; j < pieces.length; j++) out += '\r\n ' + pieces[j];
  return out;
}

export function icsStamp(now) {
  return (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function vevent(c, now) {
  var d = String(c.expiry_date).replace(/-/g, '');
  var summary = 'Coupon expires: ' + c.brand + ' (' + c.code + ')';
  var descParts = [];
  if (c.discount_text) descParts.push(c.discount_text);
  if (c.min_order_value) descParts.push('Min order: Rs ' + c.min_order_value);
  descParts.push('Code: ' + c.code);
  if (c.source_app) descParts.push('From: ' + c.source_app);
  if (c.notes) descParts.push(c.notes);
  if (c.redeem_url) descParts.push(c.redeem_url);

  var lines = [
    'BEGIN:VEVENT',
    'UID:' + c.id + '@coupon-wallet',
    'DTSTAMP:' + icsStamp(now),
    // Floating local time — no timezone conversion surprises.
    'DTSTART:' + d + 'T090000',
    'DTEND:' + d + 'T093000',
    fold('SUMMARY:' + icsEscape(summary)),
    fold('DESCRIPTION:' + icsEscape(descParts.join('\n'))),
    'TRANSP:TRANSPARENT'
  ];
  if (c.redeem_url) lines.push(fold('URL:' + icsEscape(c.redeem_url)));

  [['-P7D', '7 days left'], ['-P1D', 'Expires tomorrow'], ['PT0S', 'Expires today']].forEach(function (a) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
      fold('DESCRIPTION:' + icsEscape(c.brand + ' coupon ' + c.code + ' — ' + a[1])),
      'TRIGGER:' + a[0], 'END:VALARM');
  });
  lines.push('END:VEVENT');
  return lines;
}

export function buildICS(coupons, now) {
  var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Coupon Wallet//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  coupons.forEach(function (c) { out = out.concat(vevent(c, now)); });
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}
