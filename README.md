# Coupon Wallet (Phases 1–4 + 6)

A local-first coupon organiser with optional cross-device cloud sync via Supabase, weekly email digest summaries, browser web push notifications, AI-assisted capture, and a shared household wallet with a ₹-saved tracker. No complex setup required.
Coupons live in IndexedDB on the device and sync seamlessly with your Supabase account when signed in; reminders are delegated to your calendar, weekly digest email, and browser push notifications.

Implements the specification and architecture recorded in `ADR-0001` and `2026-08-15-coupon-wallet-phases.md`.

---

## Features

| Feature | Notes |
|---|---|
| Manual coupon entry | brand, code, discount, **min order as a number**, category, source app, expiry, link, notes |
| Expiry triage on open | "Needs attention" section pinned above everything else |
| Status stamps | Active / Expiring soon / Expired / Used, computed live |
| Calendar reminders | `.ics` per coupon (or all at once) with alarms at **−7d, −1d, 9am on expiry day** |
| **Cloud Sync & Magic Link Auth (Phase 2)** | Sync coupons across phone and laptop via Supabase Postgres + passwordless magic-link sign in |
| **1-Click Local to Cloud Migration** | Automatically syncs local IndexedDB coupons to your cloud account upon sign-in |
| **Weekly Email Digest (Phase 3)** | Scheduled Supabase Edge Function sends a Monday 9am email summarizing coupons expiring within 7 days |
| **Browser Web Push Nudges (Phase 3)** | Receive native browser push notifications when coupons are due |
| **AI Coupon Capture (Phase 4)** | Paste an SMS/email → Edge Function (Claude) extracts fields and prefills the form; offline rule-based fallback |
| **Shared Household Wallet (Phase 6)** | Invite family by email; everyone sees the same coupons via RLS-filtered access |
| **₹-Saved Tracker (Phase 6)** | Running total of flat discounts across used coupons, shown in the stats line |
| **Coupon Forwarding Email (Phase 6)** | Mail sent to `wallet+<token>@your-domain.com` is parsed and added to the household wallet automatically |
| **Hybrid Storage Adapter** | Operates cloud-first when signed in, falling back gracefully to IndexedDB when offline/guest |
| JSON export / import | Backup and manual device transfer capability |
| Duplicate detection | Warns on same code + same brand; second Save overrides |
| Reusable flag | Card benefits and recurring offers don't retire when marked used |
| Edit / mark used / un-use / delete with undo | |
| Installable PWA | Home screen icon, opens offline |
| Search + category filter | |

---

## Repository Structure

```
index.html                              the entire app (UI, logic, Supabase hybrid adapter, Web Push UI, household wallet)
manifest.json                           PWA metadata
sw.js                                   service worker (app-shell caching, Web Push event handlers)
supabase/schema.sql                     Postgres schema (coupons, push_subscriptions, households + RLS)
supabase/functions/weekly-digest/      Supabase Edge Function for Monday 9am email digests
supabase/functions/parse-coupon/       Supabase Edge Function for AI coupon capture
supabase/functions/inbound-coupon/     Supabase Edge Function: forwarding-email webhook → parsed coupon
supabase/functions/household-invite/   Supabase Edge Function: invite emails via Resend
tests/                                  Automated test suites (13 test files)
icon-192.png                            home screen icon
icon-512.png                            splash / store icon
icon-maskable-512.png                   Android adaptive icon
```

---

## Supabase Database Setup (Phases 2, 3, 4 & 6)

To enable cloud sync, notifications and the household wallet:

1. Create a free project at [Supabase](https://supabase.com).
2. Open the SQL Editor in Supabase Dashboard and run the contents of [`supabase/schema.sql`](file:///Users/prashant/codebase/coupon-wallet/supabase/schema.sql).
3. Deploy the Edge Functions:
   ```bash
   supabase functions deploy weekly-digest
   supabase functions deploy parse-coupon      # set ANTHROPIC_API_KEY for AI extraction
   supabase functions deploy inbound-coupon    # set as your email provider's inbound webhook
   supabase functions deploy household-invite  # optional; needs RESEND_API_KEY to actually send
   ```
4. In the app, click **☁️ Sync (Sign In)** and enter your Supabase Project URL, Anon Key, and Email.
5. Click **🔔 Push Nudges** to enable browser push notifications!
6. Click **👨‍👩‍👧 Household** to create a shared wallet and invite family members — invites are claimed automatically when the invitee signs in with the invited address.

### Forwarding email setup

Point your email provider's inbound-parse webhook at the `inbound-coupon` function and route mail for `wallet+<token>@your-domain.com` to it. Each household's exact forwarding address is shown inside the **👨‍👩‍👧 Household** modal. Works with any provider that POSTs JSON (`to`, `text`/`html`): SendGrid Inbound Parse, Mailgun Routes, Cloudflare Email Workers.

---

## Testing

Run all unit and integration test suites:

```bash
npm test
```

---

## Deploy

The app is static — any static host works. Two easy options:

**Netlify Drop (fastest)**
1. Go to <https://app.netlify.com/drop>
2. Drag the whole `coupon-wallet` folder in (the folder, not the individual files)
3. You get a live HTTPS URL immediately

**Vercel**
```bash
npm i -g vercel
cd coupon-wallet
vercel
```

**Local test**
```bash
cd coupon-wallet
python3 -m http.server 8000
# open http://localhost:8000
```

---

## Roadmap

- [x] **Phase 1** — Local-First PWA, IndexedDB, calendar reminders, JSON backup
- [x] **Phase 2** — Supabase Postgres + magic-link auth, hybrid cross-device sync
- [x] **Phase 3** — scheduled weekly digest email of expiring coupons & Web Push notifications
- [x] **Phase 4** — paste an SMS/email or screenshot, Claude extracts the fields
- [ ] **Phase 5** — Chrome extension badge when you visit a matching retailer
- [x] **Phase 6** — shared household wallet, ₹-saved tracker, forwarding address


