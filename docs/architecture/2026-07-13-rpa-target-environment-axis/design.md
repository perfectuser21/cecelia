# RPA 开发快验通道 (execFile channel) 设计文档

**日期**: 2026-07-13  
**状态**: 实施中  
**优先级**: P0（rpa-loop T1，三线共享唯一真堵点）

---

## 1. 背景与目标

Generator / 开发者在容器内修改 RPA 代码后，需要一种轻量的方式在真机（研发机=ROG/Windows）跑一次测试动作并**同步拿回完整输出**（stdout + exit_code），而不是通过 SSH、不给每条线配不同的远程协议。

三条业务线（微信 Python / 抖音安卓 ADB 广播 / 发布 CDP）共享同一通道，只是拉起的脚本不同。

---

## 2. 架构

```
[容器/开发者]
      ↓  POST /api/brain/rpa/dev-verify
[Brain :5221]
      ↓  HTTP POST → RPA_AGENT_URL (默认 http://localhost:5200)
             /api/agent-ops/rpa/dev-verify
[ZenithJoy Agent :5200 (ROG/本机)]
      ↓  execFile → 受控脚本
[本地 Python/ADB/CDP 进程]
      ↑  stdout + exit_code (同步返回，≤ timeout_ms)
[Brain → 调用方]
```

通道名称 "agent execFile"：Agent 服务接收到请求后，内部使用 Node.js `execFile` 拉起受控 RPA 脚本，不接受任意命令。

---

## 3. 合同点（Contract）

### 3.1 命令契约

**Request** `POST /api/brain/rpa/dev-verify`

```json
{
  "line": "wechat" | "douyin" | "publish",
  "action": "<whitelist-action>",
  "params": { ... },
  "timeout_ms": 30000
}
```

**Response 200**（成功）

```json
{
  "ok": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "elapsed_ms": 1234
}
```

**Response 400**（参数错误 / action 不在白名单）

```json
{ "ok": false, "error": "action_not_allowed", "allowed": ["health_check", "..."] }
```

**Response 504**（超时）

```json
{ "ok": false, "error": "timeout", "timeout_ms": 30000 }
```

**Response 502**（Agent 不可达）

```json
{ "ok": false, "error": "agent_unreachable", "message": "..." }
```

### 3.2 安全白名单

| line | 允许的 action |
|------|--------------|
| `wechat` | `health_check`, `send_message`, `screenshot`, `click`, `read_inbox` |
| `douyin` | `health_check`, `broadcast`, `status` |
| `publish` | `health_check`, `cdp_click`, `cdp_screenshot`, `cdp_navigate` |

**绝对禁止**：`shell`, `exec`, `eval`, `run_script`（任意命令执行）。

### 3.3 失败/超时语义

| 场景 | Brain 行为 |
|------|-----------|
| Agent HTTP 错误（4xx/5xx） | 透传 Agent 的 error 字段 + HTTP 502 |
| Agent 不可达（网络超时/拒连） | 502 `agent_unreachable` |
| Agent 运行超时（execFile 内部） | Agent 返回 exit_code≠0 + stderr，Brain 透传 |
| Brain→Agent HTTP 超时（timeout_ms） | Brain 放弃等待，返回 504 |
| timeout_ms 未传 | 默认 30000ms；上限 60000ms（Brain 强制截断） |

---

## 4. 跨 Repo 分工

| Repo | 文件 | 职责 |
|------|------|------|
| **cecelia** | `packages/brain/src/routes/rpa-dev-verify.js` | Brain 端点：参数校验 + 白名单检查 + 代理到 Agent |
| **cecelia** | `server.js` | 注册路由 `app.use('/api/brain/rpa', rpaDevVerifyRouter)` |
| **zenithjoy-workspace** | `services/agent/src/handlers/rpa-dev-verify.ts` | Agent 端点：接收请求 + execFile 执行受控脚本 + 返回 stdout/exit_code |
| **zenithjoy-workspace** | `services/agent/src/index.ts` | 注册 `/api/agent-ops/rpa/dev-verify` 路由 |

---

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RPA_AGENT_URL` | `http://localhost:5200` | ZenithJoy Agent 的 base URL |
| `RPA_DEV_VERIFY_ENABLED` | `true` | 关闭开关（生产禁用时设 false） |

---

## 6. 测试计划

- Brain 路由单测：白名单拒绝、timeout 代理、成功路径（mock fetch）
- Agent handler 单测（zenithjoy-workspace）：三线 execFile 调用、超时、stderr 透传
- E2E（windows_cloud runner）：wechat line → health_check → 验证 exit_code=0 + stdout 非空
