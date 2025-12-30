-- Add isTarget flag to geofence
ALTER TABLE "geofence"
ADD COLUMN IF NOT EXISTS "isTarget" BOOLEAN NOT NULL DEFAULT false;
