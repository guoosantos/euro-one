module.exports = {
  apps: [
    {
      name: "euro-one-server",
      cwd: "./server",
      script: "index.js",
      env_file: "../.env",
      env: {
        PORT: String(process.env.PORT || "5189"),
        NODE_ENV: process.env.NODE_ENV || "production",
        HOST: process.env.HOST || "0.0.0.0",
      },
      env_production: {
        PORT: String(process.env.PORT || "5189"),
        NODE_ENV: "production",
        HOST: process.env.HOST || "0.0.0.0",
      },
    },
  ],
};
