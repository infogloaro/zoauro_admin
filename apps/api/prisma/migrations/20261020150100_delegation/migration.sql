-- D178 delegation (control-panel session): the primary Super Admin, control grants, Super Admin account requests.

-- CreateEnum
CREATE TYPE "SuperAdminRequestKind" AS ENUM ('CREATE', 'SUSPEND', 'REACTIVATE', 'DELETE', 'DEMOTE');

-- CreateEnum
CREATE TYPE "SuperAdminRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "control_grants" (
    "id" UUID NOT NULL,
    "grantee_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "zone_id" UUID,
    "reason" TEXT NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "control_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_requests" (
    "id" UUID NOT NULL,
    "kind" "SuperAdminRequestKind" NOT NULL,
    "target_user_id" UUID,
    "payload_json" JSONB,
    "password_hash" TEXT,
    "reason" TEXT NOT NULL,
    "status" "SuperAdminRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "super_admin_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_requests" ADD CONSTRAINT "super_admin_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_requests" ADD CONSTRAINT "super_admin_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_requests" ADD CONSTRAINT "super_admin_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Written by hand (D178).
-- one primary Super Admin among live accounts
CREATE UNIQUE INDEX "users_one_primary" ON "users" ("is_primary") WHERE "is_primary" AND "deleted_at" IS NULL;
-- one active grant per grantee, key and zone (null zone = all zones)
CREATE UNIQUE INDEX "control_grants_one_active"
  ON "control_grants" ("grantee_id", "key", COALESCE("zone_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "revoked_at" IS NULL;
-- one pending request per kind and target (CREATE requests have no target and may be several)
CREATE UNIQUE INDEX "super_admin_requests_one_pending"
  ON "super_admin_requests" ("kind", COALESCE("target_user_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" = 'PENDING' AND "kind" <> 'CREATE';
-- data step: the oldest live, active Super Admin becomes the primary one (none when there is no Super Admin yet)
UPDATE "users" SET "is_primary" = true
  WHERE "id" = (
    SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."role_id"
    WHERE r."name" = 'SUPER_ADMIN' AND u."deleted_at" IS NULL AND u."status" = 'ACTIVE'
    ORDER BY u."created_at", u."id" LIMIT 1
  );
