-- Create geofence groups
CREATE TABLE "geofence_group" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "geofence_group_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "geofence_group_clientId_idx" ON "geofence_group" ("clientId");

ALTER TABLE "geofence_group"
ADD CONSTRAINT "geofence_group_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create geofences
CREATE TABLE "geofence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "color" TEXT,
    "radius" DOUBLE PRECISION,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "points" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "geofence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "geofence_clientId_idx" ON "geofence" ("clientId");
CREATE INDEX "geofence_groupId_idx" ON "geofence" ("groupId");

ALTER TABLE "geofence"
ADD CONSTRAINT "geofence_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "geofence"
ADD CONSTRAINT "geofence_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "geofence_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create routes
CREATE TABLE "route" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "route_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "route_clientId_idx" ON "route" ("clientId");

ALTER TABLE "route"
ADD CONSTRAINT "route_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create route points
CREATE TABLE "route_point" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "route_point_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "route_point_routeId_idx" ON "route_point" ("routeId");
CREATE UNIQUE INDEX "route_point_routeId_order_key" ON "route_point" ("routeId", "order");

ALTER TABLE "route_point"
ADD CONSTRAINT "route_point_routeId_fkey"
FOREIGN KEY ("routeId") REFERENCES "route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
