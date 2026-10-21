-- CreateEnum
CREATE TYPE "PartnerSettlementStatus" AS ENUM ('PENDING', 'PARTIAL', 'SETTLED');

-- CreateEnum
CREATE TYPE "ThirdPartyProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED');

-- AlterTable
ALTER TABLE "delivery_partners" ADD COLUMN     "avg_delivery_minutes" INTEGER,
ADD COLUMN     "earnings_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failed_deliveries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "on_time_pct" INTEGER,
ADD COLUMN     "orders_assigned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_status" "PartnerSettlementStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "third_party_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" VARCHAR(40) NOT NULL,
    "contact_person" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "status" "ThirdPartyProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "integration_status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "deliveries_count" INTEGER NOT NULL DEFAULT 0,
    "successful_deliveries" INTEGER NOT NULL DEFAULT 0,
    "failed_deliveries" INTEGER NOT NULL DEFAULT 0,
    "avg_delivery_minutes" INTEGER,
    "provider_cost_paise" INTEGER NOT NULL DEFAULT 0,
    "settlement_status" "PartnerSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_party_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_party_provider_zones" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "third_party_provider_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "third_party_providers_status_idx" ON "third_party_providers"("status");

-- CreateIndex
CREATE INDEX "third_party_providers_created_at_idx" ON "third_party_providers"("created_at");

-- CreateIndex
CREATE INDEX "third_party_provider_zones_zone_id_idx" ON "third_party_provider_zones"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "third_party_provider_zones_provider_id_zone_id_key" ON "third_party_provider_zones"("provider_id", "zone_id");

-- AddForeignKey
ALTER TABLE "third_party_provider_zones" ADD CONSTRAINT "third_party_provider_zones_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "third_party_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_provider_zones" ADD CONSTRAINT "third_party_provider_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
