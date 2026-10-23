-- AlterTable
ALTER TABLE "homemakers" ADD COLUMN     "review_due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "review_due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendor_documents" ADD COLUMN     "expires_on" DATE;

-- CreateTable
CREATE TABLE "onboarding_requirements" (
    "id" UUID NOT NULL,
    "vendor_type" "VendorType" NOT NULL,
    "doc_type" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_requirements_vendor_type_doc_type_key" ON "onboarding_requirements"("vendor_type", "doc_type");

-- A1 advisory checklist defaults (owner decision 2026-10-22: nothing is a
-- hard activation gate; weights feed the readiness score only).
INSERT INTO "onboarding_requirements" ("id", "vendor_type", "doc_type", "label", "weight", "active", "sort_order", "created_at", "updated_at") VALUES
  ('aaaa0001-0000-4000-8000-000000000001', 'RESTAURANT', 'FSSAI', 'FSSAI license', 30, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000002', 'RESTAURANT', 'GST',   'GST registration (if registered)', 20, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000003', 'RESTAURANT', 'PAN',   'PAN card', 15, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000004', 'RESTAURANT', 'BANK',  'Bank account for payouts', 20, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000005', 'RESTAURANT', 'ID',    'Owner ID proof', 15, true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000006', 'HOMEMAKER',  'ID',    'Owner ID proof', 35, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000007', 'HOMEMAKER',  'FSSAI', 'FSSAI registration (if applicable)', 25, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000008', 'HOMEMAKER',  'BANK',  'Bank account for payouts', 25, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('aaaa0001-0000-4000-8000-000000000009', 'HOMEMAKER',  'PAN',   'PAN (if registered)', 15, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("vendor_type", "doc_type") DO NOTHING;
