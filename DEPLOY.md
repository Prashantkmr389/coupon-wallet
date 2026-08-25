# Deploying Coupon Wallet

End-to-end guide: static hosting, Supabase backend, all Edge Functions, secrets, and per-feature verification.

## Architecture

```
Browser ──► static host (index.html, sw.js, manifest, icons, shared/*.mjs)
   │
   ├─► IndexedDB            local-first storage, always written first or mirrored
   │
   └─► Supabase
        ├─ Postgres         coupons · push_subscriptions · households · household_members (all RLS)
        └─ Edge Functions
             weekly-digest        cron Mon 9am  → Resend email digest
             send-push-nudges     cron daily 9am → VAPID Web Push (expires tomorrow)
             parse-coupon         on demand     → AI/rule-based SMS→coupon extraction
             inbound-coupon       email webhook → forwarding-address capture
             household-invite     on demand     → Resend invite mail (optional)
```

## Prerequisites

- Node ≥ 18 (for the VAPID key script and tests)
- A [Supabase](https://supabase.com) project (free tier is fine)
- [Supabase CLI](https://supabase.com/docs/guides/cli): `brew install supabase/tap/supabase`
- A static host — Netlify Drop works; any host serving `.mjs` as `text/javascript` does

---

## 1. Database

Supabase Dashboard → SQL Editor → paste and run **all** of [`supabase/schema.sql`](supabase/schema.sql).

The file is idempotent (`IF NOT EXISTS` throughout); re-running after upgrades is safe and is how you apply new migrations.

> Upgrading from Phase ≤ 6? Re-run the whole file to pick up the Phase 7 `archived` / `archived_at` columns on `coupons`. No RLS changes — archived rows are the same rows.

Creates: `coupons`, `push_subscriptions`, `households`, `household_members`, indexes, and every RLS policy.

## 2. Auth

Dashboard → Authentication → URL Configuration:

- **Site URL**: your deployed app URL (e.g. `https://coupoun.netlify.app`)
- Magic-link emails redirect here; add `http://localhost:8000` as a Redirect URL for local dev.

## 3. Secrets

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

| Secret | Used by | Required | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | weekly-digest, household-invite | for email | [resend.com](https://resend.com), free tier |
| `VAPID_PUBLIC_KEY` | send-push-nudges | for push | safe to expose via GET |
| `VAPID_PRIVATE_KEY` | send-push-nudges | for push | never in client code |
| `PUSH_SUBJECT` | send-push-nudges | recommended | `mailto:you@example.com` |
| `ANTHROPIC_API_KEY` | parse-coupon | optional | without it the rule-based parser answers |

Generate the VAPID pair (once per environment):

```bash
node scripts/generate-vapid-keys.mjs
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  PUSH_SUBJECT=mailto:you@example.com \
  RESEND_API_KEY=<key> \
  ANTHROPIC_API_KEY=<key>
```

## 4. Edge Functions

```bash
supabase functions deploy weekly-digest      # config.json sets cron "0 9 * * 1"
supabase functions deploy send-push-nudges   # config.json sets cron "0 9 * * *"
supabase functions deploy parse-coupon
supabase functions deploy inbound-coupon
supabase functions deploy household-invite   # optional
```

Crons are read from each function's `config.json` at deploy time.

> Phase 7: redeploy **weekly-digest** and **send-push-nudges** after upgrading — both now exclude archived coupons from digests and nudges.

> `parse-coupon` and `inbound-coupon` import the shared parser from
> `../../../shared/coupon-parser.mjs`. The Supabase CLI bundles relative imports
> outside the function directory. If your CLI version refuses, copy the file to
> `supabase/functions/_shared/` and adjust both imports — then diff it against
> `shared/coupon-parser.mjs` when upgrading.

## 5. Static hosting

**Netlify Drop** — drag the repo folder onto <https://app.netlify.com/drop>. Done.

**Any host** — serve the folder as-is; there is no build step. Requirement: `.mjs` must be served as `text/javascript` (Netlify, Vercel, Cloudflare Pages and Python ≥3.8's http.server all do).

## 6. Inbound coupon email (optional)

Wire your email provider's inbound-parse feature at the deployed `inbound-coupon` function URL:

```
POST https://<project>.supabase.co/functions/v1/inbound-coupon
```

Accepts JSON `{ to, text?, html? }` (SendGrid Inbound Parse, Mailgun Routes, Cloudflare Email Workers). Address format: `wallet+<inbound_token>@your-domain.com` — each household's token is shown in the 👨‍👩‍👧 Household modal. Test manually:

```bash
curl -X POST <function-url> -H 'Content-Type: application/json' \
  -d '{"to":"wallet+abc12345@your-domain.com","text":"Amazon: code FLICK15 for ₹150 off, min order ₹999, valid till 2026-12-01"}'
```

---

## Verification checklist

Run through after every fresh deploy:

| # | Feature | How to verify |
|---|---|---|
| 1 | App loads offline-capable | Open the site, DevTools → Application → Service Worker registered; reload while "Offline" — still renders |
| 2 | Manual entry + expiry triage | Add a coupon expiring in 3 days → appears under "Needs attention" with an "Expiring soon" stamp |
| 3 | Calendar export | Ticket 📅 button downloads `.ics`; open it — 3 alarms at −7d, −1d, day-of 9am |
| 4 | Magic-link sign-in | ☁️ button → enter email → link arrives → signed-in state shows your address |
| 5 | Cloud sync + migration | Coupons entered before sign-in appear in Supabase (`coupons` table) after magic link |
| 6 | Weekly digest | Insert a test coupon expiring within 7 days, then `curl -X POST --no-buffer <weekly-digest-url>` → email arrives |
| 7 | Push nudges | 🔔 button → permission granted → row appears in `push_subscriptions`. Seed a coupon expiring tomorrow, then `curl -X POST <send-push-nudges-url>` → notification: "🎟 1 coupon expires tomorrow!" |
| 8 | AI capture | ✨ AI Capture → paste the sample SMS from the placeholder → fields prefill |
| 9 | Forwarding email | curl example above → coupon lands in the wallet tagged source "Email" |
| 10 | Household | Create household → invite second email → sign in on another profile with that email → invite auto-claims; mark a used coupon with attribution → "by NAME" badge + ₹-saved stat updates |
| 11 | Extension | Load `extension/` unpacked → Settings → Connect (wallet tab open & signed in) → open amazon.in/makemytrip.com → toolbar badge shows count |
| 12 | Archive | Delete a used coupon → ₹-saved unchanged, coupon gone from the list but shown under 🗃 Archive (N); Restore brings it back; Delete forever really removes it |
| 13 | Clipboard quick-add | Copy a coupon SMS in another app (grant clipboard permission when asked) → open the wallet → toast offers "Prefill form"; copying a code from inside the app must NOT trigger it on next open |
| 14 | Share target | Install the PWA on Android/Chrome → share an SMS from Messages → Coupon Wallet opens with the form prefilled and the shared URL scrubbed. iOS Safari has no `share_target` — clipboard quick-add is the fallback there |

Function URLs for curl: Supabase Dashboard → Edge Functions → each function's detail page.

## Local development

```bash
python3 -m http.server 8000    # or: npx serve .
# open http://localhost:8000
npm test                       # 16 suites, no network needed
```

The extension connects to `http://localhost:8000` out of the box (see `extension/options.js`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console: *Failed to load module script: MIME type* | Host serves `.mjs` as octet-stream | Use a host that maps `.mjs` correctly (see §5); locally use Python ≥3.8 or `npx serve` |
| Push subscribes but nothing ever arrives | VAPID keys mismatched or missing | Re-run `scripts/generate-vapid-keys.mjs`, set secrets, redeploy function, click 🔔 again to resubscribe |
| Push notification says only generic text | Local wallet mirror empty (never opened the app on that device/browser) | Open the app once so IndexedDB mirrors cloud coupons |
| Magic link logs into wrong/no place | Site URL misconfigured | Fix §2; links already sent keep old target |
| RLS violation on save | Not signed in but Supabase client configured | Sign in first — writes need `auth.uid()`; guests stay local-only |
| `coupons.user_id` FK error from inbound-coupon | Household lookup failed | Check the `wallet+<token>` address matches `households.inbound_token` exactly |
| Digest/push cron silent | Function env secrets unset | `supabase secrets list`; redeploy after setting |
| Extension badge never appears | Session expired | Extension Settings → Connect again (one click) |
