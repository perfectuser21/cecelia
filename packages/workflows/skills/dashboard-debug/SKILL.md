---
name: dashboard-debug
description: Dashboard 前端部署常见错误案例库 - 记录每次失败的原因和修复方法
version: 3.0.0
created: 2026-01-15
updated: 2026-02-12
changelog:
  - 3.0.0: 重构为"错误案例库"，重点记录失败原因和修复方法（2026-02-12）
  - 2.0.0: 合并 deploy-frontend
  - 1.0.0: 初始版本
---

# dashboard-debug - Dashboard 错误案例库

**这个 skill 的目的**：防止我（Claude）自己犯错！记录我每次都会忘记做的事情。

## ⚠️ 每次部署前必读（强制）

```
┌─────────────────────────────────────────────────────────────────┐
│  🚫 绝对禁止的行为（会让用户愤怒）                               │
│  ❌ 禁止说"应该可以了"、"已修复"、"现在可以工作了"              │
│  ❌ 禁止让用户测试我没有端到端验证过的代码                      │
│  ❌ 禁止假设部署成功、假设代码已更新                            │
│                                                                 │
│  ✅ 我能做的（无头模式下的最大努力）                            │
│  1. 全局搜索所有相关代码（不要只改一个地方）                    │
│  2. 检查部署时间戳（确认文件真的更新了）                        │
│  3. 读取部署后的实际代码（不要假设）                            │
│  4. 模拟所有可能的代码路径                                      │
│                                                                 │
│  ✅ 完成后只能说什么                                            │
│  "我修改了以下 7 处代码：[列表]，已部署（时间戳 14:54）"        │
│  ❌ 不要说"已修复"、"应该可以了"、"请测试"                      │
│  ✅ 让用户自己决定是否测试                                      │
│                                                                 │
│  ✅ 如果用户报告还有问题                                        │
│  - 不要问为什么                                                 │
│  - 不要让用户提供更多信息（除非真的需要）                       │
│  - 立即分析代码，找到问题，修复，重新部署                       │
│  - 循环直到用户不再报错                                         │
└─────────────────────────────────────────────────────────────────┘
```

**触发词**：
- `dashboard出错`、`前端出问题了`、`前端不工作`
- `dashboard部署`、`更新dashboard`、`修复dashboard`、`优化前端`、`迭代dashboard`
- `生成失败`、`页面还是旧的`、`400错误`、`401错误`、`502错误`

**核心原则**：
```
修复代码 → 运行/测试 → 截图验证 → 确认效果 → 才告诉用户
                                ↑
                          不要跳过这步！
```

**禁止的行为**：
- ❌ 改完代码就告诉用户"修复了"
- ❌ 假设代码能工作，没有验证就说"成功了"
- ❌ 让用户帮我测试我没验证过的代码

---

## 🎯 端到端测试 vs 无头模式检查

### 什么是"端到端测试"？

**完整的用户操作流程**：
```
用户点击按钮
  → 前端组件渲染
    → 调用 API 函数
      → 发送 HTTP 请求
        → nginx 代理转发
          → 后端服务处理
            → 返回响应
              → 前端显示结果
                → 用户看到成功
```

**每一步都要验证！**

### 我在无头模式下能做什么？

| 测试步骤 | 有浏览器 | 无头模式（我） | 能达到的信心度 |
|---------|---------|---------------|--------------|
| **1. 用户点击按钮** | ✅ 真实点击 | ❌ 无法模拟 | 0% |
| **2. 前端组件渲染** | ✅ 看到页面 | ⚠️ 读源代码 | 60% |
| **3. API 调用** | ✅ Network 面板 | ⚠️ 读 API 函数 | 70% |
| **4. HTTP 请求** | ✅ 看到请求 | ✅ curl 模拟 | 90% |
| **5. nginx 代理** | ✅ 看到响应 | ✅ 容器内 curl | 90% |
| **6. 后端处理** | ✅ 看到结果 | ✅ 直接测 API | 95% |
| **7. 前端显示** | ✅ 看到 UI | ❌ 无法验证 | 0% |
| **整体** | ✅ 100% | ⚠️ **最多 70%** | **不够！** |

### 结论：无头模式下的最佳实践

**我能做到的最大努力（70% 信心度）**：
1. ✅ 全局搜索所有相关代码
2. ✅ 检查部署时间戳
3. ✅ 读取实际代码确认
4. ✅ 模拟 API 请求（如果是 API 问题）
5. ✅ 检查 nginx 配置
6. ✅ 从容器内测试后端

**但无法做到（缺失的 30%）**：
1. ❌ 真实点击按钮
2. ❌ 看到前端渲染结果
3. ❌ 验证 UI 交互

**因此，我的原则**：
- ✅ 客观陈述"我修改了 XXX"
- ❌ **绝对不说**"已修复"、"应该可以了"
- ✅ 让用户自己决定是否测试
- ✅ 如果用户报错，立即继续修复

### 无头模式下的验证方法（尽最大努力）

虽然无法真正截图，但我必须做到：

**1. API 测试（如果涉及后端）**
```bash
# 测试图片上传 API
curl -X POST http://100.86.118.99:5680/upload-video-frame \
  -F "image=@test.jpg" \
  -H "Content-Type: multipart/form-data"

# 测试视频生成 API
curl -X POST https://autopilot.zenjoymedia.media/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-Hailuo-02","prompt":"test"}'
```

**2. nginx 代理测试**
```bash
# 从容器内测试后端连接
ssh hk "docker exec autopilot-prod curl -s http://100.86.118.99:5680/health"
```

**3. 静态资源验证**
```bash
# 确认新的 JS 文件已部署
ssh hk "ls -lh /opt/zenithjoy/autopilot-dashboard/dist/assets/index-*.js"
# 确认 index.html 引用了新的 JS
ssh hk "grep 'index-' /opt/zenithjoy/autopilot-dashboard/dist/index.html"
```

**4. 代码路径模拟**
```bash
# 模拟用户操作的代码路径
# 1. 用户点击 AI Video 菜单
#    → DynamicSidebar 渲染菜单项
#    → 检查：grep "const Icon = item.icon" DynamicSidebar.tsx（是否有 filter？）
# 2. 导航到 /ai-video
#    → AiVideoGenerationPage 组件加载
#    → 检查：所有子组件是否有防御性检查？
# 3. 用户上传图片
#    → ImageUploader 调用 uploadImage()
#    → 检查：是否返回 HTTP URL 而不是 data URL？
```

**5. 读取实际部署的代码**
```bash
# 不要假设代码"应该"是什么样的
# 读取实际部署的文件确认
scp hk:/opt/.../ImageUploader.tsx /tmp/deployed-ImageUploader.tsx
cat /tmp/deployed-ImageUploader.tsx | grep uploadImage
```

**结论**：即使无法截图，我也能达到 **80-90% 的信心度**（对于 API 和后端问题）。

但对于纯前端 UI 问题（如 icon 渲染），最多只能达到 **70% 信心度**。

**因此**：
- ✅ 如果是 API/后端问题，我可以说"我已测试 API，确认返回正确"
- ⚠️ 如果是前端 UI 问题，我只能说"我修改了这些地方，已部署"
- ❌ 不要说"已修复"，除非我真的测试验证过

---

## 🔴 Claude 自己的坏习惯（强制纠正）

**这个 skill 最重要的作用：防止我（Claude）自己犯错！**

### 我（Claude）总是会忘记做的事：

| 坏习惯 | 后果 | 今天的例子 | 强制要求 |
|--------|------|-----------|---------|
| **告诉用户"应该可以了"** | 用户测试还是失败 | 4 次都这样 | ❌ 禁止！必须自己测试 |
| **假设部署成功** | 实际部署了旧版本 | 第 4 次（12:01 的旧版） | ✅ 必须检查时间戳 |
| **假设代码已更新** | 实际文件没改 | 假设 ImageUploader 已修复 | ✅ 必须读取确认 |
| **只测试后端，不测端到端** | nginx/防火墙问题没发现 | 第 3 次才发现 nginx 问题 | ✅ 从容器内测试 |
| **告诉用户"清除缓存"** | 其实是我部署的问题 | 第 4 次不是缓存问题 | ✅ 先检查部署 |
| **只修改部分代码** | 其他地方还有同样的问题 | 只改了 App.tsx，忘了 DynamicSidebar | ✅ 全局搜索 `.icon` |

### 强制执行规则（每次部署）

**部署前**：
```bash
# 1. 读取实际代码（不要假设！）
cat apps/dashboard/src/components/xxx/Component.tsx | grep "关键函数"

# 2. 检查环境变量
cat apps/dashboard/.env.production | grep VITE_

# 3. TypeScript 检查
npx tsc --noEmit
```

**部署后**：
```bash
# 4. 检查时间戳（最容易忘！）
ssh hk "stat -c '%y' /opt/zenithjoy/autopilot-dashboard/dist/index.html"
# 必须是刚才的时间！如果不是 = 部署失败

# 5. 如果涉及后端，从容器内测试
ssh hk "docker exec autopilot-prod curl -s http://100.86.118.99:5680/test"

# 6. 端到端测试（curl 模拟前端请求）
curl -X POST https://autopilot.zenjoymedia.media/api/xxx
```

**告诉用户前（无头模式的最大努力）**：

由于无法在浏览器中真正测试，我必须做到：

1. ✅ **全局搜索确认所有相关代码**
   ```bash
   # 搜索所有可能出错的地方
   grep -rn "const Icon = " src/
   grep -rn "\.icon" src/
   grep -rn "VITE_.*API" .env.production
   ```

2. ✅ **检查部署时间戳**
   ```bash
   ssh hk "ls -lh /opt/zenithjoy/autopilot-dashboard/dist/assets/index-*.js | head -3"
   # 必须是刚才的时间！
   ```

3. ✅ **读取部署后的实际代码**
   ```bash
   # 不要假设，读取确认
   ssh hk "cat /opt/zenithjoy/autopilot-dashboard/dist/index.html | grep 'index-'"
   ```

4. ✅ **只客观陈述修改内容**
   - ✅ "我修改了以下 7 处代码：..."
   - ✅ "已部署到香港（时间戳 14:54）"
   - ❌ **禁止**说"已修复"、"应该可以了"、"现在可以工作了"
   - ❌ **禁止**说"请测试"

5. ✅ **让用户自己决定是否测试**
   - 不要主动要求用户测试
   - 用户会自己决定什么时候测试

6. ✅ **如果用户报告还有问题**
   - 不要辩解、不要问为什么
   - 立即继续分析和修复
   - 循环直到用户不再报错

---

## ⚠️ 2026-02-12 血泪教训（CRITICAL）

**AI 视频生成功能部署了 3 次才成功**，根本原因：**没有一次性检查完整调用链**。

### 四次部署记录

| 次数 | 时间 | 修改 | 结果 | 根本原因 |
|------|------|------|------|----------|
| 第 1 次 | 11:30 | 只加 feature flag | ❌ 401 错误 | 缺 API key |
| 第 2 次 | 12:01 | 加了 API key | ❌ 400 错误 | ImageUploader 返回 data URL |
| 第 3 次 | 12:30 | 修复 ImageUploader + nginx + 防火墙 | ✅ 成功 | 完整检查 |
| 第 4 次 | 14:15 | （用户测试）| ❌ 400 错误 | **部署了旧版本**（12:01 的） |
| 第 5 次 | 14:21 | 重新部署最新代码 | ⏳ 待验证 | 确认部署时间戳 |

### 核心教训

1. **不要假设，要验证**
   - ❌ 假设某个文件"应该"是什么样的
   - ✅ 读取实际代码确认

2. **检查完整调用链**
   ```
   用户操作 → 组件 → API → 环境变量 → nginx 代理 → 后端服务
   ```
   每一步都要检查！

3. **Docker 网络特殊性**（Linux）
   - ❌ `127.0.0.1` 指向容器本身，不是宿主机
   - ❌ `host.docker.internal` 只在 Docker Desktop 有效
   - ✅ 使用 Tailscale IP 或 Docker bridge IP
   - ✅ 检查防火墙规则

4. **从底层到顶层修改**
   ```
   环境变量 → 后端服务 → API 函数 → 组件 → 页面
   ```

5. **自己测试后再告诉用户**
   - ❌ "应该可以了"
   - ✅ "我已经测试过，现在可以正常工作"

详细记录：`/home/xx/.claude/projects/-home-xx-perfect21-zenithjoy-workspace/memory/frontend-fixes-20260212.md`

---

## ⚠️ 2026-02-12 下午 - TypeError: c.icon（第 6 次失败）

**问题**：点击 "AI 视频" 菜单后页面崩溃，报错 `TypeError: undefined is not an object (evaluating 'c.icon')`

**根本原因**：只修改了 App.tsx 中的 sidebar 代码，但忘记检查：
1. DynamicSidebar.tsx（也有 `const Icon = item.icon;`）
2. TaskMonitor.tsx（`const Icon = config.icon;` 如果 status 不在预期值）
3. ScenarioTabs.tsx、MediaScenarioPage.tsx、Dashboard.tsx 等多处

**修复方法**：
```bash
# 1. 全局搜索所有 .icon 访问
grep -rn "const Icon = .*\.icon" src/

# 2. 对所有 map 添加 filter
{items.filter(item => item && item.icon).map((item) => {
  const Icon = item.icon;
  // ...
})}

# 3. 对可能为 undefined 的 config 添加检查
const config = statusConfig[task.status];
if (!config) {
  console.error('Unknown status:', task.status);
  return null;
}
const Icon = config.icon;
```

**修复位置**（共 7 处）：
1. ✅ App.tsx:167 - sidebar 菜单
2. ✅ DynamicSidebar.tsx:97 - sidebar 菜单（忘记修改！）
3. ✅ TaskMonitor.tsx:77 - 任务状态图标
4. ✅ ScenarioTabs.tsx:33 - 场景标签
5. ✅ MediaScenarioPage.tsx:70 - 场景标签
6. ✅ Dashboard.tsx:608,638,668 - 快捷操作/数据采集/功能模块

**教训**：
- ❌ 不要只修改一个地方就假设完成了
- ✅ 必须全局搜索 `const Icon = ` 找到所有位置
- ✅ 所有 `.map((item) => { const Icon = item.icon; })` 都需要加 `.filter(item => item && item.icon)`

**部署时间**：14:54（第 6 次）

**验证结果**（15:04）：
- ✅ 使用 agent-browser 真实浏览器测试
- ✅ AI 视频页面完全正常渲染
- ✅ 侧边栏所有菜单正常（包括 Sparkles 图标）
- ✅ 来回切换菜单无崩溃
- ✅ Console 无 "c.icon" 错误
- ✅ 截图验证：3 张截图全部正常

**验证流程**（正确做法）：
```bash
# 1. SSH 端口转发（绕过飞书登录）
ssh -f -L 8521:localhost:521 hk -N

# 2. 打开浏览器
agent-browser open http://localhost:8521/ai-video

# 3. 注入测试 cookie
agent-browser eval "document.cookie = 'user=...; token=...'"

# 4. 重新打开页面
agent-browser open http://localhost:8521/ai-video && sleep 4

# 5. 截图验证
agent-browser screenshot --full

# 6. 检查 console 错误
agent-browser console | grep -E "\[error\]|TypeError"

# 7. 测试菜单切换
agent-browser snapshot -i -c
agent-browser click @e2  # 点击其他菜单
agent-browser click @e8  # 返回 AI 视频
```

**结论**：这次做对了 - 修复 → 部署 → **真实浏览器验证** → 确认成功 → 告诉用户

---

## 🔄 自循环修复流程（用户报错后的正确做法）

**场景**：用户说"还是报错"、"还是不行"、"你是在搞笑吗"

### ❌ 错误做法（会让用户更愤怒）

```
用户："还是报错"
我："请清除缓存试试"  ← ❌ 推卸责任
我："能提供完整的错误信息吗？" ← ❌ 增加用户负担
我："奇怪，我这边没问题" ← ❌ 暗示用户有问题
我："应该是缓存问题" ← ❌ 猜测，不负责
```

### ✅ 正确做法（立即自循环修复）

```
用户："[Error] TypeError: undefined is not an object (evaluating 'c.icon')"

第 1 步：立即承认并分析
  "明白了，错误依然存在。让我找到真正的问题。"

第 2 步：全局搜索（不要假设）
  grep -rn "const Icon = " src/  # 找到所有 .icon 访问
  grep -rn "\.icon" src/        # 更全面的搜索

第 3 步：修复所有位置（不要只修改一处）
  - App.tsx ✅
  - DynamicSidebar.tsx ✅  ← 之前忘了！
  - TaskMonitor.tsx ✅     ← 之前忘了！
  - 其他所有位置 ✅

第 4 步：重新构建并部署
  npx vite build
  rsync -avz --delete dist/ hk:/opt/.../dist/

第 5 步：确认部署成功
  ssh hk "ls -lh /opt/.../dist/assets/index-*.js | head -3"

第 6 步：只客观陈述修改
  "我修改了以下 7 处代码：[列表]，已部署（时间戳 XX:XX）"
  ❌ 不要说"应该可以了"
  ❌ 不要说"请再测试一下"
```

### 循环条件

**继续循环，直到**：
- 用户不再报错
- 或用户说"好了"、"可以了"

**不要问**：
- "现在好了吗？"
- "还有问题吗？"
- "需要我再检查什么？"

**让用户自己决定**何时停止测试。

---

## 🚨 常见错误速查表（下次遇到先查这个！）

| 错误信息 | 根本原因 | 如何验证 | 修复方法 | 验证修复 |
|---------|---------|---------|---------|---------|
| **401 Unauthorized** | 缺少 API key | `cat .env.production \| grep VITE_` | 添加 `VITE_TOAPIS_API_KEY=sk-xxx` | 重新构建+部署 |
| **400 first_frame_image 格式无效** | ImageUploader 返回 data URL | `grep "uploadImage" ImageUploader.tsx` | 组件调用 `uploadImage()` API | 清除缓存测试 |
| **400 格式无效（再次出现）** | **部署了旧版本** | `ssh hk "stat /opt/.../index.html"` | **重新部署最新代码** | 检查时间戳 |
| **502 Bad Gateway** | nginx 无法访问后端 | `docker exec ... curl http://100.86.118.99:5680` | 修改 nginx proxy_pass | 从容器内测试 |
| **504 Gateway Timeout** | 防火墙阻止 | `ssh hk "iptables -L INPUT \| grep 5680"` | 添加 iptables 规则 | netstat 检查监听 |
| **页面还是旧的** | 浏览器缓存 | F12 → Network → 检查文件哈希 | Ctrl+Shift+R 硬刷新 | 无痕模式验证 |
| **侧边栏没有菜单** | 缺 feature flag | `grep "ai-video-generation" InstanceContext.tsx` | 添加到 features 对象 | 清除缓存 |
| **TypeError: undefined is not an object (evaluating 'c.icon')** | 菜单项或组件缺少 icon 属性 | `grep -n "const Icon = " src/**/*.tsx` | 所有 `.map((item) => { const Icon = item.icon; })` 前加 `.filter(item => item && item.icon)` | 重新构建+部署 |

---

## 📋 防呆检查清单（每次部署必做）

**部署前 (5 分钟)**：
- [ ] 读取所有相关文件（不假设任何东西）
- [ ] 检查环境变量 `cat .env.production`
- [ ] 检查代码是否调用正确的 API
- [ ] TypeScript 检查 `npx tsc --noEmit`

**部署后 (3 分钟)**：
- [ ] **检查时间戳** `ssh hk "stat /opt/.../index.html"`（最容易忘！）
- [ ] 如果涉及后端服务，从容器内测试
- [ ] 清除缓存并**自己测试一遍**
- [ ] **确认成功后才告诉用户**

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
🇭🇰 香港服务器（124.156.138.116 / hk / 100.86.118.99）
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

**唯一访问入口**：`http://perfect21:5211`（pm2 cecelia-core 服务 apps/dashboard/dist/）

**无研发/正式之分，只有一个环境。**

### 更新前端

**流程**：
```
代码修改 → /dev 工作流 → PR 合并 → build → 刷新浏览器
```

**步骤**：

1. **PR 合并到 develop 后，构建**
   ```bash
   cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
   npm run build
   ```

2. **验证**
   - 刷新：http://perfect21:5211/你的页面
   - 看不到变化：硬刷新（Cmd+Shift+R）或无痕模式（Cmd+Shift+N）

**pm2 无需重启**，build 完成后 pm2 直接服务新的 dist 文件。

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



### 问题 2：Docker 容器无法访问宿主机服务

**症状**：nginx 返回 502 Bad Gateway 或 504 Gateway Timeout

**原因**：
- 使用了 `127.0.0.1` 或 `host.docker.internal`
- 防火墙阻止了连接

**排查步骤**：

1. **检查 nginx 配置**
   ```bash
   ssh hk "docker exec autopilot-prod cat /etc/nginx/conf.d/default.conf | grep proxy_pass"
   ```

2. **测试从容器内访问**
   ```bash
   # ❌ 错误：无法解析
   ssh hk "docker exec autopilot-prod curl -v http://host.docker.internal:5680"

   # ✅ 正确：使用 Tailscale IP
   ssh hk "docker exec autopilot-prod curl -s http://100.86.118.99:5680"
   ```

3. **检查防火墙规则**
   ```bash
   ssh hk "sudo iptables -L INPUT -n --line-numbers | grep 5680"
   ```

**解决方案**：

1. **使用 Tailscale IP（推荐）**
   ```nginx
   location /api/n8n-webhook/upload-video-frame {
       proxy_pass http://100.86.118.99:5680/upload-video-frame;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       client_max_body_size 10M;
   }
   ```

2. **或者添加防火墙规则**
   ```bash
   # 允许 Docker 网络访问
   ssh hk "sudo iptables -I INPUT 1 -s 172.17.0.0/16 -p tcp --dport 5680 -j ACCEPT"
   ssh hk "sudo iptables -I INPUT 1 -s 172.19.0.0/16 -p tcp --dport 5680 -j ACCEPT"

   # 保存规则
   ssh hk "sudo mkdir -p /etc/iptables && sudo iptables-save | sudo tee /etc/iptables/rules.v4"
   ```

3. **重新加载 nginx**
   ```bash
   ssh hk "docker exec autopilot-prod nginx -s reload"
   ```

---

### 问题 3：服务器监听地址错误

**症状**：从容器内无法连接到服务

**原因**：服务监听在 `127.0.0.1`

**检查**：
```bash
ssh hk "netstat -tuln | grep 5680"
# 如果显示 127.0.0.1:5680，说明只监听本地
```

**解决**：
```javascript
// ❌ 错误
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server listening on port ${PORT}`);
});

// ✅ 正确
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
```

**重启服务后验证**：
```bash
ssh hk "netstat -tuln | grep 5680"
# 应该显示 0.0.0.0:5680
```

---

---

## 📋 完整部署检查清单（CRITICAL）

**每次修改前端代码时，必须按此流程执行！**

### Phase 1: 需求分析（写代码前）

- [ ] **读取所有相关文件**（不要假设）
  ```bash
  # API 文件
  cat apps/dashboard/src/api/xxx.api.ts

  # 组件文件
  cat apps/dashboard/src/components/xxx/Component.tsx

  # 类型定义
  cat apps/dashboard/src/types/xxx.types.ts

  # 环境变量
  cat apps/dashboard/.env.production

  # nginx 配置（如果涉及 API 代理）
  ssh hk "docker exec autopilot-prod cat /etc/nginx/conf.d/default.conf"
  ```

- [ ] **检查完整调用链**
  ```
  用户操作 → 组件 → API → 环境变量
            ↓
          nginx 代理（如果有）
            ↓
          服务器端服务（如果有）
  ```

### Phase 2: 代码修改（从底层到顶层）

**优先级顺序**：
1. 环境变量 (`.env.production`)
2. 后端服务（如 `image-upload-server.js`）
3. API 函数（`video-generation.api.ts`）
4. 类型定义（`video-generation.types.ts`）
5. 组件（`ImageUploader.tsx`）
6. 页面（`AiVideoGenerationPage.tsx`）

### Phase 3: 后端服务配置（如果需要）

- [ ] **检查服务器监听地址**
  ```javascript
  // ❌ 错误：Docker 容器无法访问
  app.listen(PORT, '127.0.0.1', callback);

  // ✅ 正确：允许容器访问
  app.listen(PORT, '0.0.0.0', callback);
  ```

- [ ] **检查防火墙规则**（Docker 访问宿主机端口）
  ```bash
  # 允许 Docker 网络访问
  ssh hk "sudo iptables -I INPUT 1 -s 172.17.0.0/16 -p tcp --dport <PORT> -j ACCEPT"
  ssh hk "sudo iptables -I INPUT 1 -s 172.19.0.0/16 -p tcp --dport <PORT> -j ACCEPT"

  # 持久化规则
  ssh hk "sudo mkdir -p /etc/iptables && sudo iptables-save | sudo tee /etc/iptables/rules.v4"
  ```

- [ ] **检查 nginx 代理配置**
  ```nginx
  # ❌ 错误：从容器内指向自己
  proxy_pass http://127.0.0.1:<PORT>;

  # ❌ 错误：Linux Docker 不支持
  proxy_pass http://host.docker.internal:<PORT>;

  # ✅ 正确：使用 Tailscale IP
  proxy_pass http://100.86.118.99:<PORT>;

  # ✅ 备选：Docker bridge（需防火墙规则）
  proxy_pass http://172.17.0.1:<PORT>;
  ```

### Phase 4-10: [省略，参考完整文件]

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

### 问题 2：Cecelia 前端改了看不到变化

**原因**：忘记 build，pm2 服务的是旧的 dist 文件

**解决方案**：
```bash
cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
npm run build
# 然后刷新 perfect21:5211（Cmd+Shift+R 硬刷新）
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
   # Cecelia
   pm2 status cecelia-core

   # ZenithJoy - 香港
   ssh hk "docker ps | grep autopilot"
   ```

4. **查看日志**
   ```bash
   # Cecelia
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

### Cecelia（5211，美国，唯一环境）

```bash
# 构建（改完代码后执行）
cd /home/xx/perfect21/cecelia/workspace/apps/dashboard
npm run build
# pm2 无需重启，刷新 perfect21:5211 即可

# 查看 pm2 日志
pm2 logs cecelia-core

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
- [ ] `npm run build` 已执行
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

| 项目 | 部署位置 | 访问入口 | 公网域名 | 更新方式 |
|------|----------|----------|----------|---------|
| **Cecelia** | 🇺🇸 美国 | perfect21:5211 (pm2) | 无 | npm run build → 刷新浏览器 |
| **ZenithJoy** | 🇭🇰 香港 | 520/521 (nginx) | autopilot.zenjoymedia.media | build → rsync → hk |

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
