-- M04: prefix search for GET /audit-logs?q= (doc 50 §8). Expression indexes cannot be declared in schema.prisma, so they live here.
-- Query shape: WHERE lower(entity_label) LIKE lower($q) || '%' OR lower(actor_name) LIKE lower($q) || '%'
-- Without them a q with few or no matches scans the whole table (measured: 1.8 s at 2,000,000 rows; 0.06 ms with the indexes).
CREATE INDEX audit_logs_label_idx     ON audit_logs (lower(entity_label) text_pattern_ops);
CREATE INDEX audit_logs_actorname_idx ON audit_logs (lower(actor_name)   text_pattern_ops);
