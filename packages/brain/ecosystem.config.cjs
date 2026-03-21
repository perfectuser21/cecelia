module.exports = {
  apps: [{
    name: 'cecelia-brain',
    script: 'server.js',
    cwd: '/Users/administrator/perfect21/cecelia/packages/brain',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5221,
    },
    error_file: '/tmp/cecelia-brain-error.log',
    out_file: '/tmp/cecelia-brain-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_size: '50M',
    retain: 5,
  }]
};
