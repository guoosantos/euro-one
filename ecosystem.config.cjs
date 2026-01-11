module.exports = {
  apps: [
    {
      name: "euro-one-server",
      cwd: "/home/ubuntu/euro-one/server",
      script: "index.js",
      interpreter: "node",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
