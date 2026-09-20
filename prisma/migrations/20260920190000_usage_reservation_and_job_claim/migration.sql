DROP INDEX IF EXISTS "UsageLedger_shopId_cycleId_orderGid_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UsageLedger_reservationId_key" ON "UsageLedger"("reservationId");
CREATE INDEX IF NOT EXISTS "Job_status_runAfter_idx" ON "Job"("status", "runAfter");
