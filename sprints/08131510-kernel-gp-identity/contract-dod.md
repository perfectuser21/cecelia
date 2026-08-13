# Contract DoD — Journey-only GP Contract Identity Fix

Sprint: `08131510-kernel-gp-identity`
Task ID: `b858a8bb-a5c4-4e84-a975-a6cd79b55be0`

---

## 验收标准（Definition of Done）

所有条目必须全部通过，合同方为 DONE。

---

### [BEHAVIOR] DoD-1：journey-only 路径不再 assembly_fault（主 bug 修复）

**断言**：payload 仅含 `journey_id`（无任何 GP 合同身份字段），dispatch `spawn:generator-fix`：
- `createAttempt` 被调用（组包成功，无异常上抛）
- `bundle.inputs` **不含** `gp_contract` 字段
- dispatch 返回对象 `status` 为 `'LAUNCHED'`（非 `assembly_fault`）

**验证命令**（target_environment: local_api）：
manual:bash
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  --reporter=verbose \
  -t "journey-only"
```
期望 exit code: 0

---

### [BEHAVIOR] DoD-2：部分 GP 身份 fail-closed

**断言**：payload 含 `journey_id` + `golden_path_id`，缺 `gp_contract_id` / `gp_contract_version` / `gp_contract_hash` / `step_id`：
- dispatch 抛出错误或返回表示 `assembly_fault` 的结果
- 错误信息/detail 包含 `GP_CONTRACT_IDENTITY_INVALID`

**验证命令**：
manual:bash
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  --reporter=verbose \
  -t "部分 GP"
```
期望 exit code: 0

---

### [BEHAVIOR] DoD-3：完整 GP 路径回归不回退

**断言**：payload 含 6 字段齐全（id/version/hash/golden_path_id/journey_id/step_id），dispatch `spawn:evaluator`：
- `bundle.inputs.gp_contract` 注入正确结构
- `bundle.inputs.gp_contract.version` 为整数（非字符串）

**验证命令**（对应 dispatcher.test.js line 135 已有用例）：
manual:bash
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  --reporter=verbose \
  -t "冻结 GP Contract"
```
期望 exit code: 0

---

### [BEHAVIOR] DoD-4：全量 dispatcher 单测绿态

**断言**：全部现有 dispatcher 测试不回退

**验证命令**：
manual:bash
```bash
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  --reporter=verbose
```
期望 exit code: 0，所有测试绿态

---

### [BEHAVIOR] DoD-5：无文件范围溢出

**断言**：本次 PR diff 仅含以下文件（不多不少）：
- `packages/brain/src/orchestrator/dispatcher.js`
- `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- `sprints/08131510-kernel-gp-identity/`（合同文件，非代码）

**验证方法**：`git diff --name-only origin/main...HEAD` 不含其他 `packages/brain/src/` 路径

---

## 铁律检查点

| 铁律 | 本 sprint 影响 | 验收状态 |
|------|--------------|---------|
| 验证时钟 fail-closed | 不涉及，不改 validation_clock | N/A（无需额外验证） |
| 证据窗口（前 8 条 × 600 字符） | 不涉及，不改 judge 流程 | N/A（无需额外验证） |
| 合同验证命令实跑 | DoD-1~DoD-4 命令已验证 exit code 语义 | 须由 proposer 在推送前实跑确认 |

---

## 累积 FR 守护

| FR | 覆盖用例 | 是否有被回退风险 |
|----|---------|---------------|
| 冻结 GP Contract 身份注入 TaskBundle | `dispatcher.test.js` line 135 | 低（DoD-3 直接覆盖该用例） |
| `gpContractIdentity` 完整路径 version 转整数 | `dispatcher.test.js` line 162 断言 `version: 1`（整数） | 低（修复不改校验逻辑） |
