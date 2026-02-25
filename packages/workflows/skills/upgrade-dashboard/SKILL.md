# upgrade-dashboard - 前端 Dashboard 升级流程

**用途**：Cecelia + ZenithJoy 前端页面的完整升级流程

**触发词**：/upgrade-dashboard、升级dashboard、更新前端

---

## 🗺️ 双项目架构总览

### 核心原则

| 项目 | 部署位置 | 原因 |
|------|----------|------|
| **Cecelia** | 🇺🇸 全在美国 | 调用 Claude Code API（美国），用户主要是自己 |
| **ZenithJoy** | 🇭🇰 全在香港 | 服务大陆客户，香港延迟低 |

---

## 📍 Cecelia 架构（美国）

**位置**：`/home/xx/perfect21/cecelia/workspace/`

```
workspace/
├── apps/
│   ├── core/                    ← 后端 API (Express)
│   │   ├── dist/               ← 编译后的后端代码
│   │   └── features/           ← React 组件（前端逻辑）
│   └── dashboard/              ← 前端壳 + 构建配置
│       ├── src/                ← 前端入口
│       ├── public/             ← 静态资源
│       ├── dist/               ← 构建产物
│       └── vite.config.ts      ← Vite 配置
└── package.json
```

### 服务架构

```
🇺🇸 美国服务器（146.190.52.84 / perfect21 / 100.71.32.28）
├── 5212: Cecelia 研发环境（Vite Dev Server）
├── 5211: Cecelia 正式环境（pm2 cecelia-core）
├── 5221: Brain（Docker）
├── 5432: PostgreSQL（Docker）
└── 5679: n8n（Docker）

流量：中国 → 美国（所有请求）
```

### 端口详情

| 端口 | 服务 | 类型 | 用途 |
|------|------|------|------|
| **5212** | Cecelia 研发 | Vite Dev Server | 开发测试，热更新 |
| **5211** | Cecelia 正式 | pm2 Express | 生产环境，静态+API |
| 5221 | Brain | Docker | AI 决策引擎 |
| 5432 | PostgreSQL | Docker | 数据库 |
| 5679 | n8n | Docker | 自动化工作流 |

### 访问方式

- **研发版**：http://perfect21:5212（Vite 热更新）
- **正式版**：http://perfect21:5211（pm2 Express）
- **注意**：`perfect21` 解析到美国服务器（100.71.32.28）

---

## 📍 ZenithJoy 架构（香港）

**位置**：`/home/xx/perfect21/zenithjoy/workspace/`

```
workspace/
├── apps/
│   ├── api/                    ← 后端 API
│   └── dashboard/              ← 前端
│       ├── src/
│       ├── public/
│       ├── dist/               ← 构建产物
│       └── vite.config.ts
├── deploy-hk.sh                ← 香港部署脚本
└── package.json
```

### 服务架构

```
🇭🇰 香港服务器（43.154.85.217 / hk / 100.86.118.99）
├── 520: ZenithJoy 研发环境（Docker nginx: autopilot-dev）
├── 521: ZenithJoy 正式环境（Docker nginx: autopilot-prod）
│         → 域名：autopilot.zenjoymedia.media
├── 5432: PostgreSQL（Docker）
└── 5679: n8n（Docker）

流量：中国/大陆 → 香港（快）
```

### 端口详情

| 端口 | 服务 | 类型 | 用途 |
|------|------|------|------|
| **520** | ZenithJoy 研发 | Docker nginx | 开发测试 |
| **521** | ZenithJoy 正式 | Docker nginx | 生产环境 |
| 5432 | PostgreSQL | Docker | 数据库 |
| 5679 | n8n | Docker | 自动化工作流（正式环境用） |

### 访问方式

- **研发版**：http://hk:520
- **正式版**：https://autopilot.zenjoymedia.media（公网域名 → 521）

### 开发 vs 正式

| 环境 | n8n | API | 说明 |
|------|-----|-----|------|
| **开发** | 🇺🇸 美国 (5679) | 🇺🇸 美国 | 在美国开发测试 |
| **正式** | 🇭🇰 香港 (5679) | 🇭🇰 香港 | 部署到香港，服务大陆客户 |

---

## 🚀 Cecelia 升级流程（美国）

### 场景 1：更新研发环境（5212）

**流程**：
```
代码修改 → /dev 工作流 → PR 合并到 develop
    ↓
Vite Dev Server 自动热更新
```

**步骤**：

1. **代码修改并合并**
   ```bash
   # 通过 /dev 创建 PR → CI 通过 → 合并到 develop
   ```

2. **Vite 自动热更新**
   - Vite 监听文件变化，自动 HMR
   - 不需要手动操作

3. **如果没有自动刷新**
   ```bash
   # 重启 Vite
   pkill -9 -f "vite.*5212"
   cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
   npm run dev > /tmp/vite-dev.log 2>&1 &

   # 或浏览器硬刷新
   # Mac: Cmd+Shift+R / Windows: Ctrl+Shift+R
   ```

4. **验证**
   - 访问：http://perfect21:5212/你的页面
   - 无痕模式：Cmd+Shift+N

---

### 场景 2：更新正式环境（5211）

**流程**：
```
develop 稳定 → PR: develop → main → 合并
    ↓
构建 → pm2 重启
```

**步骤**：

1. **创建 PR: develop → main**
   ```bash
   cd /home/xx/perfect21/cecelia/workspace
   git checkout develop && git pull origin develop

   gh pr create \
     --base main \
     --head develop \
     --title "chore: release v1.x.x" \
     --body "合并 develop 到 main，发布版本 v1.x.x"
   ```

2. **等待 CI 通过并合并**
   ```bash
   gh pr merge <PR号> --squash
   ```

3. **更新本地并构建**
   ```bash
   git checkout main && git pull origin main
   cd apps/dashboard
   npm run build
   ```

4. **重启 pm2**
   ```bash
   pm2 restart cecelia-core
   ```

5. **验证**
   - 访问：http://perfect21:5211/你的页面
   - 硬刷新 + 无痕模式

---

## 🚀 ZenithJoy 升级流程（香港）

### 场景 1：更新研发环境（520）

**流程**：
```
代码修改 → PR 合并到 develop
    ↓
美国构建 → rsync → 香港 520
```

**步骤**：

1. **代码合并到 develop**
   ```bash
   cd /home/xx/perfect21/zenithjoy/workspace
   git checkout develop && git pull origin develop
   ```

2. **构建**
   ```bash
   cd apps/dashboard
   npx vite build
   ```

3. **部署到香港**
   ```bash
   rsync -avz --delete \
     dist/ \
     hk:/opt/zenithjoy/autopilot-dev/dist/

   # 重启容器（如需要）
   ssh hk "docker restart autopilot-dev"
   ```

4. **验证**
   - 访问：http://hk:520

---

### 场景 2：更新正式环境（521）

**流程**：
```
develop 稳定 → PR: develop → main → 合并
    ↓
美国构建 → rsync → 香港 521
```

**步骤**：

1. **创建 PR: develop → main**
   ```bash
   cd /home/xx/perfect21/zenithjoy/workspace
   git checkout develop && git pull origin develop

   gh pr create \
     --base main \
     --head develop \
     --title "chore: release v1.x.x"
   ```

2. **合并 PR**
   ```bash
   gh pr merge <PR号> --squash
   ```

3. **更新本地并构建**
   ```bash
   git checkout main && git pull origin main
   cd apps/dashboard
   npx vite build
   ```

4. **一键部署到香港**
   ```bash
   # 使用部署脚本
   cd /home/xx/perfect21/zenithjoy/workspace
   ./deploy-hk.sh
   ```

   **脚本会自动**：
   - ✅ Git 安全检查
   - ✅ 构建前端
   - ✅ rsync 到香港
   - ✅ 输出部署信息

5. **手动部署（如果脚本失败）**
   ```bash
   # 同步文件
   rsync -avz --delete \
     apps/dashboard/dist/ \
     hk:/opt/zenithjoy/autopilot-dashboard/dist/

   # 重启容器
   ssh hk "docker restart autopilot-prod"
   ```

6. **验证**
   - 公网：https://autopilot.zenjoymedia.media
   - 硬刷新 + 无痕模式

---

## 🔧 常见问题排查

### 问题 1：页面还是旧的（缓存问题）

**解决方案**：

1. **硬刷新**（最简单）
   - Mac: `Cmd+Shift+R`
   - Windows/Linux: `Ctrl+Shift+R`

2. **清除 Service Worker**
   ```javascript
   // 浏览器控制台执行
   navigator.serviceWorker.getRegistrations().then(function(registrations) {
     for(let registration of registrations) {
       registration.unregister()
     }
   })
   // 然后硬刷新
   ```

3. **无痕模式验证**
   - `Cmd/Ctrl+Shift+N`
   - 无缓存，验证是否真的更新了

---

### 问题 2：Vite 端口被占用（Cecelia 5212）

**症状**：Vite 启动在 5213/5214

**解决方案**：
```bash
# 查找占用进程
lsof -i :5212 | grep LISTEN

# 杀掉所有 Vite 进程
pkill -9 -f "vite"

# 重启
cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
npm run dev > /tmp/vite-dev.log 2>&1 &
```

---

### 问题 3：页面白屏或 404

**排查步骤**：

1. **检查路由注册**
   - 组件定义：`apps/core/features/xxx/index.ts`
   - 路由暴露：`apps/core/features/system-hub/index.ts`

2. **检查构建产物**
   ```bash
   # Cecelia
   ls -lh /home/xx/perfect21/cecelia/workspace/apps/dashboard/dist/

   # ZenithJoy
   ls -lh /home/xx/perfect21/zenithjoy/workspace/apps/dashboard/dist/
   ```

3. **检查服务状态**
   ```bash
   # Cecelia - 研发
   ps aux | grep vite | grep 5212

   # Cecelia - 正式
   pm2 status cecelia-core

   # ZenithJoy - 香港
   ssh hk "docker ps | grep autopilot"
   ```

4. **查看日志**
   ```bash
   # Cecelia - 研发
   tail -f /tmp/vite-dev.log

   # Cecelia - 正式
   pm2 logs cecelia-core

   # ZenithJoy - 香港
   ssh hk "docker logs autopilot-prod --tail 50"
   ```

---

### 问题 4：rsync 到香港失败

**解决方案**：

1. **检查 Tailscale 连接**
   ```bash
   tailscale status
   ssh hk "echo 'Connection OK'"
   ```

2. **检查 SSH 配置**
   ```bash
   cat ~/.ssh/config | grep -A 5 "Host hk"
   # 应该有：
   # Host hk
   #   HostName 100.86.118.99
   #   User ubuntu
   ```

3. **手动测试 rsync**
   ```bash
   rsync -avz --dry-run \
     /home/xx/perfect21/zenithjoy/workspace/apps/dashboard/dist/ \
     hk:/opt/zenithjoy/autopilot-dashboard/dist/
   ```

---

## 📋 快速命令参考

### Cecelia 研发版（5212，美国）

```bash
# 重启 Vite
pkill -9 -f "vite.*5212" && \
  cd /home/xx/perfect21/cecelia/workspace/apps/dashboard && \
  npm run dev > /tmp/vite-dev.log 2>&1 &

# 查看日志
tail -f /tmp/vite-dev.log

# 访问：http://perfect21:5212
```

---

### Cecelia 正式版（5211，美国）

```bash
# 构建
cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
npm run build

# 重启 pm2
pm2 restart cecelia-core

# 访问：http://perfect21:5211
```

---

### ZenithJoy 研发版（520，香港）

```bash
# 构建
cd /home/xx/perfect21/zenithjoy/workspace/apps/dashboard
npx vite build

# 部署
rsync -avz --delete dist/ hk:/opt/zenithjoy/autopilot-dev/dist/
ssh hk "docker restart autopilot-dev"

# 访问：http://hk:520
```

---

### ZenithJoy 正式版（521，香港）

```bash
# 一键部署
cd /home/xx/perfect21/zenithjoy/workspace
./deploy-hk.sh

# 手动部署
cd apps/dashboard && npx vite build && \
  rsync -avz --delete dist/ hk:/opt/zenithjoy/autopilot-dashboard/dist/ && \
  ssh hk "docker restart autopilot-prod"

# 访问：https://autopilot.zenjoymedia.media
```

---

## 🎯 最佳实践

### 1. 避免缓存问题

**硬刷新**：`Cmd+Shift+R`（Mac）/ `Ctrl+Shift+R`（Windows）

**无痕模式**：`Cmd+Shift+N`（Mac）/ `Ctrl+Shift+N`（Windows）

**清除 Service Worker**：见上方"清除 Service Worker"

---

### 2. nginx 配置防缓存

```nginx
location / {
  try_files $uri $uri/ /index.html;
}

location = /index.html {
  add_header Cache-Control "no-cache, no-store, must-revalidate";
  add_header Pragma "no-cache";
  add_header Expires 0;
}

location = /sw.js {
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

---

### 3. Vite 版本化静态资源

Vite 默认给静态资源加 hash：
- 旧：`app.js`
- 新：`app.abc123.js`

浏览器自动加载新文件，**前提**：`index.html` 不被缓存。

---

## 📝 工作流检查清单

### Cecelia 研发环境更新

- [ ] 代码已合并到 develop
- [ ] Vite Dev Server 正在运行（5212）
- [ ] 访问页面，检查是否自动刷新
- [ ] 如未刷新，硬刷新（Cmd+Shift+R）
- [ ] 无痕模式验证

---

### Cecelia 正式环境更新

- [ ] develop 已合并到 main
- [ ] 本地 `git pull origin main`
- [ ] 运行 `npm run build`
- [ ] 运行 `pm2 restart cecelia-core`
- [ ] 访问 http://perfect21:5211
- [ ] 硬刷新 + 无痕模式验证

---

### ZenithJoy 正式环境更新

- [ ] develop 已合并到 main
- [ ] 本地 `git pull origin main`
- [ ] 运行 `./deploy-hk.sh`
- [ ] 或手动：构建 → rsync → 重启容器
- [ ] 访问 https://autopilot.zenjoymedia.media
- [ ] 硬刷新 + 无痕模式验证

---

## 📊 项目对比总结

| 项目 | 部署位置 | 研发环境 | 正式环境 | 公网域名 | 原因 |
|------|----------|----------|----------|----------|------|
| **Cecelia** | 🇺🇸 美国 | 5212 (Vite) | 5211 (pm2) | 无 | Claude Code API 在美国 |
| **ZenithJoy** | 🇭🇰 香港 | 520 (nginx) | 521 (nginx) | autopilot.zenjoymedia.media | 服务大陆客户 |

---

## 🔗 相关文件

| 文件 | 说明 |
|------|------|
| `/home/xx/.claude/CLAUDE.md` | 全局规则（分支保护、/dev 工作流） |
| `/home/xx/.claude/projects/-home-xx-perfect21-cecelia-workspace/memory/MEMORY.md` | Cecelia 项目记忆 |
| `/home/xx/perfect21/cecelia/workspace/apps/dashboard/vite.config.ts` | Cecelia Vite 配置 |
| `/home/xx/perfect21/zenithjoy/workspace/deploy-hk.sh` | ZenithJoy 部署脚本 |
| `/home/xx/perfect21/cecelia/workspace/apps/core/features/` | Cecelia React 组件源码 |
| `/home/xx/perfect21/zenithjoy/workspace/apps/dashboard/` | ZenithJoy 前端源码 |
