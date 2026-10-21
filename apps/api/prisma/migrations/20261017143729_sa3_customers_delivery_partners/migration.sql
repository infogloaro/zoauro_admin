-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('APP', 'ADMIN', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('CUSTOMER');

-- CreateEnum
CREATE TYPE "DeliveryPartnerStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "CustomerSource" NOT NULL DEFAULT 'APP',
    "user_type" "UserType" NOT NULL DEFAULT 'CUSTOMER',
    "wallet_balance" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" VARCHAR(40),
    "address" VARCHAR(240) NOT NULL,
    "area" VARCHAR(80),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "pincode" VARCHAR(6),
    "zone_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_partners" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicle_type" VARCHAR(40) NOT NULL,
    "vehicle_no" VARCHAR(20),
    "area" VARCHAR(80),
    "status" "DeliveryPartnerStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "force_offline_until" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "current_orders" INTEGER NOT NULL DEFAULT 0,
    "cash_in_hand" INTEGER NOT NULL DEFAULT 0,
    "rating_avg" DOUBLE PRECISION,
    "deliveries_count" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_partners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_source_idx" ON "customers"("source");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- CreateIndex
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

-- CreateIndex
CREATE INDEX "customer_addresses_zone_id_idx" ON "customer_addresses"("zone_id");

-- CreateIndex
CREATE INDEX "customer_addresses_zone_id_area_idx" ON "customer_addresses"("zone_id", "area");

-- CreateIndex
CREATE INDEX "delivery_partners_zone_id_status_idx" ON "delivery_partners"("zone_id", "status");

-- CreateIndex
CREATE INDEX "delivery_partners_zone_id_created_at_idx" ON "delivery_partners"("zone_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_partners_status_idx" ON "delivery_partners"("status");

-- CreateIndex
CREATE INDEX "delivery_partners_is_online_idx" ON "delivery_partners"("is_online");

-- CreateIndex
CREATE INDEX "delivery_partners_created_at_idx" ON "delivery_partners"("created_at");

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_partners" ADD CONSTRAINT "delivery_partners_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
