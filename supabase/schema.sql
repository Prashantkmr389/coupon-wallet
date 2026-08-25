-- Coupon Wallet Supabase Postgres Schema (Phase 2 & 3)
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

-- Web Push Subscriptions Table (Phase 3)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS coupons_user_id_idx ON public.coupons(user_id);
CREATE INDEX IF NOT EXISTS coupons_expiry_date_idx ON public.coupons(expiry_date);
CREATE INDEX IF NOT EXISTS coupons_brand_idx ON public.coupons(brand);
CREATE INDEX IF NOT EXISTS push_subs_user_id_idx ON public.push_subscriptions(user_id);

-- Enable Row Level Security
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Coupons RLS Policies
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

-- Push Subscriptions RLS Policies
CREATE POLICY "Users can view their own push subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own push subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own push subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Phase 6: Shared Household Wallet + Savings Tracker
-- ============================================================

-- Coupons get optional household sharing and per-person usage tracking.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS household_id UUID DEFAULT NULL;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS used_by TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS coupons_household_id_idx ON public.coupons(household_id);

-- One household per account (owner-managed).
CREATE TABLE IF NOT EXISTS public.households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'My Household',
  owner_id UUID NOT NULL UNIQUE DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Token embedded in the forwarding address: wallet+<inbound_token>@domain
  inbound_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  -- NULL until the invitee signs in and claims the invite by email match.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, email)
);

CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON public.household_members(user_id);
CREATE INDEX IF NOT EXISTS household_members_email_idx ON public.household_members(email);
CREATE INDEX IF NOT EXISTS households_owner_id_idx ON public.households(owner_id);

-- Households RLS
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their household"
  ON public.households FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Members can view their household"
  ON public.households FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members m
      WHERE m.household_id = id AND m.user_id = auth.uid() AND m.status = 'active'
    )
  );

CREATE POLICY "Members can view membership rows of their households"
  ON public.household_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members me
      WHERE me.household_id = household_id AND me.user_id = auth.uid()
    )
    OR email = auth.email()
  );

CREATE POLICY "Members can leave their household"
  ON public.household_members FOR DELETE
  USING (auth.uid() = user_id AND role = 'member');

CREATE POLICY "Invited users can claim their invite"
  ON public.household_members FOR UPDATE
  USING (email = auth.email())
  WITH CHECK (email = auth.email());

CREATE POLICY "Household owners can manage members"
  ON public.household_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.owner_id = auth.uid()
    )
  );

-- Coupons: extend every policy so household members share visibility.
DROP POLICY IF EXISTS "Users can view their own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Users can insert their own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Users can update their own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Users can delete their own coupons" ON public.coupons;

CREATE POLICY "Users can view their own coupons"
  ON public.coupons FOR SELECT
  USING (
    auth.uid() = user_id
    OR (
      household_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.household_members m
        WHERE m.household_id = household_id AND m.user_id = auth.uid() AND m.status = 'active'
      )
    )
  );

CREATE POLICY "Users can insert their own coupons"
  ON public.coupons FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR (
      household_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.household_members m
        WHERE m.household_id = household_id AND m.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update their own coupons"
  ON public.coupons FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (
      household_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.household_members m
        WHERE m.household_id = household_id AND m.user_id = auth.uid() AND m.status = 'active'
      )
    )
  );

CREATE POLICY "Users can delete their own coupons"
  ON public.coupons FOR DELETE
  USING (
    auth.uid() = user_id
    OR (
      household_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.households h
        WHERE h.id = household_id AND h.owner_id = auth.uid()
      )
    )
  );

-- ============================================================
-- Phase 7: archive instead of hard delete
-- ============================================================

-- Archived coupons stay queryable (₹-saved keeps counting them) but are
-- hidden from the list, stats, exports, digests, pushes and the extension.
-- Same rows, same policies — no RLS changes.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
