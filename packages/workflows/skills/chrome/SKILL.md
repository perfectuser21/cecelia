---
name: chrome
description: 浏览器操控双工具方案。agent-browser（省 context 快速巡检）+ chrome-devtools MCP（深度调试）。不用 Playwright。触发词：看一下、截图、页面效果、验证前端。
---

# 浏览器操控（双工具方案）

两个工具，不需要 Playwright。

## 什么时候用哪个

### 用 agent-browser（通过 Bash 调用）

- 快速看一眼页面长什么样
- 批量巡检多个页面截图
- 简单点击/填表交互
- context 快满了但还需要看页面

### 用 chrome-devtools MCP（MCP 工具调用）

- 页面报错，需要看 console error/warn
- API 调不通，需要看 network 请求 + status code + response body
- 性能慢，需要跑 performance trace
- 等数据加载完（wait_for 可靠，agent-browser 的 wait 不可靠）
- 需要精确的页面内容（snapshot 返回完整 a11y 树）

### 决策流程

```
需要浏览器？
├── 只是看看/截图 → agent-browser
├── 需要调试（console/network/performance）→ chrome-devtools MCP
├── 页面有异步数据要等加载 → chrome-devtools MCP（wait_for 可靠）
└── 批量检查 5+ 页面 → agent-browser（省 context）
```

---

## agent-browser 使用指南

### 初始化（每次会话第一次用时执行）

```bash
# 1. 打开任意页面（自动启动 headless Chromium）
agent-browser open http://localhost:5212/dashboard

# 2. 注入 cookie（⚠️ 必须用 eval，不要用 cookies set 命令，有 bug）
agent-browser eval "document.cookie = 'user=' + encodeURIComponent(JSON.stringify({id:'dev',name:'开发者'})) + ';path=/;max-age=86400'; document.cookie = 'token=fake-token-for-local-test;path=/;max-age=86400'"

# 3. 重新打开目标页面（cookie 生效）
agent-browser open http://localhost:5212/目标页面
```

### 常用命令

```bash
# 截图
agent-browser screenshot                    # 当前视口
agent-browser screenshot --full             # 全页面
agent-browser screenshot /tmp/page.png      # 保存到文件

# 获取元素
agent-browser snapshot -i                   # 只返回可交互元素（按钮/链接/输入框）
agent-browser snapshot                      # 完整页面树（含所有文本内容）
agent-browser snapshot -i -c                # 交互元素 + 紧凑模式

# 交互
agent-browser click @e1                     # 点击（ref 来自 snapshot）
agent-browser fill @e2 "文本"               # 清空后填写
agent-browser press Enter                   # 按键
agent-browser scroll down 500               # 滚动

# 导航
agent-browser open http://localhost:5212/new-page
agent-browser back
agent-browser reload

# 获取信息
agent-browser get title                     # 页面标题
agent-browser get url                       # 当前 URL
agent-browser get text @e1                  # 元素文本

# JS 执行
agent-browser eval "document.querySelectorAll('button').length"

# 网络请求（只有 URL 列表，无 status code）
agent-browser network requests --clear      # 清空
agent-browser network requests              # 列出
agent-browser network requests --filter "api"  # 过滤
```

### 实测踩坑（重要）

1. **`cookies set` 命令有 bug**：`--name` flag 会变成 cookie 名字的一部分。永远用 `eval` 注入 cookie
2. **`console` 输出极度嘈杂**：会混入其他页面/第三方脚本的日志，基本不可用于调试。查 console 必须用 chrome-devtools
3. **`wait` 文本匹配不可靠**：实测在我们的 SPA 上超时失败。需要等数据加载时用 `sleep` 或改用 chrome-devtools 的 `wait_for`
4. **没有智能页面加载等待**：`open` 返回后页面可能还没渲染完，API 数据还没到。复杂页面截图前加 `sleep 3-5`
5. **`network requests` 无 status code**：只能看到 URL 和类型，看不到 200/404/502 状态码，看不到 response body
6. **@ref 会过期**：每次导航/提交后必须重新 `snapshot -i` 获取新 ref
7. **独立浏览器实例**：和 chrome-devtools MCP 是两个 Chromium，cookie/状态不共享

### 批量巡检

```bash
# 初始化 + cookie
agent-browser open http://localhost:5212/dashboard
agent-browser eval "document.cookie = 'user=' + encodeURIComponent(JSON.stringify({id:'dev',name:'开发者'})) + ';path=/;max-age=86400'; document.cookie = 'token=fake-token-for-local-test;path=/;max-age=86400'"

# 逐页截图
for page in /dashboard /today /work /knowledge /system; do
  agent-browser open "http://localhost:5212$page"
  sleep 2
  agent-browser screenshot "/tmp/audit${page//\//-}.png"
done
```

---

## chrome-devtools MCP 使用指南

### 基础操作

```
# 导航（自动等待页面加载完成）
mcp__chrome-devtools__navigate_page → type: "url", url: "http://localhost:5212/xxx"

# 等待特定文本出现（可靠，适合等 API 数据）
mcp__chrome-devtools__wait_for → text: "目标文本", timeout: 10000

# 截图
mcp__chrome-devtools__take_screenshot
mcp__chrome-devtools__take_screenshot → fullPage: true

# 页面快照（完整 a11y 树，含所有文本和 uid）
mcp__chrome-devtools__take_snapshot

# 交互
mcp__chrome-devtools__click → uid: "元素uid"
mcp__chrome-devtools__fill → uid: "输入框uid", value: "内容"
mcp__chrome-devtools__press_key → key: "Enter"
```

### 调试能力（agent-browser 没有的）

```
# Console 日志（精确过滤）
mcp__chrome-devtools__list_console_messages → types: ["error", "warn"]
mcp__chrome-devtools__get_console_message → msgid: 123

# Network 请求（有 status code，可查 response body）
mcp__chrome-devtools__list_network_requests → resourceTypes: ["fetch", "xhr"]
mcp__chrome-devtools__get_network_request → reqid: 456

# 性能分析
mcp__chrome-devtools__performance_start_trace → reload: true, autoStop: true
mcp__chrome-devtools__performance_stop_trace
mcp__chrome-devtools__performance_analyze_insight → insightSetId, insightName

# JS 执行
mcp__chrome-devtools__evaluate_script → function: "() => { return 42; }"
```

### Cookie 注入

```
mcp__chrome-devtools__evaluate_script → function:
  "() => {
    document.cookie = 'user=' + encodeURIComponent(JSON.stringify({id:'dev',name:'开发者'})) + ';path=/;max-age=86400';
    document.cookie = 'token=fake-token-for-local-test;path=/;max-age=86400';
    return 'done';
  }"
```

---

## 本地端口映射

| 外网域名 | localhost | 说明 |
|---------|-----------|------|
| core.zenjoymedia.media | localhost:5211 | Core (pm2 直连) |
| dev-core.zenjoymedia.media | localhost:5212 | Core (Docker proxy，推荐) |
| autopilot.zenjoymedia.media | localhost:5211 | Autopilot |

localhost 直接访问绕过飞书扫码认证，只需注入 user cookie。

---

## 典型工作流

### 快速验证改动

```
1. 改代码 → 构建 → 重启
2. agent-browser open http://localhost:5212/目标页面
3. sleep 3 && agent-browser screenshot
4. 不满意 → 改代码 → 重复
```

### 排查页面报错

```
1. chrome-devtools: navigate_page → 有问题的页面
2. chrome-devtools: list_console_messages → types: ["error"]
3. chrome-devtools: list_network_requests → resourceTypes: ["fetch"]
4. chrome-devtools: get_network_request → 看具体 status code + response
5. 定位问题 → 修代码
```

### 批量页面巡检

```
1. agent-browser 初始化 + cookie
2. 循环 open + sleep + screenshot 每个页面
3. 逐张查看截图，记录有问题的页面
4. 对有问题的页面切 chrome-devtools 深入排查
```

### 性能分析

```
1. chrome-devtools: navigate_page → 目标页面
2. chrome-devtools: performance_start_trace → reload: true, autoStop: true
3. 等待 trace 完成
4. chrome-devtools: performance_analyze_insight → 查看 CWV 和瓶颈
```

---

## 实测对比总结（2026-02-06）

| 功能 | agent-browser | chrome-devtools MCP |
|------|:---:|:---:|
| 截图 | ✅ 清晰，省 context | ✅ 清晰 |
| Snapshot | ✅ 完整/交互两种模式 | ✅ 完整 a11y 树 |
| 点击/填表 | ✅ @ref 简洁 | ✅ uid 完整 |
| JS eval | ✅ | ✅ |
| Wait for element | ❌ 不可靠，SPA 上超时 | ✅ 可靠 |
| Console 日志 | ❌ 噪音太多不可用 | ✅ 精确过滤 |
| Network 请求 | ⚠️ 只有 URL，无 status | ✅ status + response body |
| Performance | ❌ 无 | ✅ 完整 trace |
| Cookie 管理 | ❌ CLI 有 bug，只能用 eval | ✅ eval 正常 |
| 页面加载等待 | ❌ 需手动 sleep | ✅ 自动等待 |
| Context 消耗 | ✅ 极少 | ❌ 较多（~18K tokens） |
