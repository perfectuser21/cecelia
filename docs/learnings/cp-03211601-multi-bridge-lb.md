# Learning - 多机 Codex Bridge 负载均衡

**Branch**: cp-03211601-multi-bridge-lb

### 根本原因

codex-bridge 原先硬编码了 5 个账号（team1-5）和西安 M4 的用户路径，导致：
1. 无法在其他机器上部署 bridge（路径/用户名不同）
2. 多台机器共享同一组 token 会触发 refresh_token_reused 冲突
3. executor.js 只有一个 bridge URL，无法负载均衡

### 解法

1. BRIDGE_ACCOUNTS 环境变量：每台机器只配置自己的账号，避免 token 冲突
2. WORK_DIR + os.homedir()：路径不再硬编码，通过环境变量适配不同机器
3. selectBestBridge()：并发 health check 所有 bridge，选平均使用率最低的

### 下次预防

- [ ] 新增远程服务部署时，所有路径和凭据必须参数化（环境变量），禁止硬编码用户名或绝对路径
- [ ] 多机共享 OAuth token 时必须确认 refresh_token 是否一次性使用——如果是，每台机器必须独立登录
- [ ] 负载均衡逻辑必须有降级路径（所有节点不可用时 fallback 到默认 URL）
