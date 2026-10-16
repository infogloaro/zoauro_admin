-- doc 59 §4 (owner approved the plan 2026-10-15, D109-D116): optimistic version on platform settings, zone overrides of
-- zone-overridable settings, and Zonal Admin access requests (R13). Additive only: the existing row security.mfa gets
-- version 1; no other data changes. zoauro_app gets access through the default privileges (infra/initdb/01-roles.sql).

-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('ZONE', 'PERMISSION');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "zone_settings" (
    "zone_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_settings_pkey" PRIMARY KEY ("zone_id","key")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "zone_id" UUID NOT NULL,
    "module" TEXT,
    "action" "AccessAction",
    "reason" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_status_created_at_idx" ON "access_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "access_requests_requester_id_created_at_idx" ON "access_requests"("requester_id", "created_at");

-- AddForeignKey
ALTER TABLE "zone_settings" ADD CONSTRAINT "zone_settings_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_settings" ADD CONSTRAINT "zone_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Written by hand (Prisma cannot express them):
-- one open request per requester + zone + permission (doc 59 §4). NULLS NOT DISTINCT (PostgreSQL 15+) so that two
-- pending ZONE requests (module and action null) also collide; no expression, so no IMMUTABLE requirement.
CREATE UNIQUE INDEX "access_requests_one_pending"
  ON "access_requests" ("requester_id", "zone_id", "kind", "module", "action") NULLS NOT DISTINCT
  WHERE "status" = 'PENDING';

-- a PERMISSION request names one module action; a ZONE request names none
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_kind_fields_check" CHECK (
  ("kind" = 'PERMISSION' AND "module" IS NOT NULL AND "action" IS NOT NULL)
  OR ("kind" = 'ZONE' AND "module" IS NULL AND "action" IS NULL)
);
