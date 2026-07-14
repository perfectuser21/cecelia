# Design: Cecelia dev 建独立前端

## 背景

Cecelia dev 后端（Brain，5220端口，独立 `cecelia_dev` 库）今天（2026-07-14）第一次真正跑起来，但完全没有配套前端。决策记录 `82b13f35`，交接文档"建议下一步 Task2"。

## 方案

照搬 staging 独立前端（PR #3871，已验证生产可用）的完全相同模式：

`docker-compose.dev.yml` 新增 `frontend-dev` 服务，复用生产同一份 `apps/dashboard/dist` 静态产物（`frontend-proxy.js` 的环境变量化已经在 staging 那次 PR 里做完，本次直接复用，不用再改代码）：

```yaml
  frontend-dev:
    image: node:20-alpine
    container_name: cecelia-frontend-dev
    network_mode: host
    working_dir: /app
    volumes:
      - ./apps/dashboard/dist:/app
      - /Users/administrator/perfect21/cecelia/apps/dashboard/dist:/Users/administrator/perfect21/cecelia/apps/dashboard/dist:ro
      - ./frontend-proxy.js:/frontend-proxy.js:ro
    environment:
      - FRONTEND_PORT=5213
      - BRAIN_PORT_TARGET=5220
      - LANGFUSE_PROXY_PORT=3003
    command: node /frontend-proxy.js
    depends_on:
      node-brain-dev:
        condition: service_healthy
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "5m"
        max-file: "2"
```

端口分配延续既有序列：生产 5211/5221，staging 5212/5222，dev 5213/5220（dev Brain 端口是既有约定 5220，不是 5223，照抄 `docker-compose.dev.yml` 里 `node-brain-dev` 已有的 `BRAIN_PORT=5220`）。Langfuse 隧道用 3003（staging 已占 3002，生产 3001）。

## 注意事项（对照 docker-compose.dev.yml 现状）

`docker-compose.dev.yml` 里已经有一个名为 `frontend` 的服务，但它的 volume 挂载指向一个明显过期/无关的路径（`/home/xx/perfect21/zenithjoy/workspace/apps/dashboard/dist`），像是历史遗留、当前未必在用的死配置。本次**不touch这个已有的 `frontend` 服务**（不在本次范围，避免误伤不了解的东西），只新增一个独立的 `frontend-dev` 服务名，避免和它冲突。

## 错误处理

同 staging 版本：`depends_on.condition: service_healthy` 确保 dev Brain 就绪后才启动前端；5213/3003 端口冲突会导致容器启动失败但不影响其他服务（network_mode: host 下端口独占，已提前核实两个端口当前空闲）。

## 测试策略

- Manual：`curl localhost:5213/` 200 + 对比 `localhost:5213/api/brain/tick/status` 与 `localhost:5220` 对应端点内容一致，证明代理目标正确
- 无 unit test（纯部署配置改动，复用已验证过的 frontend-proxy.js 环境变量化逻辑）
- 守卫：同 staging，用真实 curl 冒烟即可，不需要额外常驻巡检

## 范围外

- 不改动 `frontend`/`node-brain`/`node-brain-dev` 现有服务定义
- 不处理 `docker-compose.dev.yml` 里那个疑似过期的 `frontend` 服务（不了解的东西不动）
- 不涉及 ZenithJoy 侧任何改动
