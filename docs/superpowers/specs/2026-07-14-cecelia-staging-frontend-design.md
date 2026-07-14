# Design: Cecelia staging 建独立前端

## 背景

Cecelia staging 后端（Brain，5222端口，独立 `cecelia_staging` 库）已上线，但没有自己的前端，一直借用生产 Dashboard（5211→代理到5221生产Brain）。用户看 staging 数据时实际在看生产数据。决策记录 `8cfca826`，交接文档"建议下一步 Task1"。

## 关键洞察

`apps/dashboard/dist` 编译产物里的 JS bundle 全部走**相对路径** `/api/...` 发请求（无 baked-in 的 Brain 地址）。真正决定"代理到哪个 Brain"的是服务端 `frontend-proxy.js`（Node 容器进程），不是前端 bundle 本身。

**这意味着 staging 不需要单独 build 一份前端**——只需要复用生产同一份 `dist/` 静态产物，跑第二个 `frontend-proxy.js` 进程实例，把它的 `BRAIN_PORT` 指向 5222（staging Brain）、监听端口换一个（5212，当前空闲）即可。

## 方案

1. `frontend-proxy.js` 四个硬编码常量改成环境变量可覆写，默认值保持不变（零风险，向后兼容）：
   ```js
   const PORT = process.env.FRONTEND_PORT || 5211;
   const BRAIN_PORT = process.env.BRAIN_PORT_TARGET || 5221;
   const STATIC_DIR = process.env.DASHBOARD_STATIC_DIR || '/Users/administrator/perfect21/cecelia/apps/dashboard/dist';
   const LANGFUSE_PROXY_PORT = process.env.LANGFUSE_PROXY_PORT || 3001;
   ```
   （变量名刻意不用 `PORT`/`BRAIN_PORT` 本身，避免和 Docker/Node 常见环境变量混淆。`LANGFUSE_PROXY_PORT` 是部署验证阶段发现的第4个硬编码点——`network_mode: host` 下生产/staging 两个容器共享宿主机端口，不覆写会导致 staging 容器抢占生产 3001 端口反复崩溃，staging 侧改用 3002）

2. `docker-compose.staging.yml` 新增 `frontend-staging` 服务，仿照生产 `docker-compose.yml` 里的 `frontend` 服务写法：
   - `container_name: cecelia-frontend-staging`
   - `network_mode: host`
   - 复用同一个 volume 挂载（`./apps/dashboard/dist:/app` 只读）+ `frontend-proxy.js`
   - `environment: FRONTEND_PORT=5212 BRAIN_PORT_TARGET=5222`
   - `depends_on: node-brain-staging: condition: service_healthy`

## 错误处理

- 5212 端口被占用 → 容器启动失败，`docker compose ps` 可见，不影响生产 5211 容器（不同 compose project）
- staging Brain(5222) 未启动 → `depends_on` + healthcheck 会让 frontend-staging 容器等待，不会无限报错刷屏

## 测试策略

- Manual：`curl localhost:5212/` 返回 HTML；`curl localhost:5212/api/brain/tick/status` 返回的数据应该来自 5222（staging）不是 5221（生产）——用两边 DB 记录数或 uptime 不同来验证代理目标正确
- 无 unit test（纯运维部署配置改动，`frontend-proxy.js` 的三行 env 覆写是唯一"代码"改动，逻辑简单到不需要专门测试；已有的行为——不传 env 时走默认值——本身就是现有生产行为的延续，不是新逻辑）
- 守卫：这是"一个部署"级别（按 SKILL.md 哨兵分级），用**真 URL 冒烟**即可——验收标准里的 curl 检查就是这个冒烟，不需要额外常驻巡检

## 范围外

- 不涉及 dev（5220）前端（另一个 Task）
- 不改生产 frontend 服务本身的行为（只是让它的常量可被覆写，默认值不变）
- 不给 staging Dashboard 配独立域名/HTTPS（本地端口访问即可，跟内部使用场景一致）
