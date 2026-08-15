const assert = require('assert');

function byteLen(s) {
  return (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(s).length
                                            : Buffer.byteLength(s, 'utf8');
}

function fold(line) {
  if (byteLen(line) <= 75) return line;
  var out = '', cur = '', limit = 75, pieces = [];
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch.charCodeAt(0) >= 0xD800 && ch.charCodeAt(0) <= 0xDBFF && i + 1 < line.length) {
      ch += line[++i];
    }
    if (byteLen(cur + ch) > limit) {
      pieces.push(cur);
      cur = ch;
      limit = 74;
    } else cur += ch;
  }
  pieces.push(cur);
  out = pieces[0];
  for (var j = 1; j < pieces.length; j++) out += '\r\n ' + pieces[j];
  return out;
}

function vevent(c) {
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
    'DTSTAMP:20260815T120000Z',
    'DTSTART:' + d + 'T090000',
    'DTEND:' + d + 'T093000',
    fold('SUMMARY:' + summary),
    fold('DESCRIPTION:' + descParts.join('\n')),
    'TRANSP:TRANSPARENT'
  ];

  [['-P7D', '7 days left'], ['-P1D', 'Expires tomorrow'], ['PT0S', 'Expires today']].forEach(function(a) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY',
      fold('DESCRIPTION:' + c.brand + ' coupon ' + c.code + ' — ' + a[1]),
      'TRIGGER:' + a[0], 'END:VALARM');
  });
  lines.push('END:VEVENT');
  return lines;
}

function buildICS(coupons) {
  var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Coupon Wallet//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  coupons.forEach(function(c) { out = out.concat(vevent(c)); });
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

function runTests() {
  console.log("Running Task 3.2 tests...");

  const coupon = {
    id: "coupon-123",
    brand: "Amazon",
    code: "SAVE50",
    discount_text: "₹500 off on minimum purchase of ₹2000 for all electronics items",
    min_order_value: 2000,
    source_app: "Cred",
    expiry_date: "2026-08-25",
    notes: "Special monsoon offer code",
    redeem_url: "https://amazon.in/checkout"
  };

  const icalStr = buildICS([coupon]);

  // 1. Check VCALENDAR markers
  assert(icalStr.includes("BEGIN:VCALENDAR"), "Must contain BEGIN:VCALENDAR");
  assert(icalStr.includes("END:VCALENDAR"), "Must contain END:VCALENDAR");
  assert(icalStr.includes("BEGIN:VEVENT"), "Must contain BEGIN:VEVENT");

  // 2. Check 3 VALARM triggers
  const alarmCount = (icalStr.match(/BEGIN:VALARM/g) || []).length;
  assert.strictEqual(alarmCount, 3, "Must have exactly 3 VALARM blocks");
  assert(icalStr.includes("TRIGGER:-P7D"), "Must contain -P7D alarm trigger");
  assert(icalStr.includes("TRIGGER:-P1D"), "Must contain -P1D alarm trigger");
  assert(icalStr.includes("TRIGGER:PT0S"), "Must contain PT0S alarm trigger");

  // 3. Verify line byte length folding (no line exceeds 75 octets)
  const lines = icalStr.split(/\r?\n/);
  lines.forEach(l => {
    assert(Buffer.byteLength(l, 'utf8') <= 75, `Line length must be <= 75 octets: ${l}`);
  });

  console.log("✅ All Task 3.2 tests passed!");
}

runTests();
