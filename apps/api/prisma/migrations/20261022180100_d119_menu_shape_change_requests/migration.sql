-- D119 (owner-decided 2026-10-17): menu items keep the documented shape —
-- stock, availability, featured, image and admin_disabled. `stock` is
-- nullable so an existing/untracked item stays live until the vendor starts
-- counting (D126: live = available AND in stock AND not admin-disabled).

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "stock" INTEGER,
ADD COLUMN     "is_available" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image_key" TEXT,
ADD COLUMN     "admin_disabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "admin_override_at" TIMESTAMP(3);

-- Category uniqueness at the database level (task requirement): collapse
-- case/whitespace variants of a category per provider to the earliest row's
-- spelling, then a partial unique index over live rows (NULL categories and
-- soft-deleted rows stay exempt). The partial index is raw SQL because
-- Prisma cannot express WHERE clauses in @@index; recorded in doc 08/32.
WITH ranked AS (
  SELECT
    "id",
    first_value(btrim("category")) OVER (
      PARTITION BY "vendor_type", "vendor_id", lower(btrim("category"))
      ORDER BY "created_at", "id"
    ) AS canonical
  FROM "menu_items"
  WHERE "category" IS NOT NULL AND "deleted_at" IS NULL
)
UPDATE "menu_items" m
SET "category" = r.canonical
FROM ranked r
WHERE m."id" = r."id" AND m."category" IS DISTINCT FROM r.canonical;

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_vendor_category_key"
  ON "menu_items"("vendor_type", "vendor_id", "category")
  WHERE "category" IS NOT NULL AND "deleted_at" IS NULL;

-- R09 / D119: vendor menu change requests (admin approve/reject side).
-- CreateEnum
CREATE TYPE "MenuChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "MenuChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "menu_item_change_requests" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "kind" "MenuChangeKind" NOT NULL,
    "status" "MenuChangeStatus" NOT NULL DEFAULT 'PENDING',
    "proposed_json" JSONB NOT NULL,
    "base_json" JSONB,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_item_change_requests_zone_id_status_created_at_idx" ON "menu_item_change_requests"("zone_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "menu_item_change_requests_menu_item_id_idx" ON "menu_item_change_requests"("menu_item_id");

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
