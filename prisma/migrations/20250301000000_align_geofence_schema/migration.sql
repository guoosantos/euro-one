-- Align geofence schema with application expectations
ALTER TABLE "geofence" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "geofence" ADD COLUMN IF NOT EXISTS "centerLat" DOUBLE PRECISION;
ALTER TABLE "geofence" ADD COLUMN IF NOT EXISTS "centerLng" DOUBLE PRECISION;
ALTER TABLE "geofence" ADD COLUMN IF NOT EXISTS "radius" DOUBLE PRECISION;
ALTER TABLE "geofence" DROP COLUMN IF EXISTS "center";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geofence_groupId_fkey') THEN
        ALTER TABLE "geofence"
        ADD CONSTRAINT "geofence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "geofence_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
