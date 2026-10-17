-- AlterTable
ALTER TABLE "delivery_partners" ADD COLUMN     "email" TEXT,
ADD COLUMN     "verification_note" TEXT,
ADD COLUMN     "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verified_by" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "delivery_partners_zone_id_verification_status_idx" ON "delivery_partners"("zone_id", "verification_status");

-- AddForeignKey
ALTER TABLE "delivery_partners" ADD CONSTRAINT "delivery_partners_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand (D130): partners that were already verified keep that state in the new column
UPDATE "delivery_partners" SET "verification_status" = 'VERIFIED' WHERE "verified_at" IS NOT NULL;
