-- Local development only. Real environments create these roles through infrastructure with secrets from the secrets manager.
-- zoauro_owner runs prisma migrate; zoauro_app is what the API and worker connect as; zoauro_purge is used only by the audit retention job.
CREATE ROLE zoauro_owner LOGIN PASSWORD 'zoauro_owner_dev' CREATEDB;
CREATE ROLE zoauro_app   LOGIN PASSWORD 'zoauro_app_dev';
CREATE ROLE zoauro_purge LOGIN PASSWORD 'zoauro_purge_dev';
