# Contract DoD: research 任务派发 callback_url 修复

## 定义完成标准

### [BEHAVIOR] B-1: research 任务 payload 包含 callback_url
`buildCodexBridgePayload` 对 task_type=research 任务构造的 payload 必须含非空 `callback_url` 字段，
匹配正则 `/\/api\/brain\/execution-callback$/`。

### [BEHAVIOR] B-2: callback_url 读取 BRAIN_URL 环境变量
当 `process.env.BRAIN_URL = 'http://hk-vps:5221'` 时，
`payload.callback_url === 'http://hk-vps:5221/api/brain/execution-callback'`。

### [BEHAVIOR] B-3: BRAIN_URL 未设置时降级 localhost:5221
当 `process.env.BRAIN_URL` 未设置时，
`payload.callback_url === 'http://localhost:5221/api/brain/execution-callback'`。

### [BEHAVIOR] B-4: codex_dev 等其他 xian task_type 同样携带 callback_url
`buildCodexBridgePayload` 对任意 task_type（codex_dev/crystallize_forge/codex_qa 等）均携带 `callback_url`，
确认为全路径修复而非仅 research 补丁。

### [BEHAVIOR] B-5: bridge 拒绝 payload 时 triggerCodexBridge 返回 success=false
当 bridge 返回 `{ ok: false, error: "task_id 和 callback_url 必填" }` 时，
`triggerCodexBridge` 返回 `{ success: false, error: "task_id 和 callback_url 必填" }`（修复前此路径存在，修复后 bridge 不再拒绝）。

### [BEHAVIOR] B-6: 现有 executor route-override 测试不回归
`executor-route-override.test.js` 全部通过，无新失败。

### [BEHAVIOR] B-7: TDD 纪律——failing test 先于修复 commit
git log 中存在标记为 `(Red)` 的 commit（含测试文件），后续 `(Green)` commit 含 executor.js 修改。

## 铁律约束（禁止事项）

- 不改熔断器（circuit-breaker.js）逻辑：本次修复不触碰 circuit-breaker 阈值/重置策略
- 不动 dispatcher 候选选择（selectNextDispatchableTask）：只修 buildCodexBridgePayload 返回值
- 不真调外部 webhook：测试内所有 fetch 调用必须使用 vi.fn() mock，禁止真实网络请求
- regression test 永久进 CI，不得删除，每次 push 必须全部通过

## DoD 勾选清单

- [ ] 测试文件 `packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js` 已创建并在 (Red) commit 提交
- [ ] `executor.js` `buildCodexBridgePayload` 加入 `callback_url` 字段
- [ ] 5 条 B-1~B-5 测试用例全绿
- [ ] `executor-route-override.test.js` 全部通过（B-6）
- [ ] CI `brain-ci.yml` 全绿

## manual:bash 验收命令

```bash
# 验收步骤（在 /workspace 下执行）

# 1. TDD 纪律：存在 (Red) commit
git log --grep='(Red)' --oneline HEAD | grep -q "Red" && echo "✓ (Red) commit 存在"

# 2. callback_url 测试全绿
cd /workspace && npx vitest run packages/brain/src/__tests__/codex-bridge-payload-callback-url.test.js 2>&1 | tail -5

# 3. executor.js 已含 callback_url
grep -n "callback_url.*execution-callback\|execution-callback.*callback_url" \
  packages/brain/src/executor.js | head -5

# 4. 回归测试通过
cd /workspace && npx vitest run packages/brain/src/__tests__/executor-route-override.test.js 2>&1 | tail -5

# 5. 全 brain 测试（CI 等效）
cd /workspace && npx vitest run packages/brain/src 2>&1 | tail -10
```

## 判定点登记表

| 判定点 | 条件 | Pass 标准 |
|--------|------|----------|
| DP-1 | callback_url 字段存在性 | B-1 测试绿 |
| DP-2 | BRAIN_URL 环境变量读取 | B-2/B-3 测试绿 |
| DP-3 | 全路径修复（非仅 research） | B-4 测试绿 |
| DP-4 | 回归无破坏 | B-6/B-7 通过 |
| DP-5 | TDD 纪律 | (Red) commit 存在 |
