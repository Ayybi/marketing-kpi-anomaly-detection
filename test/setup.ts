// Point the DB layer at a throwaway test database on the running mongod BEFORE any src module
// (which reads these env vars at import time) is loaded. Integration tests use a real MongoDB so
// the partial unique indexes, $jsonSchema validators, and reconcile queries are exercised for real.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017"
process.env.MONGODB_DB = "kpi_engine_test"
process.env.CRON_SECRET ??= "test-cron-secret"
