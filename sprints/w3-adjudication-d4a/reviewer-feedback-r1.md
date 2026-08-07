# Reviewer Feedback Round 1 → Proposer Round 2

## verdict: REVISION

## P0（必须修复，影响合同正确性）

### P0-1：G2 场景硬编码格号违反 Invariant-2
- 位置：`contract-draft.md` 场景 G2 的 `PATCH .../checks/S13-c4/adjudicate`
- 问题：将 `S13-c4` 硬编码为 unverifiable 格，违反 PRD Invariant-2「禁止硬编码格号」
- 修复：G2 场景改为「某格 scenario_class='unverifiable_this_version'」，格号用变量 `__UNVERIFIABLE_CHECK_KEY__` 或注释说明「通过查 yaml 确定格号」

### P0-2：abandon 端点 HTTP 方法矛盾
- PRD FR-4 原文：`POST /acceptance/runs/:run_key/abandon`
- contract-draft 路由标题：`PATCH /api/brain/acceptance/runs/:run_key/abandon`
- 测试文件：使用 `.patch()`
- 修复：统一为 PATCH（与测试实现一致），并在 contract-draft 中注明方法选择原因

## P1（影响覆盖完整性/语义准确性，必须修复）

### P1-1：FR-5 第二个测试断言过于宽松
- 当前：`expect(uniqueBuckets.length).toBeGreaterThanOrEqual(1)` — 只验证「至少 1 个 bucket」
- 修复：`expect(insertedBuckets).toContain('bug'); expect(insertedBuckets).toContain('trace')` — 两个 bucket 必须同时存在

### P1-2：FR-3 正常分流缺少下界断言
- 当前：'bug 任务 ≤1，trace 任务 ≤1' 只设上界
- 修复：补充「当有红格时 bug 任务 = 1」的下界断言

### P1-3：fission/infra_error P0 任务 priority 字段缺乏断言
- 当前：仅验证 `acceptance_bucket='fission'`，未验证 `priority='P0'`
- 修复：fission 和 infra_error 路径的任务断言加 priority='P0' 字段验证

## P2（建议补充，可选）

- run_key 不存在时的 404 行为（adjudicate/adjudicate-run/abandon 三端点各补一条）
- FR-2 yaml 解析路径验证（通过 spy 验证 yaml 解析函数被调用，防止硬编码格号绕过）
