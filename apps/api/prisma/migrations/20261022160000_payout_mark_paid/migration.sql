-- F4: payout mark-paid (doc 16 §5, D152): the reference, a note, the amount paid (snapshot) and a version
ALTER TABLE "payouts" ADD COLUMN "paid_reference" TEXT,
ADD COLUMN "paid_note" TEXT,
ADD COLUMN "paid_amount" INTEGER,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_amount_check" CHECK ("paid_amount" IS NULL OR "paid_amount" >= 0);
-- a PAID payout has its paid date (the seeded PAID rows already do)
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_check" CHECK ("status" <> 'PAID' OR "paid_at" IS NOT NULL);
