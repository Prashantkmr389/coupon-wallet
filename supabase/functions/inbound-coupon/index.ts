// Supabase Edge Function: Inbound Coupon Mail (Phase 6)
// Receives an inbound-email webhook (SendGrid Inbound Parse / Mailgun Routes /
// Cloudflare Email Workers — any provider that POSTs JSON), parses the coupon
// from the body, and inserts it into the wallet that owns the forwarding address.
//
// Addressing convention: wallet+<inbound_token>@your-domain.com
// The token maps to a household; the coupon lands in the shared household wallet.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ParsedCoupon {
  brand: string;
  code: string;
  discount_text: string;
  min_order_value: number | null;
  category: string;
  source_app: string;
  expiry_date: string;
  notes: string;
}

// Same rule-based extractor as the client and parse-coupon, duplicated because
// Edge Functions deploy independently with no shared module directory.
export function parseTextRuleBased(text: string): ParsedCoupon {
  const clean = text.trim();

  const codeMatch = clean.match(/\b(code|use|promo|coupon)?\s*:?\s*([A-Z0-9]{4,15})\b/) ||
                    clean.match(/\b([A-Z0-9]{4,15})\b/);
  const code = codeMatch ? (codeMatch[2] || codeMatch[1]) : '';

  const discountMatch = clean.match(/(₹|rs\.?|\$)\s*\d+(\s*off|\s*cashback)?|\b\d+%\s*off/i);
  const discount_text = discountMatch ? discountMatch[0] : '';

  const minMatch = clean.match(/(min\.?|minimum)\s*(order|purchase|spend)?\s*:?\s*(₹|rs\.?|\$)?\s*(\d+)/i);
  const min_order_value = minMatch ? parseInt(minMatch[4], 10) : null;

  const isoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const dmyMatch = !isoMatch && clean.match(/\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})\b/);

  let expiry_date = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  if (isoMatch) {
    expiry_date = isoMatch[0];
  } else if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    expiry_date = `${dmyMatch[3]}-${month}-${day}`;
  }

  const brandMatch = clean.match(/\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)/i);
  const brand = brandMatch ? brandMatch[0] : 'Other';

  return {
    brand,
    code: code.toUpperCase(),
    discount_text: discount_text || 'Special Offer',
    min_order_value,
    category: 'Other',
    source_app: 'Email',
    expiry_date,
    notes: clean.slice(0, 150)
  };
}

// Crude HTML → text so web-format mails still hit the parser.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  try {
    // Accept the common field spellings across webhook providers.
    const body = await req.json();
    const to = String(body.to || body.recipient || body.To || '');
    const text = String(body.text || body.body || body.raw || '');
    const html = String(body.html || '');

    if (!to || (!text && !html)) {
      return new Response(JSON.stringify({ error: "Provide at least 'to' and message content" }), { status: 400 });
    }

    // wallet+<token>@domain
    const tokenMatch = to.match(/wallet\+([a-f0-9]{8,64})@/i);
    if (!tokenMatch) {
      return new Response(JSON.stringify({ error: "Recipient is not a wallet forwarding address" }), { status: 400 });
    }
    const inboundToken = tokenMatch[1].toLowerCase();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: household, error: hhError } = await supabase
      .from('households')
      .select('id, name, owner_id')
      .eq('inbound_token', inboundToken)
      .single();

    if (hhError || !household) {
      return new Response(JSON.stringify({ error: "No household found for this forwarding address" }), { status: 404 });
    }

    const parsed = parseTextRuleBased(text || htmlToText(html));
    if (!parsed.code) {
      return new Response(JSON.stringify({ error: "Could not extract a coupon code from the mail" }), { status: 422 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('coupons')
      .insert({
        id: 'em_' + crypto.randomUUID(),
        // Service-role insert bypasses RLS; ownership is attributed to the
        // household owner while visibility comes from household membership.
        user_id: household.owner_id,
        household_id: household.id,
        brand: parsed.brand,
        code: parsed.code,
        discount_text: parsed.discount_text,
        min_order_value: parsed.min_order_value,
        category: parsed.category,
        source_app: parsed.source_app,
        expiry_date: parsed.expiry_date,
        notes: parsed.notes,
        used_by: null
      })
      .select()
      .single();

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, household: household.name, coupon: inserted }), {
      headers: { "Content-Type": "application/json" },
      status: 201,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
