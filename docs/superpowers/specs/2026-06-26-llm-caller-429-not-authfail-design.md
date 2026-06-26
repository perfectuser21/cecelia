# llm-caller 把 429 限流误判为 auth 失败 — 修复设计（2026-06-26）

## 背景 / Bug

`account1` token 实测有效（usage API 200），却被 brain 反复 `markAuthFailure` 熔断（count 38→50），
`resolveAccount` 选不出账号 → harness planner "Not logged in"、认知核心降级 MiniMax。

## 根因（已实证）

1. **bridge 丢弃真实错误**：`cecelia-bridge.cjs` 用 `--output-format text`，且 `code!=0` 时
   `error: stderr.slice(0,500) || "exit code ${code}"`（line 209-211）——**只取 stderr、丢弃 stdout**。
   claude CLI 的错误信息（429 / "Not logged in"）走 stdout，被丢 → bridge 返回的 errText 永远是
   无信息的 `"exit code 1"`。
2. **llm-caller 一刀切熔断**：`llm-caller.js:389-398` 把任何连续 3 次 bridge `exit code 1`
   当 auth 失败 `markAuthFailure(accountId, 1h, 'api_error')`。429 限流 ≠ 认证失败。
3. **实证**：复现 `CLAUDE_CONFIG_DIR=.claude-account1 claude -p ... --output-format text` 现在
   exit=0 成功（"嗨！"）——之前的 exit code 1 是临时 429 限流（5h 窗口），不是 auth 失败。
   账号被误熔断后只能等 24h backoff 或人工清，整条 harness/认知链瘫痪。

## 方案对比

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. token 探测 gate（选）** | markAuthFailure 前用账号 token 实时调 usage API 探测有效性 | 可靠、不依赖 errText 内容；改动集中 llm-caller + 一个探测函数 |
| B. errText 关键词判别 | 从 bridge errText 找 auth 关键词 | **已证伪**：errText="exit code 1" 无信息 |
| C. bridge 改造 + errText 判别 | bridge 纳入 stdout，llm-caller 解析 429/auth 关键词 | 需改两组件，依赖未验证的 CLI stdout 错误格式，脆弱 |

选 **A**：直接验证 token 是否真失效，不依赖 bridge 透传/CLI 输出格式（最脆弱处）。

## 设计（方案 A）

### 组件 1：`verifyAccountTokenLive(accountId)`（account-usage.js 新增导出）
- 读账号 `accessToken`（复用现有 `getToken` 逻辑：`~/.claude-<accountId>/.credentials.json`）
- **实时**调 usage API（`ANTHROPIC_USAGE_API`，绕过 CACHE_TTL 缓存）
- 返回：`'valid'`（HTTP 200）/ `'auth_failed'`（401/403）/ `'unknown'`（网络错误/其他状态/无 token）

### 组件 2：llm-caller markAuthFailure gate（llm-caller.js:392-404 改）
连续 exit-1 达阈值（3）时，**不直接 markAuthFailure**，先 `await verifyAccountTokenLive(accountId)`：
- `'auth_failed'` → `markAuthFailure(accountId, ..., 'api_error')`（真失效，正确熔断）
- `'valid'` → **不熔断**；`_resetBridgeExit1(accountId)` 清计数，记 warning（限流/临时问题，交上层重试/轮换）
- `'unknown'` → **保守不熔断**，记 warning（探测失败时宁可不熔断也不误杀有效账号）

## 数据流
```
bridge 返回 500 exit-1 → llm-caller _recordBridgeExit1 计数
  → count >= 3 → await verifyAccountTokenLive(accountId)
    → valid       → 不熔断 + 清计数（限流/临时）
    → auth_failed → markAuthFailure 熔断
    → unknown     → 不熔断（保守）
```

## 错误处理
- 探测网络失败/超时 → `'unknown'` → 不熔断（保守优先，避免误杀）
- 无 accessToken → `'unknown'`（不冒进熔断；真无凭据会在别处暴露）

## 测试策略：unit（逻辑接缝）
- `llm-caller` 单测（注入 mock `verifyAccountTokenLive` + mock bridge 500 response）：
  - 3 次 exit-1 + 探测 `valid` → 断言**不**调 `markAuthFailure`（当前代码会调 → 先红后绿）
  - 3 次 exit-1 + 探测 `auth_failed` → 断言**调** `markAuthFailure`
- `verifyAccountTokenLive` 单测（mock fetch + mock 凭据读取）：
  - 200 → `valid` / 401 → `auth_failed` / 网络 err → `unknown`

## 守卫
逻辑接缝（纯判断 + mock），CI 单元测试足够；无环境接缝。

## 不包含（YAGNI）
- bridge 把 stdout 纳入 error 的可观测性改进（方案 A 已解决问题，不必动最脆弱的 bridge）
- account2 token 过期（运营问题，用户 `claude /login` 重登，非本 PR）
