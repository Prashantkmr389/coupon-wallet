const assert = require('assert');

async function runTests() {
  console.log("Running Task 3.2 tests...");

  // Exercise the app's REAL ICS builder (shared/ics.mjs).
  const { buildICS, fold, byteLen, icsEscape } = await import('../shared/ics.mjs');

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

  const now = new Date("2026-08-15T12:00:00Z"); // deterministic DTSTAMP
  const icalStr = buildICS([coupon], now);

  // 1. VCALENDAR structure
  assert(icalStr.includes("BEGIN:VCALENDAR"), "Must contain BEGIN:VCALENDAR");
  assert(icalStr.includes("END:VCALENDAR"), "Must contain END:VCALENDAR");
  assert(icalStr.includes("BEGIN:VEVENT"), "Must contain BEGIN:VEVENT");
  assert(icalStr.includes("DTSTAMP:20260815T120000Z"), "DTSTAMP must come from the injected clock");

  // 2. Exactly 3 VALARM triggers with the right offsets
  const alarmCount = (icalStr.match(/BEGIN:VALARM/g) || []).length;
  assert.strictEqual(alarmCount, 3, "Must have exactly 3 VALARM blocks");
  assert(icalStr.includes("TRIGGER:-P7D"), "Must contain -P7D alarm trigger");
  assert(icalStr.includes("TRIGGER:-P1D"), "Must contain -P1D alarm trigger");
  assert(icalStr.includes("TRIGGER:PT0S"), "Must contain PT0S alarm trigger");

  // 3. RFC 5545 folding: no physical line exceeds 75 octets (₹ is 3 bytes)
  const lines = icalStr.split(/\r?\n/);
  lines.forEach(l => {
    assert(Buffer.byteLength(l, 'utf8') <= 75, `Line length must be <= 75 octets: ${l}`);
  });

  // 4. Escaping: commas/semicolons/newlines in user text must not break structure
  const hostile = {
    id: "h1", brand: "A,B;C", code: "X1", expiry_date: "2026-09-01",
    notes: "line one\nline two"
  };
  const h = buildICS([hostile], now);
  assert(h.includes("A\\,B\\;C"), "commas and semicolons must be escaped");
  assert(h.includes("line one\\nline two"), "newlines must be escaped");
  assert.strictEqual((h.match(/BEGIN:VEVENT/g) || []).length, 1, "escaped newline must not split the event");

  // 5. fold() keeps emoji surrogate pairs intact across folds
  const emojiLine = "SUMMARY:" + "🎟".repeat(40); // 40 × 4-byte chars → forces folds
  const folded = fold(emojiLine).split("\r\n ");
  assert(folded.length > 1, "long emoji line must actually fold");
  folded.forEach(seg => {
    assert(!/[\uD800-\uDBFF]$/.test(seg), "folding must never split a surrogate pair mid-way");
    Buffer.from(seg, 'utf8'); // must remain valid UTF-8
  });
  assert.strictEqual(folded.join("").replace(/^SUMMARY:/, '').length, 80, "no characters lost in folding");

  console.log("✅ All Task 3.2 tests passed!");
}

runTests().catch(err => {
  console.error("❌ Task 3.2 tests failed:", err);
  process.exit(1);
});
