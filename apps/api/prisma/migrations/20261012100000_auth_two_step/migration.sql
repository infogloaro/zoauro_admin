-- M01 (doc 52 section 3): 2-step verification tables, session and login-history columns; users loses the two
-- single-column MFA fields (users had 0 rows when this was written, so nothing is migrated).
-- Generated with prisma migrate diff (schema to schema, no database), plus the partial unique index at the end.

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('AUTHENTICATOR', 'EMAIL_OTP', 'SMS_OTP');

-- CreateEnum
CREATE TYPE "MfaPurpose" AS ENUM ('LOGIN', 'ENROL_PROOF', 'ENROL_EMAIL', 'ENROL_SMS', 'REAUTH');

-- AlterTable
ALTER TABLE "users" DROP COLUMN "backup_codes_hash",
DROP COLUMN "mfa_secret_encrypted",
ADD COLUMN     "password_changed_at" TIMESTAMPTZ,
ADD COLUMN     "phone_verified_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfa_method" TEXT,
ADD COLUMN     "mfa_verified_at" TIMESTAMPTZ,
ADD COLUMN     "reauth_at" TIMESTAMPTZ,
ADD COLUMN     "reauth_level" TEXT,
ADD COLUMN     "remember" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restricted" TEXT;

-- AlterTable
ALTER TABLE "login_history" ADD COLUMN     "mfa_method" TEXT;

-- CreateTable
CREATE TABLE "user_mfa_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "MfaType" NOT NULL,
    "secret_encrypted" TEXT,
    "verified_at" TIMESTAMPTZ,
    "last_used_step" BIGINT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "disabled_at" TIMESTAMPTZ,

    CONSTRAINT "user_mfa_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "MfaPurpose" NOT NULL,
    "method" "MfaType" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "destination_hint" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "send_count" INTEGER NOT NULL,
    "last_sent_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "ip" INET,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_backup_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_mfa_methods_user_id_idx" ON "user_mfa_methods"("user_id");

-- CreateIndex
CREATE INDEX "mfa_challenges_user_id_purpose_method_created_at_idx" ON "mfa_challenges"("user_id", "purpose", "method", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mfa_challenges_expires_at_idx" ON "mfa_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "mfa_backup_codes_user_id_used_at_idx" ON "mfa_backup_codes"("user_id", "used_at");

-- AddForeignKey
ALTER TABLE "user_mfa_methods" ADD CONSTRAINT "user_mfa_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma cannot express it): one active method per type per user (doc 52 section 3).
CREATE UNIQUE INDEX "user_mfa_methods_user_id_type_active_key" ON "user_mfa_methods" ("user_id", "type") WHERE "disabled_at" IS NULL;
