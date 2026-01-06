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
      },
    },
  ],
};
