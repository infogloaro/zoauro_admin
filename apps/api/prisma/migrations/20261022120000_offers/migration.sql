-- D182 offers (doc 60 §10.6; D199–D204). Replaces the unused coupons table (kept, never written, F5).

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferScope" AS ENUM ('PLATFORM', 'ZONE', 'VENDOR');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PERCENT', 'FLAT', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "OfferFunding" AS ENUM ('PLATFORM', 'VENDOR', 'SHARED');

-- CreateEnum
CREATE TYPE "OfferRedemptionStatus" AS ENUM ('APPLIED', 'REVERSED');

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "scope" "OfferScope" NOT NULL,
    "restaurant_id" UUID,
    "homemaker_id" UUID,
    "zone_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "OfferType" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_discount_paise" INTEGER,
    "min_order_paise" INTEGER NOT NULL DEFAULT 0,
    "new_customers_only" BOOLEAN NOT NULL DEFAULT false,
    "payment_methods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "per_customer_limit" INTEGER NOT NULL DEFAULT 1,
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "budget_paise" INTEGER,
    "spent_paise" INTEGER NOT NULL DEFAULT 0,
    "funded_by" "OfferFunding" NOT NULL,
    "vendor_share_pct" INTEGER,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_to" TIMESTAMPTZ NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "source" "RecordSource" NOT NULL,
    "submitted_by_client_id" UUID,
    "requested_by" UUID,
    "requested_by_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_redemptions" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "checkout_group_id" UUID,
    "customer_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "discount_paise" INTEGER NOT NULL,
    "vendor_paise" INTEGER NOT NULL,
    "platform_paise" INTEGER NOT NULL,
    "status" "OfferRedemptionStatus" NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ,
    "reverse_reason" TEXT,

    CONSTRAINT "offer_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_status_valid_from_idx" ON "offers"("status", "valid_from");

-- CreateIndex
CREATE INDEX "offers_status_valid_to_idx" ON "offers"("status", "valid_to");

-- CreateIndex
CREATE INDEX "offers_restaurant_id_idx" ON "offers"("restaurant_id");

-- CreateIndex
CREATE INDEX "offers_homemaker_id_idx" ON "offers"("homemaker_id");

-- CreateIndex
CREATE UNIQUE INDEX "offer_redemptions_order_id_key" ON "offer_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "offer_redemptions_offer_id_customer_id_status_idx" ON "offer_redemptions"("offer_id", "customer_id", "status");

-- CreateIndex
CREATE INDEX "offer_redemptions_zone_id_applied_at_idx" ON "offer_redemptions"("zone_id", "applied_at" DESC);

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_homemaker_id_fkey" FOREIGN KEY ("homemaker_id") REFERENCES "homemakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D182 constraints Prisma cannot express
-- the scope decides the zones and the vendor
ALTER TABLE "offers" ADD CONSTRAINT "offers_scope_check" CHECK (
  ("scope" = 'PLATFORM' AND cardinality("zone_ids") = 0 AND "restaurant_id" IS NULL AND "homemaker_id" IS NULL)
  OR ("scope" = 'ZONE' AND cardinality("zone_ids") >= 1 AND "restaurant_id" IS NULL AND "homemaker_id" IS NULL)
  OR ("scope" = 'VENDOR' AND cardinality("zone_ids") = 1 AND num_nonnulls("restaurant_id", "homemaker_id") = 1)
);
-- F2: a vendor offer is paid by the vendor; only a vendor offer is; SHARED carries the vendor's share (D199)
ALTER TABLE "offers" ADD CONSTRAINT "offers_funding_check" CHECK (
  (("scope" = 'VENDOR') = ("funded_by" = 'VENDOR'))
  AND (("funded_by" = 'SHARED') = ("vendor_share_pct" IS NOT NULL))
  AND ("vendor_share_pct" IS NULL OR "vendor_share_pct" BETWEEN 1 AND 99)
);
ALTER TABLE "offers" ADD CONSTRAINT "offers_value_check" CHECK (
  ("type" = 'PERCENT' AND "value" BETWEEN 1 AND 100)
  OR ("type" = 'FLAT' AND "value" >= 100)
  OR ("type" = 'FREE_DELIVERY' AND "value" = 0)
);
ALTER TABLE "offers" ADD CONSTRAINT "offers_max_discount_check"
  CHECK ("max_discount_paise" IS NULL OR ("type" = 'PERCENT' AND "max_discount_paise" > 0));
ALTER TABLE "offers" ADD CONSTRAINT "offers_code_check" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9]{4,20}$');
ALTER TABLE "offers" ADD CONSTRAINT "offers_period_check" CHECK ("valid_to" > "valid_from");
ALTER TABLE "offers" ADD CONSTRAINT "offers_counts_check" CHECK (
  "min_order_paise" >= 0 AND "per_customer_limit" >= 1 AND "used_count" >= 0 AND "spent_paise" >= 0
  AND ("usage_limit" IS NULL OR "usage_limit" >= 1) AND ("budget_paise" IS NULL OR "budget_paise" > 0)
);
ALTER TABLE "offers" ADD CONSTRAINT "offers_payment_methods_check"
  CHECK ("payment_methods" <@ ARRAY['ONLINE', 'COD', 'WALLET']::TEXT[]);
-- one live offer per code, ignoring case (codes are stored upper case)
CREATE UNIQUE INDEX "offers_code_live_key" ON "offers" (upper("code"))
  WHERE "code" IS NOT NULL AND "deleted_at" IS NULL;
-- zone scoping (GIN on the zone array)
CREATE INDEX "offers_zone_ids_idx" ON "offers" USING GIN ("zone_ids");
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_split_check" CHECK (
  "discount_paise" > 0 AND "vendor_paise" >= 0 AND "platform_paise" >= 0
  AND "vendor_paise" + "platform_paise" = "discount_paise"
);
