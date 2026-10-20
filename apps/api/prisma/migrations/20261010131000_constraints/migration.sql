-- F1.1: constraints and partial indexes from doc 08 that schema.prisma cannot express (the trigram indexes are declared in schema.prisma). Run by the migration role (zoauro_owner).

-- Partial unique indexes where deleted_at IS NULL ("emails, codes", doc 08 Indexes and constraints).
CREATE UNIQUE INDEX users_email_active_key  ON users   (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX zones_code_active_key   ON zones   (code)  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX coupons_code_active_key ON coupons (code)  WHERE deleted_at IS NULL;

-- admin_zone_assignments: one active row per member and zone; a zone's team = active rows (doc 08, D3).
CREATE UNIQUE INDEX admin_zone_assignments_active_key ON admin_zone_assignments (user_id, zone_id) WHERE revoked_at IS NULL;
CREATE INDEX admin_zone_assignments_zone_active_idx   ON admin_zone_assignments (zone_id) WHERE revoked_at IS NULL;

-- CHECK: exactly one vendor (menu_items, orders).
ALTER TABLE menu_items ADD CONSTRAINT menu_items_one_vendor_chk
  CHECK ((restaurant_id IS NOT NULL AND homemaker_id IS NULL) OR (restaurant_id IS NULL AND homemaker_id IS NOT NULL));
ALTER TABLE orders ADD CONSTRAINT orders_one_vendor_chk
  CHECK ((restaurant_id IS NOT NULL AND homemaker_id IS NULL) OR (restaurant_id IS NULL AND homemaker_id IS NOT NULL));

-- CHECK: zone_id is only null while the zone assignment is UNASSIGNED (v2.0 column additions).
ALTER TABLE restaurants ADD CONSTRAINT restaurants_zone_chk
  CHECK (zone_id IS NOT NULL OR zone_assignment_status = 'UNASSIGNED');
ALTER TABLE homemakers ADD CONSTRAINT homemakers_zone_chk
  CHECK (zone_id IS NOT NULL OR zone_assignment_status = 'UNASSIGNED');
ALTER TABLE delivery_partners ADD CONSTRAINT delivery_partners_zone_chk
  CHECK (zone_id IS NOT NULL OR zone_assignment_status = 'UNASSIGNED');

-- CHECK: homemakers.daily_capacity is an int >= 1.
ALTER TABLE homemakers ADD CONSTRAINT homemakers_daily_capacity_chk CHECK (daily_capacity >= 1);
