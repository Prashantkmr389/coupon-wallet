// Supabase Edge Function: Web Push Nudges (Phase 3 delivery fix)
//
// GET  → { publicKey }: the VAPID public key for pushManager.subscribe().
// POST → nudges: finds unused coupons expiring TOMORROW, groups them per
//        user, and sends a VAPID-signed Web Push to every saved endpoint.
//
// Pushes carry an EMPTY payload — RFC 8291 payload encryption is heavy to
// hand-roll correctly, and the service worker already computes the real
// expiring-soon list from local IndexedDB when it receives a bare push.
// That keeps this function small and the notification always current.
//
// Secrets (see scripts/generate-vapid-keys.mjs):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBJECT
// Schedule: daily 9am via config.json. "Expires today" is covered by the
// calendar alarms; this nudge lands the day before.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const PUSH_SUBJECT = Deno.env.get("PUSH_SUBJECT") || "mailto:notifications@coupon-wallet.app";

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/* ---------------- base64url ---------------- */

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".slice((b64.length + 3) % 4));
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function b64urlEncode(bytes: Uint8Array | string): string {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/* ---------------- VAPID (RFC 8292) ---------------- */

let signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) return signingKey;
  // Private scalar d plus the public point x,y (from the raw public key:
  // 0x04 || X(32) || Y(32)) form the JWK WebCrypto needs for ECDSA.
  const pub = b64urlDecode(VAPID_PUBLIC_KEY!);
  const d = b64urlDecode(VAPID_PRIVATE_KEY!);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: b64urlEncode(d),
    ext: true,
  };
  signingKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return signingKey;
}

// Signed once per run and reused across endpoints (aud varies by endpoint
// origin, so we cache per-origin).
const vapidAuthCache = new Map<string, string>();

async function vapidAuthorization(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cached = vapidAuthCache.get(aud);
  if (cached) return cached;

  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const claims = b64urlEncode(utf8(JSON.stringify({ aud, exp, sub: PUSH_SUBJECT })));
  const data = utf8(`${header}.${claims}`);

  const key = await getSigningKey();
  // P-256 ECDSA signatures come back as raw r||s (64 bytes) — exactly what VAPID wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);

  const token = `${header}.${claims}.${b64urlEncode(new Uint8Array(sig))}`;
  const auth = `vapid t=${token}, k=${VAPID_PUBLIC_KEY}`;
  vapidAuthCache.set(aud, auth);
  return auth;
}

/* ---------------- push sending ---------------- */

async function sendPush(sub: PushSubscriptionRow): Promise<boolean> {
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint),
        TTL: "86400",
        Urgency: "normal",
        "Content-Length": "0",
      },
    });
    if (res.status === 404 || res.status === 410) {
      console.warn("subscription gone:", sub.endpoint);
      return false; // caller prunes it
    }
    if (!res.ok) {
      console.warn(`push failed ${res.status}:`, sub.endpoint);
      return true; // transient — keep the subscription
    }
    return true;
  } catch (err) {
    console.warn("push error:", err.message ?? err);
    return true;
  }
}

export async function nudgeUsersForTomorrow(today = new Date()): Promise<{ users: number; pushes: number }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID keys not configured — run scripts/generate-vapid-keys.mjs and set secrets");
  }

  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().split("T")[0];

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: coupons, error } = await supabase
    .from("coupons")
    .select("id, user_id")
    .eq("used", false)
    .eq("archived", false)
    .eq("expiry_date", iso(tomorrow));

  if (error) throw error;

  const userIds = [...new Set((coupons ?? []).map(c => c.user_id))];
  let pushes = 0;

  for (const userId of userIds) {
    const { data: subs, error: subError } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (subError || !subs?.length) continue;

    for (const sub of subs as PushSubscriptionRow[]) {
      const alive = await sendPush(sub);
      if (!alive) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      } else {
        pushes++;
      }
    }
  }

  return { users: userIds.length, pushes };
}

serve(async (req) => {
  try {
    if (req.method === "GET") {
      if (!VAPID_PUBLIC_KEY) {
        return new Response(
          JSON.stringify({ error: "VAPID_PUBLIC_KEY secret not set on this deployment" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const result = await nudgeUsersForTomorrow();
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500 });
  }
});
