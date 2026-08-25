# Phase 7 Design: Capture Everywhere + Durable Data

**Status:** Ready for implementation
**Date:** 2026-08-24
**Implements:** ADR-0001 "Suggested Additions" #5 (clipboard quick-add) and #6 (archive instead of hard delete), plus Web Share Target capture.
**Audience:** The agent implementing this phase. Every integration point below references the real code as of `main@628468a`.

---

## 1. Scope

| Feature | ADR ref | What it does |
|---|---|---|
| **7A. Archive instead of hard delete** | Addition #6 | Delete button archives; archived coupons hidden everywhere but stay queryable; ₹-saved survives archiving; archive view with restore / delete-forever |
| **7B. Clipboard quick-add** | Addition #5 | On app open, if the clipboard looks like a coupon, offer a one-tap prefilled add form |
| **7C. Web Share Target** | new | Share an SMS/notification straight into the installed PWA; lands in the same prefill flow as AI Capture |

**Non-goals (explicitly out of scope):** iOS share target (Safari doesn't support `share_target` — clipboard quick-add is the iOS fallback), permanent-delete retention policies, updating already-exported calendar events when archiving (fire-and-forget per ADR), any backend for 7B/7C (both are client-side, offline-capable).

**Bug to fix along the way (pre-existing, blocks 7B/7C):** see §6 — the prefill path writes the literal string `"undefined"` into the hidden id field when the source object has no `id`. AI Capture already hits this; two more prefill entry points make fixing it mandatory.

---

## 2. Architecture

One new shared module, following the established pattern (no build step, imported by `index.html` as `type=module`, imported by tests via dynamic import):

```
shared/capture.mjs   — clipboard heuristic + share-payload parsing (pure, testable)
```

Everything else is wiring in existing files:

| File | Change |
|---|---|
| `shared/capture.mjs` | **new** — `looksLikeCouponText(text)`, `combineShareParams({title,text,url})` |
| `index.html` | archive flag in CRUD + rendering, archive view, clipboard prompt on init, share-target handling on init, prefill-id fix |
| `supabase/schema.sql` | two idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (Phase 6 pattern) |
| `supabase/functions/weekly-digest/index.ts` | exclude archived rows |
| `supabase/functions/send-push-nudges/index.ts` | exclude archived rows |
| `extension/background.js` | exclude archived coupons from the badge/sync |
| `manifest.json` | add `share_target` block |
| `sw.js` | bump `CACHE` to `coupon-wallet-v3`, add `./shared/capture.mjs` to `SHELL` |
| `tests/phase7_capture_archive.test.js` | **new** suite; register in `package.json` `test` script |
| `README.md`, `DEPLOY.md` | structure line + 3 verification-checklist rows |

RLS: **no policy changes** — archived rows are the same rows; all existing policies apply unchanged.

---

## 3. Feature 7A — Archive instead of hard delete

### 3.1 Data model

Add two fields to coupons:

```js
archived:    boolean, default false   // IndexedDB: absent on old records → falsy → fine, no migration
archived_at: ISO string | null
```

`supabase/schema.sql` (append at the end, matching the Phase 6 idempotent-ALTER style so re-running the file applies it):

```sql
-- Phase 7: archive instead of hard delete
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
```

### 3.2 Behavior rules

1. **Delete button archives.** In the `listEl` click handler (`index.html:982`, `action==='delete'`): replace the `dbDelete` call with setting `c.archived=true; c.archived_at=new Date().toISOString();` + `dbPut(c)`. Keep the existing Undo toast (5s) — Undo now just clears the flag (`archived=false, archived_at=null` + `dbPut`). Simpler than today's splice-and-reinsert.
2. **Archived rows stay in `state.coupons`** (durability is the point) but are excluded from every default surface by a single gate:

   ```js
   function liveCoupons(){ return state.coupons.filter(function(c){ return !c.archived; }); }
   ```

   Apply `liveCoupons()` at: `renderList` (`index.html:720` `visible=state.coupons.filter(matches)` → filter from `liveCoupons()`), the `live` count in `renderStats` (`:659`), `exportAllToCalendar` (`:868`), and `checkDuplicate` (`:790` — an archived coupon must NOT block re-adding the same code; that way "archive, then re-add the renewed offer" works).
3. **Savings tracker is exempt.** `totalSaved(state.coupons)` (`:663`) keeps summing over **all** coupons including archived+used — this is the data-durability win the ADR wanted. The test suite must assert this explicitly.
4. **Extension + server functions exclude archived** (the user archived it precisely to stop being nudged about it):
   - `extension/background.js`: wherever coupons are fetched/synced, filter `!c.archived` client-side (belt-and-braces even if the query filters).
   - `weekly-digest/index.ts` (~`:83` the `.gte('expiry_date'…)` query): add `.eq('archived', false)`.
   - `send-push-nudges/index.ts` (~`:143` the `.eq("expiry_date", …)` query): add `.eq('archived', false)`.
5. **JSON export/import:** no code change needed (export serializes `state.coupons` wholesale, flags ride along). Document that backups now include archived coupons.

### 3.3 Archive view (UI)

Keep it consistent with the existing UI vocabulary — a link-button in the util row (next to `hhBtn`, `index.html:247`):

- `<button id="archiveBtn" class="link-btn">🗃 Archive (N)</button>` — N from `state.coupons.filter(c=>c.archived).length`; hidden when N=0.
- Clicking toggles `state.showArchived`. When active:
  - `renderList` shows **only** archived coupons under one "Archived" group, ignoring the `soon/active/done` grouping; category chips and search still apply (reuse `matches`).
  - `ticketHTML` needs two action variants for archived tickets: **Restore** (clears flag) and **Delete forever** (`confirm()` → the real `dbDelete(id)` — this is now the only hard-delete path).
  - The archive button gets an active state (mirror `.chip.is-active` styling).
- Toggling back (or clicking another chip) returns to the normal view. `state.showArchived` defaults to `false` and is not persisted.

### 3.4 Edge cases

- Archiving a coupon whose `.ics` was already exported: calendar alarms still fire (fire-and-forget, per ADR §Decision). No code, just a line in README/DEPLOY.
- Household-shared coupon archived by a member: the flag is on the shared row, so it archives for everyone who can see the row. Acceptable for a household ("we're done with this one"); note it in the design as intended.
- `markUsed`/`markUnused`, `edit`, `calendar` on an archived ticket: only Restore/Delete-forever actions are rendered for archived tickets, so these can't be triggered from the archive view. Programmatic paths (`updateCoupon`) don't need guards.

---

## 4. Feature 7B — Clipboard quick-add

### 4.1 Flow

Runs once per app open, after first render (init promise chain, `index.html:1490-1502`):

1. **Gate 1 — API + permission.** Skip silently unless `navigator.clipboard?.readText` exists **and** `navigator.permissions.query({name:'clipboard-read'})` resolves to `'granted'`. **Never trigger a permission prompt on app open** — a surprise clipboard prompt on launch is worse than no feature. Browsers that require a gesture simply never show the prompt; that's acceptable (ADR calls this an approximation of Phase 4 convenience, not a guarantee).
2. **Gate 2 — heuristic.** `readText()` → `looksLikeCouponText(text)` from `shared/capture.mjs`. Also skip if: empty, > 2000 chars, or equals `state.lastCopiedCode` (see 4.3 — critical).
3. **Offer.** Reuse the existing `toast(msg, actionLabel, action)` (`index.html:622`): `toast('Clipboard looks like a coupon — add it?', 'Prefill form', …)`. Toast auto-hides in 5s; zero UI chrome to build.
4. **Action.** `openModalPrefilled(parseTextRuleBased(text))` — the same client-side rule parser the offline AI-capture fallback uses. No network call; user reviews and saves from the normal form. (If they want the AI path, ✨ AI Capture still exists.)

### 4.2 `looksLikeCouponText(text)` heuristic (in `shared/capture.mjs`)

Require **a code-like token AND at least one supporting signal**:

```js
code token:        /\b[A-Z0-9]{4,15}\b/  (same shape as coupon-parser.mjs)
supporting signal: discount  /(₹|rs\.?|\$)\s*\d+|\b\d+%\s*off/i
                   OR keyword /\b(coupon|promo|code|offer|cashback|deal)\b/i
                   OR a date   /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{4}\b/
                   OR brand    /\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)\b/i
```

A bare uppercase token alone must **not** trigger — order IDs and reference numbers would false-positive constantly. This is a deliberate decision; note it in the module comment.

### 4.3 The self-copy suppression trap (don't skip this)

The app's own copy-code button (`index.html:936-944`) writes coupon codes to the clipboard. Without suppression, the next app open would nag the user to add a coupon they already have. Mitigations, both required:

- Set `state.lastCopiedCode = code` in the copy handler; skip the prompt when clipboard text matches it (compare trimmed). In-memory only — a fresh launch can't have this problem because the heuristic requires more than a bare code (4.2), and codes the app wrote are bare codes.
- Belt-and-braces: also skip if `checkDuplicate`-style match finds the parsed code+brand already in the wallet (archived excluded — re-adding an archived code is legitimate).

### 4.4 Known limitation to document

`clipboard-read` is `'granted'` without prior gesture mostly only in installed PWAs on Android/Chromium after the user has allowed it, or in some desktop contexts. Many sessions will silently no-op. This is fine — the feature is opportunistic. README should say so in one sentence.

---

## 5. Feature 7C — Web Share Target

### 5.1 manifest.json

GET-based target (simplest — no service-worker POST handling, works offline via the existing cache-first fetch of `index.html`):

```json
"share_target": {
  "action": "./index.html",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

`action` must stay inside `scope` (`./`) — `./index.html` qualifies. Shared content arrives as `?title=…&text=…&url=…`.

### 5.2 App handling

In the init chain, **before** first render (so the modal opens on top of an already-rendered list):

1. `var shared = combineShareParams({ title: p.get('title'), text: p.get('text'), url: p.get('url') })` from `shared/capture.mjs`, where `p = new URLSearchParams(location.search)`.
2. If `shared` is non-empty: immediately `history.replaceState(null, '', location.pathname)` (so refresh/back doesn't re-trigger), then `openModalPrefilled(parseTextRuleBased(shared))` and toast `'Shared text received — review and save'`.
3. If the parsed result has no code, still open the prefilled modal — the user shared deliberately; let them fix fields manually (unlike the clipboard path, intent here is explicit).

### 5.3 `combineShareParams({title, text, url})` (in `shared/capture.mjs`)

- Concatenate non-empty parts in order `title + '\n' + text + '\n' + url`, trimmed.
- **Skip `url` if it's already contained in `text`** (Android apps commonly put the link in both).
- Cap the combined result at 2000 chars (the parser truncates notes to 150 anyway; this just bounds regex work).
- Return `''` when all parts are empty/missing — caller treats that as "no share".

### 5.4 Platform reality (document in README + DEPLOY)

- Works only when the app is **installed** as a PWA; Android/Chrome is the supported target.
- iOS Safari does not support `share_target` → iOS users get copy-paste + 7B instead. One line in docs; no code.

---

## 6. Pre-existing bug to fix first: prefill writes `"undefined"` as the coupon id

`openModal(coupon)` at `index.html:759` does `form.id.value=coupon.id;`. The AI Capture flow calls `openModal(extracted)` (`:1289`) where `extracted` comes from `parseTextRuleBased` and has **no `id` field**. Assigning `undefined` to an input's `value` coerces to the **string `"undefined"`**. On submit (`:799`) `fd.get('id')` is truthy → the save is treated as an edit of coupon `"undefined"` → `rec.id = 'undefined'` (`:803`) → the coupon is persisted with literal id `"undefined"`. **A second AI-capture save then overwrites the first**, because both have the same id.

Verify in a browser console (30 seconds), then fix:

1. In `openModal`, normalize: `form.id.value=(coupon && coupon.id) || '';` — but that alone conflates "edit" with "prefill" (prefill must also *not* mark the form as editing).
2. Introduce a dedicated entry point and route **all three** prefill callers through it (AI Capture at `:1289`, clipboard quick-add, share target):

   ```js
   function openModalPrefilled(parsed){   // parsed has no id/used/used_at
     openModal(null);                     // clean "Add a coupon" state, id = ''
     ['brand','code','discount_text','min_order_value','expiry_date',
      'category','source_app','redeem_url','notes'].forEach(function(k){
       if (parsed[k] != null && form[k]) form[k].value = parsed[k];
     });
   }
   ```

3. Add a regression assertion in the new test suite: `index.html` must not contain `form.id.value=coupon.id` without a `||''`-style guard, and must contain `openModalPrefilled`.

---

## 7. New shared module contract

`shared/capture.mjs` — pure functions, no DOM, no globals beyond standard JS (same style as the other shared modules: ES5-ish function bodies, `export function`, header comment explaining intent):

```js
export function looksLikeCouponText(text)   // → boolean, heuristic in §4.2
export function combineShareParams(parts)   // parts: {title,text,url} → string, rules in §5.3
```

Do **not** modify `shared/coupon-parser.mjs` — `tests/phase4_ai_capture.test.js` string-asserts its import graph, and it is the deployed single source for two edge functions.

---

## 8. Tests

New suite `tests/phase7_capture_archive.test.js`, following repo conventions (CommonJS file, `async function runTests()`, dynamic `await import('../shared/capture.mjs')`, string-based wiring assertions for app code, real-module execution for pure logic). Register it in `package.json`'s `test` script chain. Cases:

**looksLikeCouponText (real module):**
- ✅ `"Cred Alert: Use code SAVE500 on Amazon to get ₹500 off…"` → true
- ✅ `"Code MYNTRA50 gets you 50% off…"` → true
- ❌ `"hello there friend"` → false
- ❌ `"SAVE500"` bare code alone → false (§4.2 decision)
- ❌ `"Your order ID XB12KD99 has shipped"` → false unless a signal word appears (assert the exact behavior you implement — pick a case and lock it)
- ❌ `''` / 3 000-char string → false

**combineShareParams (real module):**
- merges title+text+url with newlines; skips missing parts; returns `''` when all empty
- url already inside text → not duplicated
- output capped at 2000 chars

**Archive (wiring + real savings module):**
- `supabase/schema.sql` contains both `ADD COLUMN IF NOT EXISTS archived` ALTERs
- `index.html` delete handler sets `archived=true` and does **not** call `dbDelete(` from the `'delete'` action; `dbDelete` still exists for delete-forever
- `index.html` contains `liveCoupons` and uses it in `renderList`/`renderStats`/`exportAllToCalendar`/`checkDuplicate`
- `weekly-digest/index.ts` and `send-push-nudges/index.ts` contain `archived` filter
- `extension/background.js` references `archived`
- savings durability: `totalSaved([{used:true, archived:true, discount_text:'₹200 off'}])` (real `shared/savings.mjs`) → 200

**Share target (wiring):**
- `manifest.json` parses as JSON and has `share_target.method === 'GET'` and params `text`
- `index.html` contains `URLSearchParams(location.search)` and `history.replaceState`

**Prefill fix (regression):**
- `index.html` contains `openModalPrefilled`; must not contain the unguarded `form.id.value=coupon.id;`

**sw.js:** `CACHE` string bumped and `./shared/capture.mjs` present in `SHELL`.

Run the whole suite (`npm test`) in two timezones before committing — the repo's CI now does this, but the task2_1 incident is why: `TZ=America/New_York npm test`.

---

## 9. Docs & ops updates

- **README.md**: add `shared/capture.mjs` to the structure block; one line each under the feature list for archive / clipboard / share target, including the "installed PWA, Android only" caveat for share target.
- **DEPLOY.md**:
  - Verification checklist: add rows — (12) Archive: delete a used coupon → ₹-saved unchanged, coupon under 🗃 Archive, restore works, delete-forever really removes; (13) Clipboard: copy a coupon SMS in another app → open wallet → toast offers prefill; (14) Share target: installed PWA → share SMS from Messages → app opens with prefilled form.
  - Reminder that `schema.sql` must be re-run for the ALTERs (the doc already frames re-running as the migration path).
  - Note that weekly-digest / send-push-nudges must be **redeployed** for the archived filter to take effect.
- **sw.js**: `CACHE = 'coupon-wallet-v3'`; add `./shared/capture.mjs` to `SHELL`.

---

## 10. Implementation order (suggested)

1. **Prefill-id fix + `openModalPrefilled`** (§6) — smallest, unblocks everything, fixes live corruption.
2. **shared/capture.mjs + its unit tests** — pure, no wiring risk.
3. **7A archive** — schema → CRUD → rendering → archive view → extension/functions filters.
4. **7C share target** — manifest + init hook (reuses 1 & 2).
5. **7B clipboard quick-add** — init hook + self-copy suppression (reuses 1 & 2).
6. Docs, sw bump, full suite in two timezones.

**Estimated effort:** ~1 day, matching the ADR's value-per-hour ranking. No new dependencies, no build step, no new secrets.
