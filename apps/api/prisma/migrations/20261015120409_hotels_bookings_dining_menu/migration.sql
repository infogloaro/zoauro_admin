-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiningStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "MenuApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DietaryType" AS ENUM ('VEGETARIAN', 'NON_VEG', 'EGG');

-- AlterEnum
ALTER TYPE "VendorType" ADD VALUE 'HOTEL';

-- CreateTable
CREATE TABLE "hotels" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "area" VARCHAR(80),
    "total_rooms" INTEGER NOT NULL,
    "commission_pct" DOUBLE PRECISION,
    "gst_no" VARCHAR(20),
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_note" VARCHAR(300),
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

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
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3) NOT NULL,
    "guests" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

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
    "reserved_date" TIMESTAMP(3) NOT NULL,
    "reserved_time" VARCHAR(5) NOT NULL,
    "guests" INTEGER NOT NULL,
    "table_area" VARCHAR(80),
    "status" "DiningStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "vendor_type" "VendorType" NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" VARCHAR(300),
    "category" VARCHAR(60),
    "price" INTEGER NOT NULL,
    "dietary" "DietaryType" NOT NULL,
    "approval_status" "MenuApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" VARCHAR(300),
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotels_zone_id_status_idx" ON "hotels"("zone_id", "status");

-- CreateIndex
CREATE INDEX "hotels_zone_id_created_at_idx" ON "hotels"("zone_id", "created_at");

-- CreateIndex
CREATE INDEX "hotels_status_idx" ON "hotels"("status");

-- CreateIndex
CREATE INDEX "hotels_verification_status_idx" ON "hotels"("verification_status");

-- CreateIndex
CREATE INDEX "room_bookings_zone_id_status_idx" ON "room_bookings"("zone_id", "status");

-- CreateIndex
CREATE INDEX "room_bookings_hotel_id_check_in_idx" ON "room_bookings"("hotel_id", "check_in");

-- CreateIndex
CREATE INDEX "room_bookings_status_idx" ON "room_bookings"("status");

-- CreateIndex
CREATE INDEX "room_bookings_payment_status_idx" ON "room_bookings"("payment_status");

-- CreateIndex
CREATE INDEX "dining_reservations_zone_id_status_idx" ON "dining_reservations"("zone_id", "status");

-- CreateIndex
CREATE INDEX "dining_reservations_hotel_id_reserved_date_idx" ON "dining_reservations"("hotel_id", "reserved_date");

-- CreateIndex
CREATE INDEX "dining_reservations_restaurant_id_idx" ON "dining_reservations"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_items_zone_id_approval_status_idx" ON "menu_items"("zone_id", "approval_status");

-- CreateIndex
CREATE INDEX "menu_items_vendor_type_vendor_id_idx" ON "menu_items"("vendor_type", "vendor_id");

-- CreateIndex
CREATE INDEX "menu_items_approval_status_idx" ON "menu_items"("approval_status");

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_reservations" ADD CONSTRAINT "dining_reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
