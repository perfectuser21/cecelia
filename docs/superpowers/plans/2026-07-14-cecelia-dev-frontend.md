# Cecelia dev独立前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cecelia dev（5220端口 Brain）有自己的 Dashboard 前端（5213端口），不再完全没有前端可看。

**Architecture:** `docker-compose.dev.yml` 新增 `frontend-dev` 服务，复用已在 staging PR#3871 里环境变量化过的 `frontend-proxy.js`，不需要改任何代码，纯 compose 配置新增。

**Tech Stack:** Docker Compose（frontend-proxy.js 代码已就绪，本次零代码改动）

---

### Task 1: docker-compose.dev.yml 新增 frontend-dev 服务

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: 追加服务定义**

在 `docker-compose.dev.yml` 里 `node-brain-dev` 服务定义结束之后（第82行 `frontend:` 服务之前），插入：

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

**不要改动**已有的 `frontend`/`node-brain`/`node-brain-dev` 服务定义任何一行。

- [ ] **Step 2: yaml语法检查**

Run: `python3 -c "import yaml; yaml.safe_load(open('docker-compose.dev.yml'))"`
Expected: 无输出无报错

- [ ] **Step 3: 确认只新增了这一个服务块**

Run: `git diff docker-compose.dev.yml`
Expected: diff只包含新增的frontend-dev服务块（纯addition，无删除行）

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat: docker-compose.dev.yml新增frontend-dev服务(5213代理dev Brain 5220)"
```

---

### Task 2: 部署验证（生产运维操作）

**Files:**
- 无新文件

- [ ] **Step 1: 确认5213/3003端口空闲**

Run: `lsof -i :5213; lsof -i :3003`
Expected: 均无输出（空闲）

- [ ] **Step 2: 确认dist产物存在**

Run: `ls -la apps/dashboard/dist/index.html`（worktree里可能需要先symlink主仓库的dist，同staging任务的做法）
Expected: 文件存在

- [ ] **Step 3: 部署**

Run: `docker compose -f docker-compose.dev.yml up -d --no-deps frontend-dev`
Expected: 容器 `cecelia-frontend-dev` 启动成功

- [ ] **Step 4: 验证5213可访问**

Run: `curl -s -o /dev/null -w "%{http_code}" localhost:5213/`
Expected: `200`

- [ ] **Step 5: 验证代理目标是dev Brain(5220)**

Run:
```bash
curl -s localhost:5213/api/brain/tick/status
curl -s localhost:5220/api/brain/tick/status
```
Expected: 两者内容一致；与生产`localhost:5221`/staging`localhost:5212`不同

- [ ] **Step 6: 验证生产/staging不受影响**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" localhost:5211/
curl -s -o /dev/null -w "%{http_code}" localhost:5212/
```
Expected: 均 `200`

- [ ] **Step 7: 若任何一步失败，不要自作主张修复，报告失败位置**

- [ ] **Step 8: 全部通过后，清理本次worktree测试用的临时symlink（若有），确认git status干净后commit**

```bash
git add -A
git commit -m "chore: 部署验证Cecelia dev独立前端(5213)" --allow-empty
```

---

## Self-Review 记录

- **Spec coverage**：设计文档目标（新增frontend-dev服务、不动现有frontend/node-brain-dev、复用dist）全覆盖，Task1只新增不删改，Task2验证代理正确性+生产/staging不受影响
- **Placeholder scan**：无TBD
- **命名一致性**：`FRONTEND_PORT=5213`/`BRAIN_PORT_TARGET=5220`/`LANGFUSE_PROXY_PORT=3003` 与staging同名变量、不同值，风格一致
- **范围**：单一sprint
