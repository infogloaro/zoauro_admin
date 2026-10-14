-- D92 (owner, 2026-10-14): per-zone service switches. Additive: one enum, one table, two foreign keys. No data change:
-- a zone without a row uses the default of ZONE_SERVICE_DEFAULTS (@zoauro/shared). zoauro_app gets access through the
-- default privileges of infra/initdb/01-roles.sql.

-- CreateEnum
CREATE TYPE "ZoneServiceKind" AS ENUM ('RESTAURANTS', 'HOME_FOOD', 'HOTEL_BOOKING');

-- CreateTable
CREATE TABLE "zone_services" (
    "zone_id" UUID NOT NULL,
    "service" "ZoneServiceKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "zone_services_pkey" PRIMARY KEY ("zone_id","service")
);

-- AddForeignKey
ALTER TABLE "zone_services" ADD CONSTRAINT "zone_services_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_services" ADD CONSTRAINT "zone_services_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

