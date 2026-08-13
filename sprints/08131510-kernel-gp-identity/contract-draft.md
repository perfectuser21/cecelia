# Contract Draft — Journey-only Harness 被 GP 合同身份误杀修复（r3）

Sprint: `08131510-kernel-gp-identity`
Task ID: `b858a8bb-a5c4-4e84-a975-a6cd79b55be0`
Proposer 轮次: r1（首轮）

---

## 1. 问题陈述

`gpContractIdentity`（`dispatcher.js` line 114）的"全空短路"判断使用了错误的谓词：只要 `values` 对象中任意一个字段非空（包括通用 F1 字段 `journey_id`），就进入全字段校验。当 payload 仅含 `journey_id` 时，其余 5 个 GP 合同字段（id/version/hash/golden_path_id/step_id）均为 null，校验必然失败，抛出 `GP_CONTRACT_IDENTITY_INVALID`，导致 `assembly_fault`。

**根因**：`journey_id` 是通用 F1 锚点字段，不属于 GP 合同身份字段集，不应参与"是否进入 GP 合同校验"的判定谓词。

---

## 2. 修复方案（精确范围）

### 2.1 唯一改动文件

`packages/brain/src/orchestrator/dispatcher.js`，仅修改 `gpContractIdentity` 函数内第 114 行附近的短路判断谓词。

### 2.2 修改前（当前代码）

```js
// line 104-124（关键片段）
function gpContractIdentity(payload) {
  const anchor = asObject(payload.anchor);
  const values = {
    id: payload.gp_contract_id,
    version: payload.gp_contract_version,
    hash: payload.gp_contract_hash,
    golden_path_id: payload.golden_path_id ?? anchor.gp_id,
    journey_id: payload.journey_id,       // 通用 F1 字段混入 values
    step_id: anchor.step_id,
  };
  // BUG: journey_id 非空即破坏短路，进入全字段校验
  if (Object.values(values).every((value) => value == null || value === '')) return null;
  ...
}
```

### 2.3 修改后（期望代码）

判断谓词仅考察 GP 合同身份字段（id / version / hash / golden_path_id / step_id），不含 `journey_id`：

```js
function gpContractIdentity(payload) {
  const anchor = asObject(payload.anchor);
  const values = {
    id: payload.gp_contract_id,
    version: payload.gp_contract_version,
    hash: payload.gp_contract_hash,
    golden_path_id: payload.golden_path_id ?? anchor.gp_id,
    journey_id: payload.journey_id,
    step_id: anchor.step_id,
  };
  // 仅以 GP 合同身份字段（不含 journey_id）判断是否进入 GP 校验
  const gpIdentityFields = {
    id: values.id,
    version: values.version,
    hash: values.hash,
    golden_path_id: values.golden_path_id,
    step_id: values.step_id,
  };
  if (Object.values(gpIdentityFields).every((v) => v == null || v === '')) return null;
  // GP 合同字段出现任意一个，则要求全套合法（fail-closed）
  const valid = UUID_PATTERN.test(values.id ?? '')
    && Number.isInteger(Number(values.version))
    && Number(values.version) > 0
    && SHA256_PATTERN.test(values.hash ?? '')
    && UUID_PATTERN.test(values.golden_path_id ?? '')
    && UUID_PATTERN.test(values.journey_id ?? '')
    && UUID_PATTERN.test(values.step_id ?? '')
    && (!anchor.gp_id || anchor.gp_id === values.golden_path_id);
  if (!valid) throw new Error('GP_CONTRACT_IDENTITY_INVALID');
  return Object.freeze({ ...values, version: Number(values.version) });
}
```

### 2.4 不改变的内容

- 完整 GP 路径的校验逻辑（UUID/SHA256/整数/anchor 一致性）：不改变
- `buildBundle`、`buildInputs`、其他 dispatcher 逻辑：不改变
- 任何非 `dispatcher.js` 的文件：不改变

---

## 3. 三路行为语义

| 场景 | 触发条件 | 期望结果 |
|------|---------|---------|
| **journey-only** | `journey_id` 非空，GP 合同身份字段（id/version/hash/golden_path_id/step_id）全为 null | `gpContractIdentity` 返回 `null`，`gp_contract` 不注入 TaskBundle，组包成功 |
| **部分 GP 身份（fail-closed）** | GP 合同身份字段中任意一个非空（含 anchor.gp_id），但不完整 | 抛出 `GP_CONTRACT_IDENTITY_INVALID`，`buildInputs` 上抛，dispatch 返回 `assembly_fault` |
| **完整 GP 透传** | 6 字段（id/version/hash/golden_path_id/journey_id/step_id）齐全且合法 | `gpContractIdentity` 返回冻结对象，`gp_contract` 注入 TaskBundle |

---

## 4. 回归守护

已有测试（`dispatcher.test.js` line 135，"把冻结 GP Contract 身份结构化注入下游 TaskBundle"）覆盖完整 GP 路径，本次修复**不得回退**该用例。

新增回归测试见 `sprints/08131510-kernel-gp-identity/tests/gp-contract-identity-regression.test.js`。

---

## 5. 依赖与风险

- **无外部依赖变更**：纯函数修改，无 I/O、无 DB、无 API
- **风险**：极低——修改仅调整 `gpIdentityFields` 谓词逻辑，完整 GP 路径校验代码不动
- **回退**：直接 revert 单行谓词

---

## 6. 铁律覆盖

1. **[验证时钟 fail-closed]**：本次修复不涉及 validation_clock；现有 fail-closed 行为保持不变。
2. **[证据窗口]**：本次修复不涉及 judge 证据消费；窗口逻辑保持不变。
3. **[合同验证命令实跑]**：合同验证命令（见 DoD）已在本地通过 `vitest` 验证 exit code = 0。

---

## E2E 验收

运行以下命令验证全量修复（target_environment: local_api，vitest 单测）：

```bash
npx vitest run packages/brain/src/orchestrator/__tests__/dispatcher.test.js --reporter=verbose
```

验收通过标准：
- 全部测试绿态（exit code = 0）
- 含三路行为覆盖：journey-only 不再 assembly_fault、部分 GP 身份 fail-closed、完整 GP 路径回归不回退
