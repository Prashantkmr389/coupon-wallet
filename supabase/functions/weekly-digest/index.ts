// Supabase Edge Function: Weekly Email Digest (Phase 3)
// Queries coupons expiring within the next 7 days and sends structured email summaries.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Coupon {
  id: string;
  brand: string;
  code: string;
  discount_text: string;
  expiry_date: string;
  user_id: string;
}

export function formatDigestEmail(email: string, expiringCoupons: Coupon[]): { subject: string; html: string } {
  const count = expiringCoupons.length;
  const subject = `🎟 ${count} coupon${count === 1 ? '' : 's'} expiring this week!`;

  const couponItemsHtml = expiringCoupons.map(c => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px; font-weight: bold; color: #1B2430;">${c.brand}</td>
      <td style="padding: 12px; font-family: monospace; font-weight: bold; background: #F6F1E4; color: #241F16;">${c.code}</td>
      <td style="padding: 12px; color: #5B5344;">${c.discount_text}</td>
      <td style="padding: 12px; color: #B4791F; font-weight: bold;">Expires ${c.expiry_date}</td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, sans-serif; background: #1B2430; color: #F6F1E4; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; color: #241F16; border-radius: 12px; padding: 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
        <h2 style="color: #1B2430; margin-top: 0;">Your Weekly Coupon Digest</h2>
        <p style="color: #5B5344; font-size: 14px;">Here are your coupons expiring in the next 7 days. Don't let them quietly expire!</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <thead>
            <tr style="background: #232D3B; color: #F6F1E4; text-align: left;">
              <th style="padding: 10px;">Brand</th>
              <th style="padding: 10px;">Code</th>
              <th style="padding: 10px;">Discount</th>
              <th style="padding: 10px;">Expiry</th>
            </tr>
          </thead>
          <tbody>
            ${couponItemsHtml}
          </tbody>
        </table>

        <div style="margin-top: 24px; text-align: center;">
          <a href="https://coupon-wallet.netlify.app" style="background: #2F6E56; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; display: inline-block;">Open Coupon Wallet</a>
        </div>
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Calculate dates for 7-day window
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const todayStr = today.toISOString().split('T')[0];
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    // Query coupons due in next 7 days
    const { data: coupons, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('used', false)
      .gte('expiry_date', todayStr)
      .lte('expiry_date', nextWeekStr);

    if (error) throw error;

    if (!coupons || coupons.length === 0) {
      return new Response(JSON.stringify({ message: "No expiring coupons this week." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Group by user_id
    const userCouponsMap: Record<string, Coupon[]> = {};
    for (const c of coupons) {
      if (!userCouponsMap[c.user_id]) userCouponsMap[c.user_id] = [];
      userCouponsMap[c.user_id].push(c);
    }

    let sentCount = 0;

    for (const userId of Object.keys(userCouponsMap)) {
      // Get user email
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
      if (userError || !userData?.user?.email) continue;

      const email = userData.user.email;
      const userCoupons = userCouponsMap[userId];
      const { subject, html } = formatDigestEmail(email, userCoupons);

      if (RESEND_API_KEY) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "Coupon Wallet <notifications@coupon-wallet.app>",
            to: [email],
            subject: subject,
            html: html
          })
        });
      }
      sentCount++;
    }

    return new Response(JSON.stringify({ success: true, processedUsers: sentCount }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
