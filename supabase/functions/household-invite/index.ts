// Supabase Edge Function: Household Invite Email (Phase 6)
// Sends the "you've been invited" email via Resend. The membership row is
// created client-side by the owner (RLS-checked); this function only delivers
// the mail. Degrades gracefully to a no-op when RESEND_API_KEY is not set.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://coupoun.netlify.app";

interface InviteRequest {
  invitee_email: string;
  household_name: string;
  inviter_email?: string;
}

serve(async (req) => {
  try {
    const { invitee_email, household_name, inviter_email }: InviteRequest = await req.json();

    if (!invitee_email || !household_name) {
      return new Response(JSON.stringify({ error: "invitee_email and household_name are required" }), { status: 400 });
    }

    // No key configured — the invite row still exists and the invitee can
    // claim it by signing in with the invited address; just report skipping.
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, emailed: false }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    const subject = `🎟 You've been invited to share "${household_name}" on Coupon Wallet`;
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, sans-serif; background: #1B2430; color: #F6F1E4; padding: 20px;">
        <div style="max-width: 480px; margin: 0 auto; background: #ffffff; color: #241F16; border-radius: 12px; padding: 24px;">
          <h2 style="color: #1B2430; margin-top: 0;">Join "${household_name}"</h2>
          <p style="color: #5B5344; font-size: 14px;">
            ${inviter_email ? `<strong>${inviter_email}</strong> invited you` : 'You have been invited'} to share a
            coupon wallet. Coupons added to the household are visible to every member.
          </p>
          <p style="color: #5B5344; font-size: 14px;">
            Open Coupon Wallet, sign in with <strong>${invitee_email}</strong> using a magic link, and your invite
            is claimed automatically — no code to enter.
          </p>
          <div style="margin-top: 20px; text-align: center;">
            <a href="${APP_URL}" style="background: #2F6E56; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; display: inline-block;">Open Coupon Wallet</a>
          </div>
        </div>
      </body>
      </html>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Coupon Wallet <notifications@coupon-wallet.app>",
        to: [invitee_email],
        subject,
        html
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ success: false, emailed: false, error: errText }), { status: 502 });
    }

    return new Response(JSON.stringify({ success: true, emailed: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
