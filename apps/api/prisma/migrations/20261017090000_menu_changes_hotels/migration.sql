-- CreateEnum
CREATE TYPE "DietaryType" AS ENUM ('VEGETARIAN', 'NON_VEG', 'EGG');

-- CreateEnum
CREATE TYPE "MenuChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "MenuChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiningStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "admin_override_at" TIMESTAMPTZ,
ADD COLUMN     "dietary" "DietaryType";

-- CreateTable
CREATE TABLE "menu_item_change_requests" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "restaurant_id" UUID,
    "homemaker_id" UUID,
    "external_item_id" TEXT,
    "kind" "MenuChangeKind" NOT NULL,
    "status" "MenuChangeStatus" NOT NULL DEFAULT 'PENDING',
    "proposed_json" JSONB NOT NULL,
    "base_json" JSONB,
    "source" "RecordSource" NOT NULL,
    "submitted_by_client_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "menu_item_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "area" TEXT,
    "total_rooms" INTEGER NOT NULL,
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gst_no" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_note" TEXT,
    "verified_at" TIMESTAMPTZ,
    "verified_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bookings" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "hotel_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "room_type" VARCHAR(40) NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "guests" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "note" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "room_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_reservations" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "hotel_id" UUID,
    "restaurant_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "reserved_date" DATE NOT NULL,
    "reserved_time" VARCHAR(5) NOT NULL,
    "guests" INTEGER NOT NULL,
    "table_area" VARCHAR(80),
    "status" "DiningStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER,
    "note" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "dining_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_item_change_requests_zone_id_status_created_at_idx" ON "menu_item_change_requests"("zone_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "menu_item_change_requests_menu_item_id_idx" ON "menu_item_change_requests"("menu_item_id");

-- CreateIndex
CREATE INDEX "hotels_zone_id_status_idx" ON "hotels"("zone_id", "status");

-- CreateIndex
CREATE INDEX "hotels_zone_id_created_at_idx" ON "hotels"("zone_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "hotels_name_trgm_idx" ON "hotels" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "room_bookings_zone_id_status_idx" ON "room_bookings"("zone_id", "status");

-- CreateIndex
CREATE INDEX "room_bookings_hotel_id_check_in_idx" ON "room_bookings"("hotel_id", "check_in");

-- CreateIndex
CREATE INDEX "dining_reservations_zone_id_status_idx" ON "dining_reservations"("zone_id", "status");

-- CreateIndex
CREATE INDEX "dining_reservations_hotel_id_reserved_date_idx" ON "dining_reservations"("hotel_id", "reserved_date");

-- CreateIndex
CREATE INDEX "dining_reservations_restaurant_id_idx" ON "dining_reservations"("restaurant_id");

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_homemaker_id_fkey" FOREIGN KEY ("homemaker_id") REFERENCES "homemakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_submitted_by_client_id_fkey" FOREIGN KEY ("submitted_by_client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Written by hand (Prisma cannot express them), D118, D119, D124-D127:
-- one open change request per menu item, and one open CREATE per app client and external item id
CREATE UNIQUE INDEX "menu_item_change_requests_one_pending_item"
  ON "menu_item_change_requests" ("menu_item_id")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "menu_item_change_requests_one_pending_create"
  ON "menu_item_change_requests" ("submitted_by_client_id", "external_item_id")
  WHERE "status" = 'PENDING' AND "kind" = 'CREATE';

-- a change request belongs to exactly one vendor (restaurant or homemaker), like menu_items
ALTER TABLE "menu_item_change_requests" ADD CONSTRAINT "menu_item_change_requests_one_vendor_check" CHECK (
  ("restaurant_id" IS NOT NULL)::int + ("homemaker_id" IS NOT NULL)::int = 1
);

-- a dining reservation is at exactly one place (hotel or restaurant)
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_one_place_check" CHECK (
  ("hotel_id" IS NOT NULL)::int + ("restaurant_id" IS NOT NULL)::int = 1
);

ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_dates_check" CHECK ("check_out" > "check_in");
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_guests_check" CHECK ("guests" >= 1);
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_guests_check" CHECK ("guests" >= 1);
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_total_rooms_check" CHECK ("total_rooms" >= 0);
