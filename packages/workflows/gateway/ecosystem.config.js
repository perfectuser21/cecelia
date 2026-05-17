module.exports = {
  apps: [
    {
      name: 'ai-gateway',
      script: 'ai-gateway.cjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_us: {
        // 美国环境 - Claude Code
        NODE_ENV: 'production',
        GATEWAY_PORT: 9876,
        AI_MODE: 'claude-code'
      },
      env_hk: {
        // 香港环境 - MiniMax
        NODE_ENV: 'production',
        GATEWAY_PORT: 9876,
        AI_MODE: 'minimax',
        MINIMAX_API_KEY: 'your-minimax-api-key',
        MINIMAX_GROUP_ID: 'your-group-id'
      }
    }
  ]
};
