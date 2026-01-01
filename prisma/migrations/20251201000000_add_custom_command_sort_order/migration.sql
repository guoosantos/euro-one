ALTER TABLE "custom_commands"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "custom_commands_clientId_sortOrder_idx" ON "custom_commands"("clientId", "sortOrder");
