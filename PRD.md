# PRD — fix(brain): feishu/impression mouth timeout 8s→60s

## 背景 / 问题

`packages/brain/src/routes/ops.js:953` `updateFeishuImpression` 调 `callLLM('mouth', prompt, { timeout: 8000 })`。

但 `mouth` provider 实际走 `cecelia-bridge` HTTP（`http://localhost:3457/llm-call`），bridge 内部跑 OAuth Claude Code（`claude -p`）。从 `bridge.log` 实测响应时间：
- haiku: 平均 10-35s
- sonnet: 4-170s（70%+ > 8s）

**8s timeout 必然超时**，每次定时任务（feishu 印象更新、ops 巡检）触发都失败，触发 mouth fallback 链：
- fallback #1: codex (refresh token 401 失效)
- fallback #2: anthropic-api (信用余额 0)
- fallback #3: anthropic 直连 (信用 0)
- 全部失败 → 印象更新永远不工作

虽然 `feishu/impression` 失败本身不直接造成 `cecelia-run` 熔断（dispatcher 不调这条），但污染 mouth 调用 success 率，让真正需要 mouth 的链路（thalamus 决策、harness graph）也踩同样陷阱。

## 成功标准

- **SC-001**: `updateFeishuImpression` 调用 mouth 的 timeout 改为 60000ms（覆盖 P95 sonnet 响应）
- **SC-002**: bridge 真实响应通常 4-30s，60s 留充足空间，wider tail（170s）由 retry 兜底，不在本 PR 范围
- **SC-003**: ops.js 不再含任何 8s timeout 用于 mouth callLLM（防回退）

## 范围限定

**在范围内**：
- ops.js:953 timeout 8000 → 60000（单行）
- 配套测试（ops.test.js）grep 验证 timeout 数字

**不在范围内**：
- 其他 callLLM('mouth', ...) timeout 调整（其他地方未发现 8s timeout）
- mouth fallback 链整体改造（PR #B 处理）
- bridge 慢响应根因调研（bridge tail latency 可单独 PR）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/routes/ops.js` `callLLM('mouth', ...)` timeout 改为 60000
- [x] [ARTIFACT] `packages/brain/src/routes/__tests__/ops.test.js` 新增 2 个 it 用例
- [x] [BEHAVIOR] tests/routes/ops: feishu impression timeout 测试通过（grep 源码验证 timeout >= 60000 且不再含 8000）

## 受影响文件

- `packages/brain/src/routes/ops.js` — line 953 timeout 8000 → 60000 + 注释
- `packages/brain/src/routes/__tests__/ops.test.js` — 加 describe block 验证 timeout 值

## 部署后验证

merge 到 main + Brain 重启后：
1. `tail -f logs/brain-error.log | grep "feishu/impression"` 应该停止报 timeout 错误
2. `tail -f logs/bridge.log | grep "feishu"` 应该看到 mouth 调用真实完成（不被 8s 截断）
3. user_profile_facts 表 feishu_group_impression 行数应该开始增长
