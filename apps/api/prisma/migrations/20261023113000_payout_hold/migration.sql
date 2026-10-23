-- D204: hold a payout while something is checked, adjust the amount to pay, record how it was paid (additive)
ALTER TABLE "payouts" ADD COLUMN "hold_reason" TEXT,
ADD COLUMN "held_at" TIMESTAMPTZ,
ADD COLUMN "held_by" UUID,
ADD COLUMN "adjustment_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "adjustment_reason" TEXT,
ADD COLUMN "paid_method" TEXT;

-- an ON_HOLD payout names why, who and when
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_hold_check"
  CHECK ("status" <> 'ON_HOLD' OR ("hold_reason" IS NOT NULL AND "held_at" IS NOT NULL));
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_method_check"
  CHECK ("paid_method" IS NULL OR "paid_method" IN ('NEFT', 'IMPS', 'RTGS', 'UPI', 'CHEQUE'));
