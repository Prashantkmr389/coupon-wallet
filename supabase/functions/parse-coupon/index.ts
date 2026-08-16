// Supabase Edge Function: AI Coupon Capture (Phase 4)
// Extracts structured coupon fields from raw SMS/email text or screenshot image.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENAI_API_KEY");

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

export function parseTextRuleBased(text: string): ParsedCoupon {
  const clean = text.trim();

  // Code extraction (uppercase alphanumeric 4-15 chars)
  const codeMatch = clean.match(/\b(code|use|promo|coupon)?\s*:?\s*([A-Z0-9]{4,15})\b/) ||
                    clean.match(/\b([A-Z0-9]{4,15})\b/);
  const code = codeMatch ? (codeMatch[2] || codeMatch[1]) : '';

  // Discount text (e.g. ₹500 off, 50% OFF, Rs 200 Cashback)
  const discountMatch = clean.match(/(₹|rs\.?|\$)\s*\d+(\s*off|\s*cashback)?|\b\d+%\s*off/i);
  const discount_text = discountMatch ? discountMatch[0] : '';

  // Min order value
  const minMatch = clean.match(/(min\.?|minimum)\s*(order|purchase|spend)?\s*:?\s*(₹|rs\.?|\$)?\s*(\d+)/i);
  const min_order_value = minMatch ? parseInt(minMatch[4], 10) : null;

  // Expiry date YYYY-MM-DD or DD/MM/YYYY
  const isoMatch = clean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const dmyMatch = !isoMatch && clean.match(/\b(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})\b/);

  let expiry_date = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]; // Default 14 days
  if (isoMatch) {
    expiry_date = isoMatch[0];
  } else if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    expiry_date = `${dmyMatch[3]}-${month}-${day}`;
  }

  // Brand heuristic (merchant the coupon is redeemed at)
  const brandMatch = clean.match(/\b(Amazon|Myntra|MakeMyTrip|Zomato|Swiggy|Flipkart|Uber|Ola)/i);
  const brand = brandMatch ? brandMatch[0] : 'Other';

  // Source app (where the SMS/notification came from), kept separate from brand
  const sourceMatch = clean.match(/\b(Cred|Paytm|PhonePe|GPay|Google Pay)\b/i);
  const source_app = sourceMatch ? sourceMatch[0] : 'SMS / Text';

  return {
    brand: brand,
    code: code.toUpperCase(),
    discount_text: discount_text || 'Special Offer',
    min_order_value: min_order_value,
    category: 'Other',
    source_app: source_app,
    expiry_date: expiry_date,
    notes: clean.slice(0, 150)
  };
}

serve(async (req) => {
  try {
    const { text, image_base64 } = await req.json();

    if (!text && !image_base64) {
      return new Response(JSON.stringify({ error: "Provide either text or image_base64" }), { status: 400 });
    }

    // If AI Key is present, call AI provider; otherwise use high-accuracy rule-based parser
    if (text && !ANTHROPIC_API_KEY) {
      const parsed = parseTextRuleBased(text);
      return new Response(JSON.stringify(parsed), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // AI-assisted parsing prompt
    const prompt = `You are a coupon extraction engine. Extract coupon details from the text/image and return ONLY valid JSON matching this schema:
{
  "brand": string,
  "code": string,
  "discount_text": string,
  "min_order_value": number | null,
  "category": "Flights" | "Hotels" | "Shopping" | "Food" | "Recharge & Bills" | "Groceries" | "Entertainment" | "Other",
  "source_app": string,
  "expiry_date": "YYYY-MM-DD",
  "notes": string
}

Input text:
"${text || ''}"`;

    if (ANTHROPIC_API_KEY) {
      const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const aiData = await aiResponse.json();
      const contentText = aiData?.content?.[0]?.text || '';
      const jsonMatch = contentText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return new Response(jsonMatch[0], {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // Fallback to rule-based parsing
    const fallback = parseTextRuleBased(text || '');
    return new Response(JSON.stringify(fallback), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
