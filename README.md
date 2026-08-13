# Coupon Wallet — Phase 1

A local-first coupon organiser. No accounts, no server, no running cost.
Coupons live in IndexedDB on the device; reminders are delegated to your calendar.

Implements the decision recorded in `ADR-0001`.

---

## What's in Phase 1

| Feature | Notes |
|---|---|
| Manual coupon entry | brand, code, discount, **min order as a number**, category, source app, expiry, link, notes |
| Expiry triage on open | "Needs attention" section pinned above everything else |
| Status stamps | Active / Expiring soon / Expired / Used, computed live |
| Calendar reminders | `.ics` per coupon (or all at once) with alarms at **−7d, −1d, 9am on expiry day** |
| JSON export / import | Your backup **and** your manual phone↔laptop bridge |
| Duplicate detection | Warns on same code + same brand; second Save overrides |
| Reusable flag | Card benefits and recurring offers don't retire when marked used |
| Edit / mark used / un-use / delete with undo | |
| Installable PWA | Home screen icon, opens offline |
| Search + category filter | |

---

## Files

```
index.html              the entire app (UI + logic, no build step)
manifest.json           PWA metadata
sw.js                   service worker, app-shell caching only
icon-192.png            home screen icon
icon-512.png            splash / store icon
icon-maskable-512.png   Android adaptive icon
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

> Serve it over `http://localhost` or HTTPS — opening `index.html` as a `file://`
> URL will not register the service worker, so PWA install and offline won't work.

## Install to home screen

- **Android / Chrome** — visit the URL → menu → *Install app* / *Add to Home screen*
- **iOS / Safari** — visit the URL → Share → *Add to Home Screen*
  (Safari only; Chrome on iOS can't install PWAs)

---

## How reminders actually work

A web page can't schedule its own future notification — when the tab is closed,
nothing is running to fire it. So instead of pretending otherwise, each coupon
exports a calendar event carrying three `VALARM` triggers:

```
TRIGGER:-P7D    → 7 days before expiry
TRIGGER:-P1D    → the day before
TRIGGER:PT0S    → 9:00 AM on expiry day
```

Your calendar app is already installed, already synced across your phone and
laptop, and already has notification permission. It does the notifying.

**Known limitation:** these are fire-and-forget. If you change a coupon's expiry
date or delete it, previously exported alarms stay in your calendar. Re-export
after editing, and delete the calendar event if you delete the coupon. Acceptable
because coupon expiry dates, unlike meetings, essentially never move.

Events are marked `TRANSP:TRANSPARENT` so they don't show you as busy.

---

## Backup — read this bit

There is no server. **If you clear this browser's site data, the coupons are gone.**

Use *Export backup* periodically. The JSON file is also how you move coupons to
another device until Phase 2: export on the phone, import on the laptop. Import
skips anything already present (matched on brand + code), so re-importing an old
backup is safe.

---

## Phase 2 migration notes

The record shape deliberately mirrors the future Postgres schema, so migration is
a storage-layer swap rather than a rewrite:

```js
{
  id, brand, code, discount_text, min_order_value,   // number | null
  category, source_app, expiry_date,                 // 'YYYY-MM-DD'
  redeem_url, notes, reusable, used, used_at,
  created_at, updated_at                             // ISO strings
}
```

Only these four functions touch storage — replace their bodies with Supabase
calls and everything above them keeps working:

```
openDB()   dbAll()   dbPut(rec)   dbDelete(id)
```

Keep the JSON import path afterwards so Phase 1 data can be pulled into the
hosted version.

---

## Roadmap

- **Phase 2** — Supabase Postgres + magic-link auth, real cross-device sync
- **Phase 3** — scheduled weekly digest email of expiring coupons
- **Phase 4** — paste an SMS/email or screenshot, Claude extracts the fields
- **Phase 5** — Chrome extension badge when you visit a matching retailer
- **Phase 6** — shared household wallet, ₹-saved tracker, forwarding address

Per the ADR: **use it for two weeks before writing any Phase 2 code.**
