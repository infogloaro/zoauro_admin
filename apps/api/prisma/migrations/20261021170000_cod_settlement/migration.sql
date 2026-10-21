-- M14 COD settlement (doc 16 §2, doc 42, D173): a hand-over reported by the partner app waits as PENDING until a Zonal
-- Admin counts the cash and confirms it (or rejects it); an admin can also record a counted hand-in directly
-- (CONFIRMED at once). Existing rows were recorded by admins, so they stay CONFIRMED / ADMIN.

-- CreateEnum
CREATE TYPE "CashSettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "cash_settlements" ADD COLUMN     "status" "CashSettlementStatus" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "reported_amount" INTEGER,
ADD COLUMN     "reported_at" TIMESTAMPTZ,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "settled_by" DROP NOT NULL,
ALTER COLUMN "settled_at" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cash_settlements_idempotency_key_key" ON "cash_settlements"("idempotency_key");

-- CreateIndex
CREATE INDEX "cash_settlements_zone_id_status_created_at_idx" ON "cash_settlements"("zone_id", "status", "created_at" DESC);
