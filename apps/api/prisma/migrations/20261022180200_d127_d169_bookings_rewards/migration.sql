-- D127(6)(7) booking optimistic version column (AGENTS: state writes carry
-- an optimistic version check); D169 reward points + wallet ledgers
-- (owner-decided 2026-10-20): append-only ledgers, balance columns on the
-- customer, no Order FK until the M11 orders table exists.

-- AlterTable
ALTER TABLE "room_bookings" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "dining_reservations" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "reward_points" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "RewardEntryType" AS ENUM ('ORDER_EARN', 'ORDER_REVERSAL', 'MANUAL_GRANT', 'MANUAL_DEDUCT', 'CHECKOUT_REDEEM', 'WALLET_CONVERT', 'EXPIRY');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('REWARD_CONVERT', 'REFUND_CREDIT', 'ORDER_DEBIT', 'MANUAL_ADJUST');

-- CreateTable
CREATE TABLE "reward_point_entries" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zone_id" UUID,
    "type" "RewardEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "remaining" INTEGER,
    "expires_at" TIMESTAMP(3),
    "order_id" UUID,
    "reason" VARCHAR(300),
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "ref_type" VARCHAR(40),
    "ref_id" UUID,
    "reason" VARCHAR(300),
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_point_entries_customer_id_created_at_idx" ON "reward_point_entries"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reward_point_entries_expires_at_idx" ON "reward_point_entries"("expires_at");

-- CreateIndex
CREATE INDEX "reward_point_entries_order_id_idx" ON "reward_point_entries"("order_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_customer_id_created_at_idx" ON "wallet_transactions"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_ref_type_ref_id_idx" ON "wallet_transactions"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_entries" ADD CONSTRAINT "reward_point_entries_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
