-- Coupon Wallet Supabase Postgres Schema (Phase 2)
-- Enables Row Level Security (RLS) so each user only sees and mutates their own coupons.

CREATE TABLE IF NOT EXISTS public.coupons (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  code TEXT NOT NULL,
  discount_text TEXT NOT NULL,
  min_order_value NUMERIC DEFAULT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  source_app TEXT DEFAULT 'Other',
  expiry_date DATE NOT NULL,
  redeem_url TEXT DEFAULT NULL,
  notes TEXT DEFAULT '',
  reusable BOOLEAN NOT NULL DEFAULT FALSE,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS coupons_user_id_idx ON public.coupons(user_id);
CREATE INDEX IF NOT EXISTS coupons_expiry_date_idx ON public.coupons(expiry_date);
CREATE INDEX IF NOT EXISTS coupons_brand_idx ON public.coupons(brand);

-- Enable Row Level Security
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own coupons"
  ON public.coupons FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own coupons"
  ON public.coupons FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own coupons"
  ON public.coupons FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own coupons"
  ON public.coupons FOR DELETE
  USING (auth.uid() = user_id);
