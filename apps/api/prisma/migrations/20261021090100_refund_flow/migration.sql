-- D180 refund flow (D146, D152, D187): zone, source, reported items and photos, fault and vendor share, auto-approval,
-- decision time limit, second approver (D95), manual UPI reference, processing; the vendor fault share % per vendor.

-- CreateEnum
CREATE TYPE "RefundFault" AS ENUM ('VENDOR', 'PLATFORM', 'CUSTOMER');


-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "refund_fault_share_pct" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "homemakers" ADD COLUMN     "refund_fault_share_pct" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "auto_approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decide_by" TIMESTAMPTZ,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "fault" "RefundFault",
ADD COLUMN     "items_json" JSONB,
ADD COLUMN     "manual_reference" TEXT,
ADD COLUMN     "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "processed_at" TIMESTAMPTZ,
ADD COLUMN     "second_approved_at" TIMESTAMPTZ,
ADD COLUMN     "second_approved_by" UUID,
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "vendor_share_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendor_share_pct" DECIMAL(5,2),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "zone_id" UUID,
ALTER COLUMN "requested_by" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "refunds_zone_id_status_requested_at_idx" ON "refunds"("zone_id", "status", "requested_at" DESC);

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_second_approved_by_fkey" FOREIGN KEY ("second_approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Written by hand (D180, D187).
-- every refund belongs to its order's zone (scope, D25); existing rows take it from the order
UPDATE "refunds" r SET "zone_id" = o."zone_id" FROM "orders" o WHERE o."id" = r."order_id";
ALTER TABLE "refunds" ALTER COLUMN "zone_id" SET NOT NULL;

-- an admin-created refund names its requester; only a customer's report from the app may leave it empty
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requester_check"
  CHECK ("requested_by" IS NOT NULL OR "source" = 'APP');
-- segregation of duties (doc 16): nobody approves their own refund; the second approver is a third person
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approver_check"
  CHECK ("approved_by" IS NULL OR "requested_by" IS NULL OR "approved_by" <> "requested_by");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_second_approver_check"
  CHECK ("second_approved_by" IS NULL OR (
    "second_approved_by" <> COALESCE("approved_by", '00000000-0000-0000-0000-000000000000'::uuid)
    AND "second_approved_by" <> COALESCE("requested_by", '00000000-0000-0000-0000-000000000000'::uuid)
  ));
-- amounts: a refund is positive; the vendor share is within the refund; shares are percentages
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_vendor_share_check"
  CHECK ("vendor_share_paise" >= 0 AND "vendor_share_paise" <= "amount");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_vendor_share_pct_check"
  CHECK ("vendor_share_pct" IS NULL OR "vendor_share_pct" BETWEEN 0 AND 100);
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_refund_fault_share_check"
  CHECK ("refund_fault_share_pct" BETWEEN 0 AND 100);
ALTER TABLE "homemakers" ADD CONSTRAINT "homemakers_refund_fault_share_check"
  CHECK ("refund_fault_share_pct" BETWEEN 0 AND 100);
-- the decision timer reads open requests
CREATE INDEX "refunds_open_decide_by" ON "refunds" ("decide_by") WHERE "status" IN ('REQUESTED', 'PENDING_APPROVAL');
