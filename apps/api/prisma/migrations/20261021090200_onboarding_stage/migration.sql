-- D170: the vendor onboarding queue stage (shared by restaurants, homemakers and hotels) and when it was entered.

-- CreateEnum
CREATE TYPE "OnboardingStage" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'DECIDED');

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "onboarding_stage" "OnboardingStage" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "onboarding_stage_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "homemakers" ADD COLUMN     "onboarding_stage" "OnboardingStage" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "onboarding_stage_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "onboarding_stage" "OnboardingStage" NOT NULL DEFAULT 'SUBMITTED',
ADD COLUMN     "onboarding_stage_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "restaurants_zone_id_onboarding_stage_onboarding_stage_at_idx" ON "restaurants"("zone_id", "onboarding_stage", "onboarding_stage_at");

-- CreateIndex
CREATE INDEX "homemakers_zone_id_onboarding_stage_onboarding_stage_at_idx" ON "homemakers"("zone_id", "onboarding_stage", "onboarding_stage_at");

-- CreateIndex
CREATE INDEX "hotels_zone_id_onboarding_stage_onboarding_stage_at_idx" ON "hotels"("zone_id", "onboarding_stage", "onboarding_stage_at");



-- Written by hand (D170): vendors already verified or rejected are DECIDED; the rest stay SUBMITTED. The stage clock
-- starts at the vendor's own creation time, so age warnings are right for vendors that were already waiting.
UPDATE "restaurants" SET "onboarding_stage" = 'DECIDED' WHERE "verification_status" <> 'PENDING';
UPDATE "homemakers" SET "onboarding_stage" = 'DECIDED' WHERE "verification_status" <> 'PENDING';
UPDATE "hotels" SET "onboarding_stage" = 'DECIDED' WHERE "verification_status" <> 'PENDING';
UPDATE "restaurants" SET "onboarding_stage_at" = COALESCE("verified_at", "created_at");
UPDATE "homemakers" SET "onboarding_stage_at" = COALESCE("verified_at", "created_at");
UPDATE "hotels" SET "onboarding_stage_at" = COALESCE("verified_at", "created_at");
