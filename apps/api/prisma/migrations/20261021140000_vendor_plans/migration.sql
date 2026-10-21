-- CreateEnum
CREATE TYPE "VendorPlanCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "VendorPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "VendorPlanSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "vendor_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_paise" INTEGER NOT NULL,
    "cycle" "VendorPlanCycle" NOT NULL,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "vendor_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "zone_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "VendorPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vendor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_plan_features" (
    "plan_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "value" INTEGER,

    CONSTRAINT "vendor_plan_features_pkey" PRIMARY KEY ("plan_id","feature")
);

-- CreateTable
CREATE TABLE "vendor_plan_subscriptions" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "restaurant_id" UUID,
    "homemaker_id" UUID,
    "hotel_id" UUID,
    "zone_id" UUID NOT NULL,
    "status" "VendorPlanSubscriptionStatus" NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "price_paise" INTEGER NOT NULL,
    "plan_snapshot_json" JSONB NOT NULL,
    "source" "RecordSource" NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vendor_plan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_plans_code_key" ON "vendor_plans"("code");

-- CreateIndex
CREATE INDEX "vendor_plans_status_sort_order_idx" ON "vendor_plans"("status", "sort_order");

-- CreateIndex
CREATE INDEX "vendor_plan_subscriptions_plan_id_status_idx" ON "vendor_plan_subscriptions"("plan_id", "status");

-- CreateIndex
CREATE INDEX "vendor_plan_subscriptions_zone_id_status_idx" ON "vendor_plan_subscriptions"("zone_id", "status");

-- CreateIndex
CREATE INDEX "vendor_plan_subscriptions_restaurant_id_idx" ON "vendor_plan_subscriptions"("restaurant_id");

-- CreateIndex
CREATE INDEX "vendor_plan_subscriptions_homemaker_id_idx" ON "vendor_plan_subscriptions"("homemaker_id");

-- CreateIndex
CREATE INDEX "vendor_plan_subscriptions_hotel_id_idx" ON "vendor_plan_subscriptions"("hotel_id");

-- AddForeignKey
ALTER TABLE "vendor_plan_features" ADD CONSTRAINT "vendor_plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "vendor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "vendor_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_homemaker_id_fkey" FOREIGN KEY ("homemaker_id") REFERENCES "homemakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D188 constraints Prisma cannot express
ALTER TABLE "vendor_plans" ADD CONSTRAINT "vendor_plans_price_check" CHECK ("price_paise" >= 0);
ALTER TABLE "vendor_plans" ADD CONSTRAINT "vendor_plans_trial_days_check" CHECK ("trial_days" >= 0);
ALTER TABLE "vendor_plans" ADD CONSTRAINT "vendor_plans_vendor_types_check"
  CHECK ("vendor_types" <@ ARRAY['RESTAURANT', 'HOMEMAKER', 'HOTEL']::TEXT[]);
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_price_check" CHECK ("price_paise" >= 0);
-- exactly one vendor per subscription
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_one_vendor_check"
  CHECK (num_nonnulls("restaurant_id", "homemaker_id", "hotel_id") = 1);
ALTER TABLE "vendor_plan_subscriptions" ADD CONSTRAINT "vendor_plan_subscriptions_period_check"
  CHECK ("ends_at" IS NULL OR "ends_at" >= "started_at");
-- at most one TRIAL or ACTIVE subscription per vendor
CREATE UNIQUE INDEX "vendor_plan_subscriptions_open_restaurant" ON "vendor_plan_subscriptions" ("restaurant_id")
  WHERE "status" IN ('TRIAL', 'ACTIVE') AND "restaurant_id" IS NOT NULL;
CREATE UNIQUE INDEX "vendor_plan_subscriptions_open_homemaker" ON "vendor_plan_subscriptions" ("homemaker_id")
  WHERE "status" IN ('TRIAL', 'ACTIVE') AND "homemaker_id" IS NOT NULL;
CREATE UNIQUE INDEX "vendor_plan_subscriptions_open_hotel" ON "vendor_plan_subscriptions" ("hotel_id")
  WHERE "status" IN ('TRIAL', 'ACTIVE') AND "hotel_id" IS NOT NULL;
