-- D154, D199: auto-assign attempt state per order (additive only). One row per READY order the engine has tried:
-- how many tries, when the next is due, and when it gave up (fallback to manual). No change to orders or offers.

CREATE TABLE "order_auto_assign_state" (
    "order_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fallback_at" TIMESTAMPTZ,
    "last_outcome" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_auto_assign_state_pkey" PRIMARY KEY ("order_id"),
    CONSTRAINT "order_auto_assign_state_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "order_auto_assign_state_outcome_check" CHECK ("last_outcome" IS NULL OR "last_outcome" IN ('ASSIGNED', 'NO_PARTNER'))
);

ALTER TABLE "order_auto_assign_state" ADD CONSTRAINT "order_auto_assign_state_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_auto_assign_state" ADD CONSTRAINT "order_auto_assign_state_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- the sweep's "who is due" lookup; rows that fell back are never due again
CREATE INDEX "order_auto_assign_state_due" ON "order_auto_assign_state" ("zone_id", "next_attempt_at") WHERE "fallback_at" IS NULL;
