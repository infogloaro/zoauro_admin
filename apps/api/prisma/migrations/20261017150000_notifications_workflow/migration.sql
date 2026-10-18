-- Notifications workflow (D134-D137), requested by the orders/partners/notifications session.

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('MESSAGE', 'PROMOTION');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING_APPROVAL', 'SCHEDULED', 'SENT', 'CANCELLED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('CUSTOMERS', 'VENDORS', 'PARTNERS', 'ALL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "channels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
ADD COLUMN     "decided_at" TIMESTAMPTZ,
ADD COLUMN     "decided_by" UUID,
ADD COLUMN     "decision_note" TEXT,
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'MESSAGE',
ADD COLUMN     "requested_by" UUID,
ADD COLUMN     "sent_at" TIMESTAMPTZ,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "zone_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ALTER COLUMN "channel" DROP NOT NULL;

-- Written by hand instead of Prisma's DROP COLUMN + ADD COLUMN: convert in place (the table is empty in zoauro, and
-- a value outside the enum fails the migration rather than being lost). channel and zone_id stay, nullable (D136).
ALTER TABLE "notifications"
  ALTER COLUMN "audience" TYPE "NotificationAudience" USING "audience"::"NotificationAudience",
  ALTER COLUMN "status" TYPE "NotificationStatus" USING "status"::"NotificationStatus";

-- CreateTable
CREATE TABLE "notification_zone_sends" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "send_at" TIMESTAMPTZ NOT NULL,
    "status" "NotificationSendStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "emails_failed" INTEGER NOT NULL DEFAULT 0,
    "failure_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_zone_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_zone_sends_status_send_at_idx" ON "notification_zone_sends"("status", "send_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_zone_sends_notification_id_zone_id_key" ON "notification_zone_sends"("notification_id", "zone_id");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_at_idx" ON "notifications"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_zone_sends" ADD CONSTRAINT "notification_zone_sends_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_zone_sends" ADD CONSTRAINT "notification_zone_sends_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

