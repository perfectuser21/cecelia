# Cecelia staging独立前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cecelia staging（5222端口 Brain）有自己的 Dashboard 前端（5212端口），不再借用生产 5211。

**Architecture:** `frontend-proxy.js` 三常量改环境变量可覆写（默认值不变） + `docker-compose.staging.yml` 新增 `frontend-staging` 服务，复用生产同一份 `dist/` 静态产物。

**Tech Stack:** Node.js（frontend-proxy.js） + Docker Compose

---

### Task 1: frontend-proxy.js 常量改环境变量可覆写

**Files:**
- Modify: `frontend-proxy.js:12-14`

- [ ] **Step 1: 改常量定义**

把：
```js
const PORT = 5211;
const BRAIN_PORT = 5221;
const STATIC_DIR = '/Users/administrator/perfect21/cecelia/apps/dashboard/dist';
```
改成：
```js
const PORT = process.env.FRONTEND_PORT || 5211;
const BRAIN_PORT = process.env.BRAIN_PORT_TARGET || 5221;
const STATIC_DIR = process.env.DASHBOARD_STATIC_DIR || '/Users/administrator/perfect21/cecelia/apps/dashboard/dist';
```

- [ ] **Step 2: 语法检查**

Run: `node --check frontend-proxy.js`
Expected: 无输出（语法正确）

- [ ] **Step 3: 验证默认值行为不变（零风险验证）**

Run: `node -e "const {execSync} = require('child_process'); const out = execSync('node -e \"console.log(process.env.FRONTEND_PORT || 5211, process.env.BRAIN_PORT_TARGET || 5221)\"').toString(); console.log(out)"`
Expected: 输出 `5211 5221`（未设环境变量时，行为与改动前完全一致）

- [ ] **Step 4: Commit**

```bash
git add frontend-proxy.js
git commit -m "feat: frontend-proxy.js端口/BRAIN目标/静态目录改环境变量可覆写(默认值不变零风险)"
```

---

### Task 2: docker-compose.staging.yml 新增 frontend-staging 服务

**Files:**
- Modify: `docker-compose.staging.yml`

- [ ] **Step 1: 追加服务定义**

在 `docker-compose.staging.yml` 的 `services:` 下、`node-brain-staging` 服务之后，追加：

```yaml
  frontend-staging:
    image: node:20-alpine
    container_name: cecelia-frontend-staging
    network_mode: host
    working_dir: /app
    volumes:
      - ./apps/dashboard/dist:/app
      - /Users/administrator/perfect21/cecelia/apps/dashboard/dist:/Users/administrator/perfect21/cecelia/apps/dashboard/dist:ro
      - ./frontend-proxy.js:/frontend-proxy.js:ro
    environment:
      - FRONTEND_PORT=5212
      - BRAIN_PORT_TARGET=5222
    command: node /frontend-proxy.js
    depends_on:
      node-brain-staging:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 256M
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "5m"
        max-file: "2"
```

（写法照搬 `docker-compose.yml` 里生产 `frontend` 服务的结构，只换端口和 `depends_on` 目标）

- [ ] **Step 2: yaml语法检查**

Run: `python3 -c "import yaml; yaml.safe_load(open('docker-compose.staging.yml'))"`
Expected: 无输出无报错

- [ ] **Step 3: 确认生产docker-compose.yml未被误改**

Run: `git diff docker-compose.yml`
Expected: 无输出（这个文件不应该有任何改动）

- [ ] **Step 4: Commit**

```bash
git add docker-compose.staging.yml
git commit -m "feat: docker-compose.staging.yml新增frontend-staging服务(5212代理staging Brain 5222)"
```

---

### Task 3: 部署验证（生产运维操作）

**Files:**
- 无新文件，执行 docker compose 部署命令

- [ ] **Step 1: 确认dist产物存在**

Run: `ls -la apps/dashboard/dist/index.html`
Expected: 文件存在（生产已有的构建产物，本任务不重新build）

- [ ] **Step 2: 部署staging compose（只加frontend-staging，不动node-brain-staging）**

Run: `docker compose -f docker-compose.staging.yml up -d frontend-staging`
Expected: 容器 `cecelia-frontend-staging` 启动成功

- [ ] **Step 3: 验证5212能访问**

Run: `curl -s -o /dev/null -w "%{http_code}" localhost:5212/`
Expected: `200`

- [ ] **Step 4: 验证代理目标是staging Brain(5222)不是生产(5221)**

Run:
```bash
curl -s localhost:5212/api/brain/tick/status
curl -s localhost:5222/api/brain/tick/status
```
Expected: 两者返回内容一致（证明5212确实代理到5222，不是巧合碰到5221相同响应——如果内容和`curl localhost:5221/api/brain/tick/status`不同，则代理生效）

- [ ] **Step 5: 验证生产5211不受影响**

Run: `curl -s -o /dev/null -w "%{http_code}" localhost:5211/`
Expected: `200`（生产容器未受影响，独立compose project互不干扰）

- [ ] **Step 6: 若Step2-5任何一步失败，不要自作主张修复，报告失败位置和完整输出**

- [ ] **Step 7: 全部通过后Commit（记录部署完成）**

```bash
git add -A
git commit -m "chore: 部署验证Cecelia staging独立前端(5212)" --allow-empty
```

---

## Self-Review 记录

- **Spec coverage**：设计文档核心洞察（复用同一份dist，不需要单独build）体现在Task2volume挂载沿用生产同一路径；Task1环境变量覆写+Task2新服务+Task3验证，三个目标（前端可用/代理正确/生产不受影响）全覆盖
- **Placeholder scan**：无TBD
- **命名一致性**：`FRONTEND_PORT`/`BRAIN_PORT_TARGET`/`DASHBOARD_STATIC_DIR` 三个环境变量名在Task1定义、Task2引用，完全一致
- **范围**：单一sprint，无需再拆
