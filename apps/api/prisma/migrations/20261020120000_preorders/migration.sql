-- D150/D167 pre-orders on orders (hotels/pre-orders builder). The delivery point is plain columns until PostGIS (D164).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_address" TEXT,
ADD COLUMN     "delivery_lat" DECIMAL(9,6),
ADD COLUMN     "delivery_lng" DECIMAL(9,6),
ADD COLUMN     "dispatch_at" TIMESTAMPTZ,
ADD COLUMN     "released_at" TIMESTAMPTZ,
ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduled_for" TIMESTAMPTZ;



-- Written by hand.
ALTER TABLE "orders" ADD CONSTRAINT "orders_dispatch_before_slot_check"
  CHECK ("dispatch_at" IS NULL OR "scheduled_for" IS NULL OR "dispatch_at" <= "scheduled_for");
ALTER TABLE "orders" ADD CONSTRAINT "orders_reschedule_count_check" CHECK ("reschedule_count" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_point_check" CHECK (
  ("delivery_lat" IS NULL AND "delivery_lng" IS NULL)
  OR ("delivery_lat" BETWEEN -90 AND 90 AND "delivery_lng" BETWEEN -180 AND 180)
);
-- the dispatch job reads scheduled orders that are not released yet
CREATE INDEX "orders_preorders_due"
  ON "orders" ("dispatch_at")
  WHERE "scheduled_for" IS NOT NULL AND "released_at" IS NULL AND "status" = 'PLACED';
