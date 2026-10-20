-- D174 record claims (control-panel session): one open claim per record, one pending takeover per claim.

-- CreateEnum
CREATE TYPE "ClaimEntityType" AS ENUM ('HOTEL', 'RESTAURANT', 'HOMEMAKER', 'DELIVERY_PARTNER');

-- CreateEnum
CREATE TYPE "ClaimEndReason" AS ENUM ('RELEASED', 'EXPIRED', 'OVERRIDDEN', 'TAKEN_OVER');

-- CreateEnum
CREATE TYPE "TakeoverStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "record_claims" (
    "id" UUID NOT NULL,
    "entity_type" "ClaimEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "zone_id" UUID,
    "claimed_by" UUID NOT NULL,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "released_at" TIMESTAMPTZ,
    "released_by" UUID,
    "end_reason" "ClaimEndReason",
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "record_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_takeover_requests" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TakeoverStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_takeover_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "record_claims" ADD CONSTRAINT "record_claims_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_claims" ADD CONSTRAINT "record_claims_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_claims" ADD CONSTRAINT "record_claims_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_takeover_requests" ADD CONSTRAINT "claim_takeover_requests_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "record_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_takeover_requests" ADD CONSTRAINT "claim_takeover_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_takeover_requests" ADD CONSTRAINT "claim_takeover_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Written by hand (D174).
ALTER TABLE "record_claims" ADD CONSTRAINT "record_claims_end_check"
  CHECK (("released_at" IS NULL) = ("end_reason" IS NULL));
CREATE UNIQUE INDEX "record_claims_one_open"
  ON "record_claims" ("entity_type", "entity_id") WHERE "released_at" IS NULL;
CREATE INDEX "record_claims_expiry"
  ON "record_claims" ("expires_at") WHERE "released_at" IS NULL;
CREATE UNIQUE INDEX "claim_takeover_one_pending"
  ON "claim_takeover_requests" ("claim_id") WHERE "status" = 'PENDING';
