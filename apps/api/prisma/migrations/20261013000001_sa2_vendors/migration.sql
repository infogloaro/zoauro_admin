-- M06/M07 vendors (doc 08 "Vendors and menu"): restaurants, homemakers and
-- vendor_documents. Generated with `prisma migrate diff` against the SA-1.1
-- schema; safe to apply on top of 20261010000001_init_sa11.
-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('RESTAURANT', 'HOMEMAKER');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "area" VARCHAR(80),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "cuisine_tags" TEXT[],
    "commission_pct" DOUBLE PRECISION,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_note" VARCHAR(300),
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "opening_hours_json" JSONB,
    "logo_key" TEXT,
    "min_order" INTEGER,
    "gst_no" VARCHAR(20),
    "fssai_no" VARCHAR(20),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homemakers" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "area" VARCHAR(80),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "speciality_tags" TEXT[],
    "food_category" VARCHAR(60),
    "experience_years" INTEGER,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "daily_capacity" INTEGER,
    "commission_pct" DOUBLE PRECISION,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_note" VARCHAR(300),
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "opening_hours_json" JSONB,
    "photo_key" TEXT,
    "min_order" INTEGER,
    "fssai_no" VARCHAR(20),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homemakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" UUID NOT NULL,
    "vendor_type" "VendorType" NOT NULL,
    "vendor_id" UUID NOT NULL,
    "doc_type" VARCHAR(40) NOT NULL,
    "file_key" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "rejection_note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurants_zone_id_status_idx" ON "restaurants"("zone_id", "status");

-- CreateIndex
CREATE INDEX "restaurants_zone_id_created_at_idx" ON "restaurants"("zone_id", "created_at");

-- CreateIndex
CREATE INDEX "restaurants_status_idx" ON "restaurants"("status");

-- CreateIndex
CREATE INDEX "restaurants_verification_status_idx" ON "restaurants"("verification_status");

-- CreateIndex
CREATE INDEX "homemakers_zone_id_status_idx" ON "homemakers"("zone_id", "status");

-- CreateIndex
CREATE INDEX "homemakers_zone_id_created_at_idx" ON "homemakers"("zone_id", "created_at");

-- CreateIndex
CREATE INDEX "homemakers_status_idx" ON "homemakers"("status");

-- CreateIndex
CREATE INDEX "homemakers_verification_status_idx" ON "homemakers"("verification_status");

-- CreateIndex
CREATE INDEX "vendor_documents_vendor_type_vendor_id_idx" ON "vendor_documents"("vendor_type", "vendor_id");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homemakers" ADD CONSTRAINT "homemakers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
