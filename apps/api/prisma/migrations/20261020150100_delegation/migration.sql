-- D178 delegation, final design (owner): several primary Super Admins may exist (the service keeps at least one);
-- a primary delegates Control Panel areas (keys) to non-primary Super Admins, for all zones. Corrected before it was
-- applied anywhere: no one-primary index, no zone on control_grants, no super_admin_requests (doc 32).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "control_grants" (
    "id" UUID NOT NULL,
    "grantee_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "control_grants_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_grants" ADD CONSTRAINT "control_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Written by hand (D178).
-- one active grant per grantee and key
CREATE UNIQUE INDEX "control_grants_one_active"
  ON "control_grants" ("grantee_id", "key") WHERE "revoked_at" IS NULL;
-- data step: the oldest live, active Super Admin becomes a primary one (none when there is no Super Admin yet)
UPDATE "users" SET "is_primary" = true
  WHERE "id" = (
    SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."role_id"
    WHERE r."name" = 'SUPER_ADMIN' AND u."deleted_at" IS NULL AND u."status" = 'ACTIVE'
    ORDER BY u."created_at", u."id" LIMIT 1
  );
