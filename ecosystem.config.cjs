// PM2 process definition. Deployed by deploy/deploy.sh; env comes from
// .env.production in the app directory (loaded via dotenv at boot by Next).
module.exports = {
  apps: [
    {
      name: "smartcogen",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1200M",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
