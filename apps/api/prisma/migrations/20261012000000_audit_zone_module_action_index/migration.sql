-- M04 (AU-4): zone + module + action filters (doc 50 section 8, TC-AUD-25) with few or no matches.
-- (zone_id, module, id DESC) finds the rows of a zone and module, but `action` is not in it, so every one of them (about
-- 8,000 per zone and module at 2,000,000 rows) was fetched from the table only to be discarded: p95 1.3 s measured.
-- With action in the index a filter without a match ends in the index.
CREATE INDEX "audit_logs_zone_id_module_action_id_idx" ON "audit_logs"("zone_id", "module", "action", "id" DESC);
