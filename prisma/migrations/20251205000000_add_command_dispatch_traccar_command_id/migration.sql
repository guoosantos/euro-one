ALTER TABLE "command_dispatches"
ADD COLUMN IF NOT EXISTS "traccarCommandId" INTEGER;

CREATE INDEX IF NOT EXISTS "command_dispatches_traccarCommandId_idx"
  ON "command_dispatches"("traccarCommandId");
