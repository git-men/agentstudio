module.exports = {
  apps: [{
    name: 'clawstudio',
    cwd: '/opt/clawstudio/backend',
    script: 'dist/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: '80',
      HOME: '/data',
      ENGINE: 'claude-internal-sdk',
      CORS_ALLOWED_DOMAINS: 'devcloud.woa.com,woa.com,tas.woa.com',
    },
    max_restarts: 10,
    restart_delay: 3000,
  }],
};
