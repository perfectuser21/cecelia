/**
 * pm2 ecosystem for skill-eval-daemon
 * 用法：pm2 start packages/brain/scripts/skill-eval-ecosystem.cjs
 */
module.exports = {
  apps: [
    {
      name: 'skill-eval-daemon',
      script: 'packages/brain/scripts/skill-eval-daemon.mjs',
      cwd: '/Users/administrator/perfect21/cecelia',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      env: {
        NODE_ENV: 'production',
        EVAL_POLL_INTERVAL_MS: '10000',
        EVAL_STUCK_TIMEOUT_MINUTES: '15',
      },
      max_restarts: 20,
      min_uptime: '5s',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/Users/administrator/.pm2/logs/skill-eval-daemon-out.log',
      error_file: '/Users/administrator/.pm2/logs/skill-eval-daemon-err.log',
    },
  ],
};
