// Supabase Edge Function: AI Coupon Capture (Phase 4)
// Extracts structured coupon fields from raw SMS/email text or screenshot image.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parseTextRuleBased } from "../../../shared/coupon-parser.mjs";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENAI_API_KEY");

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
