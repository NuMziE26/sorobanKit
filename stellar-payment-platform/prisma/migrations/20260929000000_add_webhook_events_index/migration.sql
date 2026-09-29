-- Issue #28: Add WebhookEvent table with an index on the status column.
--
-- The webhook worker polls this table by status on every delivery cycle
-- (WHERE status = 'pending', 'failed', etc.). Without an index that predicate
-- performs a full table scan whose cost grows linearly with event volume.
-- The @@index([status]) on the model translates to the index created below.

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "merchant_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "original_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Serves the worker's polling query: WHERE status = 'pending' / 'failed' /
-- 'dead_letter'. A single-column index on status keeps those scans
-- efficient regardless of table size.
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");
