# Coupon Wallet (Phase 1 & Phase 2)

A local-first coupon organiser with optional cross-device cloud sync via Supabase. No complex setup required.
Coupons live in IndexedDB on the device and sync seamlessly with your Supabase account when signed in; reminders are delegated to your calendar.

Implements the specification and architecture recorded in `ADR-0001` and `2026-08-15-coupon-wallet-phases.md`.

---

## Features (Phase 1 & Phase 2)

| Feature | Notes |
|---|---|
| Manual coupon entry | brand, code, discount, **min order as a number**, category, source app, expiry, link, notes |
| Expiry triage on open | "Needs attention" section pinned above everything else |
| Status stamps | Active / Expiring soon / Expired / Used, computed live |
| Calendar reminders | `.ics` per coupon (or all at once) with alarms at **−7d, −1d, 9am on expiry day** |
| **Cloud Sync & Magic Link Auth (Phase 2)** | Sync coupons across phone and laptop via Supabase Postgres + passwordless magic-link sign in |
| **1-Click Local to Cloud Migration** | Automatically syncs local IndexedDB coupons to your cloud account upon sign-in |
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
index.html              the entire app (UI, logic, Supabase hybrid adapter)
manifest.json           PWA metadata
sw.js                   service worker, app-shell caching
supabase/schema.sql     Postgres database schema + Row Level Security (RLS) policies
tests/                  Automated test suites (10/10 test files)
icon-192.png            home screen icon
icon-512.png            splash / store icon
icon-maskable-512.png   Android adaptive icon
```

---

## Supabase Database Setup (Phase 2)

To enable cloud sync:

1. Create a free project at [Supabase](https://supabase.com).
2. Open the SQL Editor in Supabase Dashboard and run the contents of [`supabase/schema.sql`](file:///Users/prashant/codebase/coupon-wallet/supabase/schema.sql).
3. In the app, click **☁️ Sync (Sign In)** and enter your Supabase Project URL, Anon Key, and Email.
4. Click the Magic Link sent to your email to complete authentication!

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
- [ ] **Phase 3** — scheduled weekly digest email of expiring coupons
- [ ] **Phase 4** — paste an SMS/email or screenshot, Claude extracts the fields
- [ ] **Phase 5** — Chrome extension badge when you visit a matching retailer
- [ ] **Phase 6** — shared household wallet, ₹-saved tracker, forwarding address

