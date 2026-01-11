module.exports = {
  apps: [
    {
      name: "euro-one-server",
      cwd: "/home/ubuntu/euro-one/server",
      script: "index.js",
      interpreter: "node",

      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3001",

        DATABASE_URL:
          "postgresql://euroone:ESjammer2023@127.0.0.1:5432/euroone?schema=public",

        TRACCAR_BASE_URL: "http://127.0.0.1:8082",
        TRACCAR_ADMIN_USER: "admin",
        TRACCAR_ADMIN_PASSWORD: "admin",
        TRACCAR_SYNC_INTERVAL_MS: "300000",

        TRACCAR_DB_CLIENT: "mysql",
        TRACCAR_DB_HOST: "127.0.0.1",
        TRACCAR_DB_PORT: "3306",
        TRACCAR_DB_USER: "euroone",
        TRACCAR_DB_PASSWORD: "EuroTraccar#2024!",
        TRACCAR_DB_NAME: "traccar",

        JWT_SECRET:
          "8f4c6e9b3a0f4c7d9e2b1a5f8c9e7d6a4b3c2d1e9f0a8b7c6d5e4f3a2b1",
        JWT_EXPIRES_IN: "7d",

        ALLOWED_ORIGINS:
          "http://3.19.229.124:5189,http://localhost:5189,http://127.0.0.1:5189,http://localhost:5173,http://127.0.0.1:5173",

        GEOCODE_REDIS_URL: process.env.GEOCODE_REDIS_URL,

        XDM_AUTH_URL: process.env.XDM_AUTH_URL,
        XDM_BASE_URL: process.env.XDM_BASE_URL,
        XDM_CLIENT_ID: process.env.XDM_CLIENT_ID,
        XDM_CLIENT_SECRET: process.env.XDM_CLIENT_SECRET,
        XDM_AUTH_MODE: process.env.XDM_AUTH_MODE,
        XDM_OAUTH_SCOPE: process.env.XDM_OAUTH_SCOPE,
        XDM_OAUTH_AUDIENCE: process.env.XDM_OAUTH_AUDIENCE,
        XDM_DEALER_ID: process.env.XDM_DEALER_ID,
        XDM_CONFIG_ID: process.env.XDM_CONFIG_ID,
        XDM_CONFIG_NAME: process.env.XDM_CONFIG_NAME,
        XDM_GEOZONE_GROUP_OVERRIDE_ID: process.env.XDM_GEOZONE_GROUP_OVERRIDE_ID,
        XDM_GEOZONE_GROUP_OVERRIDE_KEY: process.env.XDM_GEOZONE_GROUP_OVERRIDE_KEY,
        XDM_TIMEOUT_MS: process.env.XDM_TIMEOUT_MS,
        XDM_MAX_RETRIES: process.env.XDM_MAX_RETRIES,
        XDM_RETRY_BASE_MS: process.env.XDM_RETRY_BASE_MS,
        XDM_DEPLOYMENT_POLL_INTERVAL_MS: process.env.XDM_DEPLOYMENT_POLL_INTERVAL_MS,
        XDM_DEPLOYMENT_TIMEOUT_MS: process.env.XDM_DEPLOYMENT_TIMEOUT_MS,
        XDM_GEOFENCE_MAX_POINTS: process.env.XDM_GEOFENCE_MAX_POINTS,
      },
    },
  ],
};
