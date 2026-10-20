-- D149 export permission column, reward points and wallet ledgers (owner 2026-10-20), D154 auto-assign offers.

-- CreateEnum
CREATE TYPE "RewardEntryType" AS ENUM ('ORDER_EARN', 'ORDER_REVERSAL', 'MANUAL_GRANT', 'MANUAL_DEDUCT', 'CHECKOUT_REDEEM', 'WALLET_CONVERT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('REWARD_CONVERT', 'REFUND_CREDIT', 'ORDER_DEBIT', 'MANUAL_ADJUST');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');


-- AlterTable
ALTER TABLE "profile_permissions" ADD COLUMN     "can_export" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "reward_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "delivery_partners" ADD COLUMN     "last_lat" DOUBLE PRECISION,
ADD COLUMN     "last_lng" DOUBLE PRECISION,
ADD COLUMN     "last_location_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "reward_point_entries" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zone_id" UUID,
    "type" "RewardEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "remaining" INTEGER,
    "expires_at" TIMESTAMPTZ,
    "order_id" UUID,
    "reason" TEXT,
    "actor_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zone_id" UUID,
    "type" "WalletEntryType" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "balance_after_paise" INTEGER NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "reason" TEXT,
    "actor_id" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignment_offers" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OFFERED',
    "offered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "responded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_assignment_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_point_entries_idempotency_key_key" ON "reward_point_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "reward_point_entries_customer_id_created_at_idx" ON "reward_point_entries"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reward_point_entries_expires_at_idx" ON "reward_point_entries"("expires_at");

-- CreateIndex
CREATE INDEX "reward_point_entries_order_id_idx" ON "reward_point_entries"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_transactions_customer_id_created_at_idx" ON "wallet_transactions"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_ref_type_ref_id_idx" ON "wallet_transactions"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "order_assignment_offers_status_expires_at_idx" ON "order_assignment_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "order_assignment_offers_partner_id_status_idx" ON "order_assignment_offers"("partner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "order_assignment_offers_order_id_rank_key" ON "order_assignment_offers"("order_id", "rank");

-- CreateIndex
CREATE INDEX "delivery_partners_zone_id_last_location_at_idx" ON "delivery_partners"("zone_id", "last_location_at");

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignment_offers" ADD CONSTRAINT "order_assignment_offers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignment_offers" ADD CONSTRAINT "order_assignment_offers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "delivery_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignment_offers" ADD CONSTRAINT "order_assignment_offers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Written by hand.
-- D149 backfill: today export needs only the zone flag; where a profile has it on, give export on every module the
-- profile can view, so nothing changes for existing members (the zone flag stays the master switch).
UPDATE "profile_permissions" pp SET "can_export" = pp."can_view"
  FROM "access_profiles" ap
  WHERE ap."id" = pp."profile_id" AND ap."default_can_export" = true;

-- Reward points and wallet: balances never go below zero; the ledgers carry the balance after each entry.
ALTER TABLE "customers" ADD CONSTRAINT "customers_reward_points_check" CHECK ("reward_points" >= 0);
ALTER TABLE "customers" ADD CONSTRAINT "customers_wallet_balance_check" CHECK ("wallet_balance" >= 0);
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_balance_check" CHECK ("balance_after" >= 0);
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_points_check" CHECK ("points" <> 0);
-- credits carry what is left of them and may expire; debits carry neither
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_credit_fields_check" CHECK (
  ("points" > 0 AND "remaining" IS NOT NULL AND "remaining" BETWEEN 0 AND "points")
  OR ("points" < 0 AND "remaining" IS NULL AND "expires_at" IS NULL)
);
-- one earn credit per order
CREATE UNIQUE INDEX "reward_point_entries_one_earn_per_order"
  ON "reward_point_entries" ("order_id") WHERE "type" = 'ORDER_EARN';
-- the expiry job and oldest-first spending read open credits only
CREATE INDEX "reward_point_entries_open_credits"
  ON "reward_point_entries" ("customer_id", "expires_at") WHERE "remaining" > 0;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_balance_check" CHECK ("balance_after_paise" >= 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_check" CHECK ("amount_paise" <> 0);

-- D154: a partner location is complete or absent, and within range
ALTER TABLE "delivery_partners" ADD CONSTRAINT "delivery_partners_last_location_check" CHECK (
  ("last_lat" IS NULL AND "last_lng" IS NULL AND "last_location_at" IS NULL)
  OR ("last_lat" BETWEEN -90 AND 90 AND "last_lng" BETWEEN -180 AND 180 AND "last_location_at" IS NOT NULL)
);
-- at most one open offer per order
CREATE UNIQUE INDEX "order_assignment_offers_one_open"
  ON "order_assignment_offers" ("order_id") WHERE "status" = 'OFFERED';
