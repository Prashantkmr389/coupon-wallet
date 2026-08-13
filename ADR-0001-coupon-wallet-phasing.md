# ADR-0001: Ship Coupon Wallet as a local-first PWA, defer the backend

**Status:** Proposed
**Date:** 2026-08-11
**Deciders:** Prashant

---

## Context

Coupon Wallet solves a personal pain point: coupons from Cred, GPay, PhonePe, Paytm, Myntra and Flipkart expire unused because they're scattered and forgotten at the moment they'd actually be useful.

The decision on the table is to **ship Phase 1 with no database and no accounts** — manual entry only (code, expiry, site name, category) — plus expiry reminders at **7 days out, 1 day out, and on the day of expiry**.

Forces at play:

- **Speed of shipping wins over completeness.** A working thing in use this week beats a well-architected thing in three weeks. Real usage will tell us which of Phases 2–5 are worth building at all.
- **Two constraints in this phase are in direct tension.** "No backend" and "reminders that reach me when the app is closed" cannot both be fully satisfied by a web app. This ADR's main job is to resolve that.
- **Cross-device access was previously identified as a requirement** (phone + laptop). Phase 1 knowingly defers it; §Consequences covers the bridge.
- **Solo developer, personal-scale data.** Realistically <500 coupons ever. Scalability is a non-issue; maintenance burden and cost-to-run are the real non-functional requirements.

---

## Decision

Ship **Phase 1 as a local-first installable PWA** with IndexedDB storage, no accounts, no server.

Deliver the reminder requirement through a **two-channel approach**:

1. **In-app triage on open** — expiring coupons surface at the top with a stamped status, so opening the app is always immediately useful.
2. **Calendar-delegated alerts** — each coupon can emit an `.ics` calendar event with three `VALARM` triggers (−7d, −1d, 09:00 on expiry day). The user's existing calendar app — already installed, already trusted with notifications, already synced across their phone and laptop — does the actual notifying.

Push notifications and email digests are explicitly **deferred to Phase 3**, where a server exists to send them.

---

## Options Considered

### Option A: Local-first PWA, calendar-delegated reminders *(recommended)*

| Dimension | Assessment |
|-----------|------------|
| Complexity | **Low** — static file, no auth, no server, no migrations |
| Cost | **₹0** — static hosting free tier, forever |
| Scalability | Irrelevant at this scale; IndexedDB handles thousands of records comfortably |
| Team familiarity | High — it's the prototype you already have, plus one export function |
| Time to ship | **Days** |

**Pros:**
- Ships almost immediately; the existing prototype is ~80% of it
- Zero running cost and zero ops surface — nothing to patch, no keys to rotate, no bills
- Works offline by construction
- Reminders genuinely fire when the app is closed, on both devices, with no push infrastructure
- No privacy surface — coupon codes never leave the device

**Cons:**
- Reminders are **fire-and-forget**: editing a coupon's expiry later doesn't update an already-exported calendar event
- Data is trapped per-device; clearing browser storage loses everything without a manual export
- No cross-device sync (deferred, not solved)

### Option B: Local-first PWA, Web Push for reminders

| Dimension | Assessment |
|-----------|------------|
| Complexity | **High** — service worker, VAPID keys, push subscription storage |
| Cost | Needs a server to hold subscriptions and send at the right time — so it isn't really "no backend" |
| Scalability | Fine |
| Team familiarity | Low — push is fiddly to debug |
| Time to ship | Weeks |

**Pros:** Native-feeling notifications; alerts stay correct if a coupon is edited.

**Cons:**
- **This does not actually meet the "no backend" constraint.** Something must be awake on the expiry date to send the push; a closed browser tab can't schedule its own future notification.
- The browser API that would have allowed purely local scheduling (Notification Triggers / `TimestampTrigger`) never shipped broadly and can't be relied on.
- iOS only supports Web Push for PWAs installed to the home screen, and permission prompts are easy to lose.

### Option C: Skip Phase 1, go straight to Supabase + email digests

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Free tier, but a real account and real ops |
| Scalability | Excellent, and unnecessary |
| Team familiarity | Medium |
| Time to ship | 1–2 weeks |

**Pros:** Solves sync and reminders properly in one shot; no throwaway work.

**Cons:** Delays getting the thing into daily use, which is the only way to learn whether the later phases are worth building. Builds infrastructure for a usage pattern that hasn't been validated yet.

---

## Trade-off Analysis

The core trade-off is **correctness of reminders vs. time-to-first-use.**

Option B is the "right" answer on paper and fails on its own premise — it smuggles a backend in through the notification requirement. Once you accept a server for push, Option C is strictly better, because a server that can send push can also sync your data and email you a weekly digest for the same effort.

So the real choice is **A vs. C**, and it reduces to: *is the reminder allowed to be slightly stale?*

Option A's staleness is narrow and tolerable in practice. Coupon expiry dates are **immutable** once issued — unlike a meeting, a coupon's date doesn't get moved. The stale-alert case is limited to deleting or redeeming a coupon early, where the worst outcome is one unnecessary calendar ping that takes two seconds to dismiss. That's a small price for cutting the entire auth-plus-database-plus-scheduler surface out of v1.

Option A also quietly buys something Option C doesn't: reminders land in the place the user already looks. A calendar alert at 9am competes for attention far better than an email digest buried in a promotions tab — which is ironically where the original coupons went to die.

The genuine cost of Option A is the throwaway work. Realistically that's the storage layer only (~40 lines swapped from IndexedDB calls to Supabase calls) — the UI, data shape, and expiry logic all carry forward unchanged. That's an acceptable write-off for shipping a week earlier.

---

## Consequences

**What becomes easier:**
- Shipping today — deploy a single static file and it's done
- Iterating on the UI without worrying about migrations or breaking live data
- Reasoning about privacy: nothing leaves the device

**What becomes harder:**
- Cross-device use. **Mitigation:** ship JSON export/import in Phase 1 as both the backup mechanism and the manual sync bridge. Non-negotiable — without it, one cleared cache wipes everything.
- Editing a coupon after exporting its calendar event; the old alerts persist.
- AI-assisted parsing (Phase 2) stays blocked — it needs a secret API key, which can't live in client-side JS.

**What we'll need to revisit:**
- When cross-device friction gets annoying, Phase 2 (Supabase) is triggered. Design the Phase 1 data model to match the eventual Postgres schema exactly so the migration is a storage-layer swap, not a rewrite.
- Whether calendar-delegated reminders are actually good enough. If they get ignored or feel clumsy, promote email digests up the roadmap.

---

## Revised Phase Plan

### Phase 1 — Local-first PWA *(ship this week)*
- IndexedDB storage; manual coupon entry (brand, code, discount, category, source app, expiry, notes)
- Installable PWA (`manifest.json` + service worker) so it lives on the home screen and opens offline
- In-app expiry triage: "expiring soon" pinned to the top on open
- **Add to calendar** per coupon — `.ics` with alarms at −7d, −1d, and expiry day
- **JSON export / import** — backup and manual device-to-device transfer
- Data model matches the future Postgres schema field-for-field

### Phase 2 — Real sync *(when device friction bites)*
- Supabase Postgres + magic-link auth + row-level security
- Swap the storage layer; UI unchanged
- Import path for the Phase 1 JSON export so nothing is lost

### Phase 3 — Reminders that don't depend on the calendar
- Scheduled Edge Function → weekly digest email of coupons expiring in 7 days
- Optional Web Push for same-day nudges

### Phase 4 — Capture without typing
- Paste an SMS/email → Edge Function calls the Claude API → returns `{brand, code, discount, expiry}` as JSON → prefills the form for confirmation
- Same flow for screenshots (Claude reads the image directly; no separate OCR service)

### Phase 5 — Surface at the moment of purchase
- Chrome extension: reads the active tab's domain, matches unused/unexpired coupons, shows a badge — "🎟 2 coupons for MakeMyTrip". A nudge, not autofill.

### Phase 6 — Only if it's still in daily use
- Shared household wallet
- "₹ saved" running total, incremented on mark-as-used
- Dedicated forwarding email address that auto-parses inbound coupon mail

---

## Suggested Additions Worth Considering

Ranked by value-per-hour of build effort:

1. **Duplicate detection on add** — same code + same brand already stored → warn. Cheap; prevents wallet clutter from re-adding the same offer.
2. **Minimum order value as a real number, not free text** — enables "show me coupons that apply to a ₹4,000 booking", which is the actual question at checkout. Small schema change now, expensive to retrofit later.
3. **"Expiring soon" as the default view** rather than a filter — the app should open on the thing that needs action.
4. **Recurring/reusable flag** — some offers (card benefits, "10% off every Tuesday") aren't consumed on use. Marking one as used shouldn't retire it.
5. **Quick-add from clipboard** — on app open, if the clipboard looks like a coupon code, offer to prefill. Approximates Phase 4's convenience with zero AI.
6. **Archive instead of hard delete** — expired coupons move out of view but stay queryable, which is what makes a future savings tracker possible.
7. **Per-coupon "where to use it" URL** — one tap from the wallet to the checkout page it applies to.

---

## Action Items

1. [ ] Lock the Phase 1 data model against the eventual Postgres schema (field names, types, nullability)
2. [ ] Swap prototype storage from the current key-value calls to IndexedDB
3. [ ] Build `.ics` export with three `VALARM` triggers per coupon
4. [ ] Build JSON export/import
5. [ ] Add `manifest.json` + service worker; verify install-to-home-screen on Android and iOS
6. [ ] Deploy to Netlify/Vercel static hosting
7. [ ] **Use it for two weeks before writing any Phase 2 code**
8. [ ] Revisit this ADR after those two weeks — record whether calendar reminders worked, and whether sync friction actually materialised
