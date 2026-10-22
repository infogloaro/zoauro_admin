-- CreateEnum
CREATE TYPE "AdPage" AS ENUM ('HOME', 'RESTAURANTS', 'HOME_FOOD', 'HOTELS');

-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('BANNER', 'TOP_LISTING', 'FEATURED');

-- CreateEnum
CREATE TYPE "AdPricing" AS ENUM ('FLAT_PER_DAY', 'COMMISSION');

-- CreateEnum
CREATE TYPE "AdSlotStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AdRequestStatus" AS ENUM ('SUBMITTED', 'QUOTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AdCampaignStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdBillingStatus" AS ENUM ('PENDING', 'DEDUCTED', 'WAIVED');

-- CreateTable
CREATE TABLE "ad_slots" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "page" "AdPage" NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "position" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "pricing" "AdPricing" NOT NULL,
    "price_per_day_paise" INTEGER,
    "commission_pct" DECIMAL(5,2),
    "min_days" INTEGER NOT NULL DEFAULT 1,
    "max_days" INTEGER NOT NULL DEFAULT 30,
    "terms" TEXT,
    "status" "AdSlotStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "ad_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_terms" (
    "id" UUID NOT NULL,
    "zone_id" UUID,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ad_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_requests" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "restaurant_id" UUID,
    "homemaker_id" UUID,
    "hotel_id" UUID,
    "page" "AdPage" NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "requested_start_date" DATE NOT NULL,
    "requested_days" INTEGER NOT NULL,
    "creative_key" TEXT,
    "vendor_note" TEXT,
    "status" "AdRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "slot_id" UUID,
    "quoted_pricing" "AdPricing",
    "quoted_price_per_day_paise" INTEGER,
    "quoted_commission_pct" DECIMAL(5,2),
    "quoted_total_paise" INTEGER,
    "quote_note" TEXT,
    "quote_expires_at" TIMESTAMPTZ,
    "terms_id" UUID,
    "quoted_by" UUID,
    "quoted_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "reject_reason" TEXT,
    "accepted_at" TIMESTAMPTZ,
    "accept_note" TEXT,
    "source" "RecordSource" NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ad_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaigns" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "request_id" UUID,
    "restaurant_id" UUID,
    "homemaker_id" UUID,
    "hotel_id" UUID,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "status" "AdCampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
    "pricing" "AdPricing" NOT NULL,
    "price_per_day_paise" INTEGER,
    "commission_pct" DECIMAL(5,2),
    "terms_id" UUID,
    "creative_key" TEXT,
    "billing_status" "AdBillingStatus" NOT NULL DEFAULT 'PENDING',
    "pauses_json" JSONB NOT NULL DEFAULT '[]',
    "paused_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancel_reason" TEXT,
    "ended_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "ad_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_slots_zone_id_status_idx" ON "ad_slots"("zone_id", "status");

-- CreateIndex
CREATE INDEX "ad_requests_zone_id_status_submitted_at_idx" ON "ad_requests"("zone_id", "status", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "ad_requests_status_quote_expires_at_idx" ON "ad_requests"("status", "quote_expires_at");

-- CreateIndex
CREATE INDEX "ad_requests_restaurant_id_idx" ON "ad_requests"("restaurant_id");

-- CreateIndex
CREATE INDEX "ad_requests_homemaker_id_idx" ON "ad_requests"("homemaker_id");

-- CreateIndex
CREATE INDEX "ad_requests_hotel_id_idx" ON "ad_requests"("hotel_id");

-- CreateIndex
CREATE INDEX "ad_requests_slot_id_idx" ON "ad_requests"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaigns_request_id_key" ON "ad_campaigns"("request_id");

-- CreateIndex
CREATE INDEX "ad_campaigns_slot_id_status_start_at_end_at_idx" ON "ad_campaigns"("slot_id", "status", "start_at", "end_at");

-- CreateIndex
CREATE INDEX "ad_campaigns_zone_id_status_start_at_idx" ON "ad_campaigns"("zone_id", "status", "start_at" DESC);

-- CreateIndex
CREATE INDEX "ad_campaigns_restaurant_id_status_idx" ON "ad_campaigns"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "ad_campaigns_homemaker_id_status_idx" ON "ad_campaigns"("homemaker_id", "status");

-- CreateIndex
CREATE INDEX "ad_campaigns_hotel_id_status_idx" ON "ad_campaigns"("hotel_id", "status");

-- AddForeignKey
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_terms" ADD CONSTRAINT "ad_terms_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_homemaker_id_fkey" FOREIGN KEY ("homemaker_id") REFERENCES "homemakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "ad_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_terms_id_fkey" FOREIGN KEY ("terms_id") REFERENCES "ad_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "ad_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ad_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_homemaker_id_fkey" FOREIGN KEY ("homemaker_id") REFERENCES "homemakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_terms_id_fkey" FOREIGN KEY ("terms_id") REFERENCES "ad_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D179, D182, D201 constraints Prisma cannot express
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_position_check" CHECK ("position" >= 1);
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_capacity_check" CHECK ("capacity" BETWEEN 1 AND 20);
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_days_check"
  CHECK ("min_days" >= 1 AND "max_days" >= "min_days" AND "max_days" <= 365);
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_pricing_check" CHECK (
  ("pricing" = 'FLAT_PER_DAY' AND "price_per_day_paise" IS NOT NULL AND "price_per_day_paise" BETWEEN 0 AND 10000000
     AND "commission_pct" IS NULL)
  OR ("pricing" = 'COMMISSION' AND "commission_pct" IS NOT NULL AND "commission_pct" > 0 AND "commission_pct" <= 100
     AND "price_per_day_paise" IS NULL));
-- hotels have no orders to take a commission from
ALTER TABLE "ad_slots" ADD CONSTRAINT "ad_slots_hotels_flat_check" CHECK (NOT ("page" = 'HOTELS' AND "pricing" = 'COMMISSION'));
CREATE UNIQUE INDEX "ad_slots_position_key" ON "ad_slots" ("zone_id", "page", "placement", "position")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "ad_terms" ADD CONSTRAINT "ad_terms_version_check" CHECK ("version" >= 1);
ALTER TABLE "ad_terms" ADD CONSTRAINT "ad_terms_body_check" CHECK (length("body") BETWEEN 20 AND 20000);
-- one version number per scope (platform = zone_id NULL)
CREATE UNIQUE INDEX "ad_terms_scope_version" ON "ad_terms"
  (COALESCE("zone_id", '00000000-0000-0000-0000-000000000000'::uuid), "version");

ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_one_vendor_check"
  CHECK (num_nonnulls("restaurant_id", "homemaker_id", "hotel_id") = 1);
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_days_check" CHECK ("requested_days" BETWEEN 1 AND 365);
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_price_check"
  CHECK ("quoted_price_per_day_paise" IS NULL OR "quoted_price_per_day_paise" >= 0);
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_total_check"
  CHECK ("quoted_total_paise" IS NULL OR "quoted_total_paise" >= 0);
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_commission_check"
  CHECK ("quoted_commission_pct" IS NULL OR ("quoted_commission_pct" > 0 AND "quoted_commission_pct" <= 100));
ALTER TABLE "ad_requests" ADD CONSTRAINT "ad_requests_quoted_check"
  CHECK ("status" <> 'QUOTED' OR ("slot_id" IS NOT NULL AND "quoted_pricing" IS NOT NULL AND "quote_expires_at" IS NOT NULL));

ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_one_vendor_check"
  CHECK (num_nonnulls("restaurant_id", "homemaker_id", "hotel_id") = 1);
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_period_check" CHECK ("end_at" > "start_at");
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_pricing_check" CHECK (
  ("pricing" = 'FLAT_PER_DAY' AND "price_per_day_paise" IS NOT NULL AND "price_per_day_paise" BETWEEN 0 AND 10000000
     AND "commission_pct" IS NULL)
  OR ("pricing" = 'COMMISSION' AND "commission_pct" IS NOT NULL AND "commission_pct" > 0 AND "commission_pct" <= 100
     AND "price_per_day_paise" IS NULL));
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_cancelled_check"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_pauses_check" CHECK (jsonb_typeof("pauses_json") = 'array');
