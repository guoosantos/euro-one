module.exports = {
  apps: [
    {
      name: "euro-one-server",
      cwd: "./server",
      script: "index.js",
      env_file: ".env",
      env: {
        NODE_ENV: process.env.NODE_ENV || "production",
      },
    },
  ],
};
