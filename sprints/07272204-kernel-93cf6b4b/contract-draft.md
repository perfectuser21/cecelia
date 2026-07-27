# Sprint Contract Draft (Round 1)

## 锚定父路声明

覆盖父路 Cecelia Harness Pipeline F1 第 1-4 步

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应

## 已知约束（来自回归测试）

- [packages/brain/scripts/__tests__/harness-report.test.mjs] → feature 三锚字段皆空时，只能用 PR changed files 自动回填 `unit_test_path`；已有锚点时不得覆盖。
- [packages/brain/src/__tests__/promise-map-nightly.test.js] → 家②/家③底座件缺链接必须失败；三闸文件缺失必须报警；保鲜哨兵要去重。
- [packages/brain/src/__tests__/harness-line-context-wiring.test.js] → line context 注入失败必须降级为空字符串而不是中断 proposer；有铁律时 prompt 必须带固定段头。
- [累积FR] `context-manifest: unavailable`

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 在既有 `bb8cc561-b3ee-4fec-b74d-2255694bd963` F1 Journey 上完成 current main 对账、S0-S12 归位、11要素补齐、P0/P1 等价基线回挂、fresh 验收链重建。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 所有判色只认 current SHA；旧 SHA 证据一律失效；CI 只产证据，不得直接放行 ready/merge。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量（安全/数据一致性/幂等） | 单 Journey、单 SSOT、单 current SHA；无 fresh evaluator/judge/主理人人审证据不得标 green/done。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见“判定点登记表”） | 见下方登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 任何验收证据一旦 `HEAD != evidence.sha` 立即过期；由 Harness Recovery 守卫负责重新判色。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | nightly 保鲜对账、fresh evidence gate smoke、CI core regression 任一失败即报警。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | current main 对账失败、assertion_ref 缺失、fresh verdict 缺失均 fail-closed；允许保留 `pending/red/unknown`，不允许假绿。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | 以 smoke/test 真实输出、assertion_ref 存在性、journey/step/cell API 或 DB 查询、current SHA 绑定证据为准；拿不到即未生效。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 旧 SHA 的 CI / evaluator / judge 证据是否仍可判绿 | A. 只看 verdict 状态; B. verdict 必须与 current SHA 一致 | B. verdict 必须与 current SHA 一致 | PRD 明确要求旧 SHA 证据全部失效 | 旧证据冒充新 head，ready/merge 被误放行 |
| ⚠️ S0-S12 × 11要素是否补齐 | A. 只数 step 条数; B. 校验 step 骨干 + cell 链接 + assertion_ref | B. 校验 step 骨干 + cell 链接 + assertion_ref | 仅 step 数量不足以证明 11要素归位 | 静默缺格仍被当完成，后续恢复链失真 |
| ⚠️ 旧 Claude Code P0/P1 是否已等价回挂到同一 Journey | A. 只看 `regression-contract.yaml` 有新条目; B. 条目 + assertion_ref + 同一 journey/step 回指齐全 | B. 条目 + assertion_ref + 同一 journey/step 回指齐全 | PRD 明确禁止第二本 regression SSOT | 回归基线漂移，后续 CI 失去权威锚点 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| current main 对账发现旧 SHA 证据 | 保持 `pending/unknown`，拒绝写绿 | 是 | 重新生成基于 current SHA 的 evidence |
| S0-S12 或 11要素任一格缺失 | 保持 `red/pending`，拒绝完成 | 是 | 允许局部补齐后重跑 smoke |
| `regression-contract.yaml` 缺 P0/P1 等价条目或 `assertion_ref` 无效 | fail-closed，不允许 ready | 是 | 补回同一 Journey 锚点后重跑 |
| fresh evaluator / judge / 主理人人审任一缺失 | 拒绝进入 ready/merge | 是 | 补 fresh evidence，不复用旧 verdict |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本任务为 Brain / Harness 内部恢复，不新增对外暴露 agent 输入面

## 真实调用方请求 shape

N/A — 本 sprint 不新增设备/agent → 服务端的外部请求 shape，只修复 Brain / Harness 内部账本与验收链。

## 接缝清单

- 接缝 1：`journeys` / `journey_steps` / `journey_step_links` / `journey_features` 的真实状态必须与同一条 F1 Journey 一致。真目标验证：smoke 直接查 Brain API + DB，不允许只看文档。
- 接缝 2：`regression-contract.yaml` 的 P0/P1 基线必须能回指真实存在的测试/脚本。真目标验证：逐条解析 `assertion_ref` 并校验路径存在、可执行。
- 接缝 3：fresh evaluator / judge / 主理人人审证据必须绑定 current SHA。真目标验证：真实读取 run / PR / verdict 证据并拒绝旧 SHA。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

- `packages/brain/src/harness-line-context.js` ↔ `decisions/golden_path/journey_features`（本单改 current SHA 对账与同 Journey 事实面，测试必须真读相邻数据模型）
- `packages/brain/src/promise-map-nightly.js` ↔ `journey_steps/journey_step_links/journey_features`（本单改 S0-S12 × 11要素归位，测试必须真查账本接缝）
- `regression-contract.yaml` ↔ `tests/` / `packages/brain/scripts/smoke/`（本单改 P0/P1 等价基线，测试必须真验 assertion_ref 落点）
- `packages/brain/src/harness-relay-watchdog.js` / `packages/brain/src/harness-judge.js` ↔ `initiative_runs/dev_records`（本单改 fresh 验收链，测试必须真读 verdict 与 current SHA 绑定）

## Golden Path

[current main 对账] → [同一 F1 Journey 归位 S0-S12 × 11要素] → [旧 Claude Code P0/P1 等价基线回挂到同一 Journey 与根 regression-contract.yaml] → [fresh evaluator / judge / 主理人人审绑定 current SHA，形成新 head 验收基线]

### Step 1: 以 current main 作为唯一对账起点重建新 head
**来源**: `[FROM_PRD]` — Golden Path 第 1 步与边界情况第 1 条明确要求以 current main 为准，旧 SHA 证据全部失效。

**可观测行为**: 恢复脚本或守卫把 `origin/main` 视为唯一基线；任何旧 run / 旧 SHA 证据不会直接把 F1 判为 green/done。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh
```

**硬阈值**: `origin/main` 当前 SHA 必须被识别为唯一对账基线；旧 SHA 证据命中时返回 `pending|unknown|red`，不得返回 `green|done`。

---

### Step 2: 在同一条 F1 Journey 上补齐 S0-S12 骨干与 11要素格子
**来源**: `[FROM_PRD]` — Golden Path 第 2 步与范围限定明确要求在既有 Journey 上原位补齐，不得新建平行 Journey / 状态机 / 账本。

**可观测行为**: `bb8cc561-b3ee-4fec-b74d-2255694bd963` 仍是唯一 F1 Journey；S0-S12 全部存在，11要素格子按真实证据判 `green/pending/red/unknown`，缺口不默认绿。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh
```

**硬阈值**: 同 Journey 下 step 编号覆盖 `S0..S12`；每个要求补齐的格子都有 `cell_status` 与 `assertion_ref` 或明确 `na_reason`；不存在第二条平行 F1 Journey。

---

### Step 3: 把旧 Claude Code P0/P1 守卫逐项映射回同一 Journey 与根 regression-contract.yaml
**来源**: `[FROM_PRD]` — Golden Path 第 3 步与范围限定要求旧 P0/P1 守卫回挂同一路径与根 `regression-contract.yaml`，不得新建第二份 regression SSOT。

**可观测行为**: 根 `regression-contract.yaml` 出现 F1 Recovery 等价基线条目；每个条目能回指真实测试/脚本；Journey/Step 侧存在对应 assertion 锚点。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh
```

**硬阈值**: 所有新增 P0/P1 条目都位于根 `regression-contract.yaml`；每条 `assertion_ref` 指向真实存在文件；无第二本 regression SSOT。

---

### Step 4: 在新 head 上重建 fresh evaluator / judge / 主理人人审验收链
**来源**: `[FROM_PRD]` — Golden Path 第 4 步与 NFR 明确要求 fresh evaluator、independent judge、主理人人审绑定 current SHA，CI 只产证据。

**可观测行为**: fresh evaluator / judge / 主理人人审任一缺失时，F1 不能进入 ready/merge；三者一旦绑定 current SHA，可形成新的可继续执行 head。

**验证命令**:
```bash
bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh
```

**硬阈值**: evaluator / judge / 主理人人审证据全部带 current SHA；旧 SHA verdict 不得复用；CI 结果只能作为 evidence，不能单独放行 merge。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

git fetch origin main --quiet
CURRENT_MAIN_SHA="$(git rev-parse origin/main)"
echo "origin/main=$CURRENT_MAIN_SHA"

bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh
bash packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh
bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh
bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

node -e "const fs=require('fs');const y=fs.readFileSync('regression-contract.yaml','utf8');if(!y.includes('KERNEL-F1-RECOVERY-07272204')){process.exit(1)}"
echo 'OK: F1 recovery current-main baseline verified'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| F1 recovery 等价基线入口 | `sprints/07272204-kernel-93cf6b4b/tests/f1-recovery-contract.red.test.js` | `regression-contract 包含 F1 recovery current-main 基线条目` | 当前 `regression-contract.yaml` 尚无该条目，红测失败 |
| 单 Journey / current SHA 约束 | `sprints/07272204-kernel-93cf6b4b/tests/f1-recovery-contract.red.test.js` | `SYSTEM_MAP 记录同一 Journey 与 current SHA 验收链约束` | 当前 `SYSTEM_MAP.md` 尚未明确本次 Recovery 约束，红测失败 |
| smoke 验收链骨架 | `sprints/07272204-kernel-93cf6b4b/tests/f1-recovery-contract.red.test.js` | `F1 recovery smoke 契约脚本已登记` | 当前 4 个 smoke 脚本不存在，红测失败 |

## Notes

- current main 对账基线（抓取日期：2026-07-27）：`origin/main = 1dc9d4107cc14f9bc509c1ef285845f1dfb13838`
- 当前工作树 HEAD（抓取日期：2026-07-27）：`4c97e203d9c510a9bbc7969e66eb1725c95b5dc8`
- contract-gate: available (`packages/brain/src/lib/contract-gate.js`)
