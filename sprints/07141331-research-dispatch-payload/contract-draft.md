# Contract Draft: research 任务派发 payload 缺 callback_url 修复

## 问题陈述

`buildCodexBridgePayload`（executor.js:2594）构造的 POST payload 缺少 `callback_url` 字段，
导致 xian bridge `/run` 端点返回 `{ ok: false, error: "task_id 和 callback_url 必填" }`，
dispatcher 累积 `recordFailure('cecelia-run')` 直至熔断器 OPEN，堵塞全队列 34 分钟。

## 修复范围

**唯一改动点**：`packages/brain/src/executor.js` 的 `buildCodexBridgePayload` 函数，
在返回对象中加入：
```js
callback_url: `${process.env.BRAIN_URL || 'http://localhost:5221'}/api/brain/execution-callback`,
```

**不动**：熔断器逻辑、dispatcher 候选选择、测试 fetch 不真调外部。

## Test Contract 表

| # | [BEHAVIOR] 描述 | 对应 it() 测试名称（子串） | 优先级 |
|---|----------------|--------------------------|--------|
| 1 | research 任务 payload 包含 callback_url | `research 任务的 payload 必须包含 callback_url` | P0 |
| 2 | callback_url 指向 BRAIN_URL env | `callback_url 指向 BRAIN_URL env 配置的地址` | P0 |
| 3 | BRAIN_URL 未设置时降级 localhost:5221 | `BRAIN_URL 未设置时 callback_url 降级到 localhost:5221` | P0 |
| 4 | codex_dev 等其他 xian task_type 同样携带 callback_url | `其他 xian task_type 同样携带 callback_url` | P1 |
| 5 | bridge 拒绝缺 callback_url 时 success=false（修复前 failing） | `bridge 拒绝缺 callback_url 时返回 success=false` | P0 |

## E2E 验收

```bash
# E2E 验收脚本（本地 API 环境）
# 验证：单元测试全绿 + 现有 xian bridge 回归无破坏

set -e

cd /workspace

# 1. 目标测试文件存在
test -f packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js \
  && echo "✓ 测试文件存在"

# 2. 目标测试全绿
npx vitest run packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js \
  && echo "✓ callback_url 测试全绿"

# 3. 关键回归测试
npx vitest run packages/brain/src/__tests__/executor-route-override.test.js \
  && echo "✓ executor route-override 回归通过"

# 4. executor.js 内 buildCodexBridgePayload 包含 callback_url 字段（静态 grep）
grep -q "callback_url" packages/brain/src/executor.js \
  && echo "✓ executor.js 含 callback_url 字段"

echo "=== E2E 验收通过 ==="
```

## 未覆盖真实链路清单

N/A — 本次修复不依赖真实 xian bridge（全部 mock），且单字段改动无需真实 E2E 派发验证。
