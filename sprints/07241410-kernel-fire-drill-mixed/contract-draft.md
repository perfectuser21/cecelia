# Sprint Contract Draft (Round 1)

- **Sprint**: [FIRE DRILL 2026-07-24] Kernel v1 mixed provider 上岗考试
- **run_id**: b932ad01-5e1b-4d11-ae7d-ab9c179d2700 / task 617f2dad
- **journey_type**: autonomous
- **target_environment**: local_api（验收全部为仓库本地 test -f / grep / node / git diff，与 PRD target_environment_reason 一致）

**锚定父路声明**: 独立小路（无父路）— PRD journey_id: none、step_id: none。

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。唯一交付物为 docs 文档，验收是本地文件断言；api_registry / db_registry / test_registry 已按 Step 1.1 读取（api_registry 11.9KB 非空），无字段命名需要推导，无禁用字段清单。

## 已知约束（来自回归测试）

- `tests/regression/relay-50170af2/*.test.js` → PR #4226 kernel v1 回归契约（deadline 三道 fence、failure_class 五类路由矩阵、MAX_HOPS=4096 宽兜底、kernel-v1 deadline_at=8h、no-progress/persistent-blocked 接线等）。**本 sprint 对这些文件零改动**，它们是越界检查（GP Step 3）的保护对象。
- [累积FR] （本 line 暂无历史 — PRD 累积 FR 段为空）
- context-manifest: unavailable（journey_id=none，无 line 端点可查）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 新增 `docs/fire-drills/kernel-v1-mixed-20260724.md`，含三个字面量（`KERNEL_V1_MIXED_FIRE_DRILL_PASS` / `1.267.65` / `4ff4112ae55bbab9467dcecff6be0ba222a67cd8`）+ 六角色（planner/proposer/reviewer/generator/evaluator/judge）provider/account 运行证据段；任务规定的两条最低验收命令必过 |
| **NFR（做得多好）** | 性能/可靠性 | 单阶段执行超时 1800s（payload.timeout_seconds）；文档为静态 markdown，无运行态性能面 |
| **Invariant（永不违反）** | 不变量 | packages/brain、migrations、.github/workflows、现有测试零改动；文档不得含明文凭据/PII；human review 通过前禁止 merge（review_required=true） |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效与退役 | 演练文档为一次性 fire drill 存档，永久留档不退役；后续 fire drill 覆盖新版本时另建新日期文件，不改本文件 |
| **死亡告警（停了谁知道）** | 告警手段 | N/A — 静态文档无运行态；交付把关一次性由本 sprint E2E + human review 完成 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | PR 进入 authenticated human review 状态 = 交付回执（PRD GP 第 4 步）；merge 后在 main 上两条最低验收命令可复跑通过 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 各角色 provider/account 运行证据是否真实（非编造全绿） | A. 结构机检（六段齐全 + provider/account/evidence 行 + role_assignments 五条对照字面）+ authenticated human review 人工核真; B. evaluator 逐角色比对 Brain run 日志 API | A | PRD 边界情况允许"不可用→如实记录失败/替补"，硬断言 provider 字面会误杀合法替补场景；且任务已强制 review_required=true，人工核真是任务自带的最后闸门 | 编造证据混过机检（human review 可拦截；内部演练存档，不面客、不丢数据） |
| 越界改动判定基线 | A. 三点 diff origin/main...HEAD; B. 工作区 diff | A | 三点 diff 只看分支引入的改动，工作区 diff 会把未提交噪音误判为越界 | 误放行越界改动（另有 reviewer/human review 双保险） |

无 ⚠️ 级判定点（无静默丢数据/面客/不可逆动作），无 judgment-pending-user 项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| E2E 任一断言失败（缺字面量/缺角色段/越界） | evaluator FAIL，打回 generator | 是（断言为纯读操作，重跑无副作用） | 无降级，不允许部分放行 |
| git diff origin/main...HEAD 不可达 | check-scope.cjs 显式 FAIL（exit 1），禁止跳过越界检查 | 是 | 无降级（[禁降级] 铁律） |
| 某角色 provider/account 实际不可用 | 文档如实记录失败/替补（PRD 边界情况），结构机检仍必须过 | — | 不允许编造"全绿" |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent/接口，交付物为仓库内静态文档。

---

## Golden Path

[Brain 派发 fire drill 任务] → [接力链六角色依次执行留证] → [generator 新增演练文档] → [验收命令通过 + authenticated human review]

> 流程性步骤说明：PRD GP 第 1、2 步（Brain 派发 trigger_source=manual_fire_drill、接力链 planner→proposer→独立 reviewer→generator→独立 evaluator→independent judge 不得跳过、human review 前禁止 merge）由 Harness run 本身与 review_required=true 机制承载（[禁自merge] 铁律：merge 权在 controller，generator 只推 branch）。合同断言聚焦 generator 交付物的可机检部分（PRD GP 第 3、4 步），角色链真实运行的证据以文档证据段 + human review 核真（判定点登记表第 2 行）。

### Step 1: 演练文档存在且三字面量齐全
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 3 条与「E2E 验收」期望点 1-3（两条最低验收命令为任务字面规定）

**可观测行为**: 仓库根目录下 `docs/fire-drills/kernel-v1-mixed-20260724.md` 存在，内容含 `KERNEL_V1_MIXED_FIRE_DRILL_PASS`、`1.267.65`、`4ff4112ae55bbab9467dcecff6be0ba222a67cd8` 三个字面量

**验证命令**:
```bash
test -f docs/fire-drills/kernel-v1-mixed-20260724.md
grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS docs/fire-drills/kernel-v1-mixed-20260724.md
grep -q '1\.267\.65' docs/fire-drills/kernel-v1-mixed-20260724.md
grep -q '4ff4112ae55bbab9467dcecff6be0ba222a67cd8' docs/fire-drills/kernel-v1-mixed-20260724.md
```

**硬阈值**: 四条命令全部 exit 0；缺任一字面量 = FAIL（PRD 边界情况第 3 条）

---

### Step 2: 六角色证据段结构齐全 + role_assignments 对照
**来源**: `[FROM_PRD]` — PRD GP 第 1 条（role_assignments 五项分配）与第 3 条（每角色一段：角色名、provider、account、实际执行动作/产物指针）；段格式 `## role: <name>` + `- provider:`/`- account:`/`- evidence:` 行为 `[AI_ADDED]`，理由：把"每角色一段"翻译成机器可检的固定结构，防止证据段有名无实

**可观测行为**: 文档含 6 个 `## role: <name>` 段（planner/proposer/reviewer/generator/evaluator/judge），每段含 `- provider: `、`- account: `、`- evidence: ` 三行；文档另含 5 条计划分配对照字面（`planner=claude/account1`、`proposer=claude/account1`、`reviewer=grok/grok`、`generator=codex/team3`、`evaluator=claude/account2`）。角色实际不可用时 evidence 行如实记录失败/替补（PRD 边界情况第 1 条），对照字面记录的是"计划分配"，恒为真

**验证命令**:
```bash
node sprints/07241410-kernel-fire-drill-mixed/tests/check-roles.cjs
# 期望：stdout OK，exit 0
```

**硬阈值**: exit 0 且 stdout 为 OK；缺任一角色段/任一字段行/任一对照字面 = FAIL

---

### Step 3: 越界零改动（范围限定守卫）
**来源**: `[FROM_PRD]` — PRD「范围限定」（仅新增一个文件；packages/brain、现有合同测试、migrations、共享 CI 工作流不在范围内）与「E2E 验收」期望点 5

**可观测行为**: 三点 diff（origin/main...HEAD）中：新增 `docs/fire-drills/kernel-v1-mixed-20260724.md`（状态 A）；packages/brain/、migrations/、.github/workflows/ 零触碰；无任何现有测试文件被修改/删除（含 tests/regression/relay-50170af2/ kernel 回归契约）

**验证命令**:
```bash
node sprints/07241410-kernel-fire-drill-mixed/tests/check-scope.cjs
# 期望：stdout OK，exit 0；git diff 不可达时显式 FAIL 不跳过
```

**硬阈值**: exit 0；出现禁区路径或现有测试被改 = FAIL

---

### Step 4: oracle 敏感性与无凭据自证
**来源**: `[AI_ADDED]` — 理由：①防 oracle 假绿——用"去掉标记后 grep 必不中"的负向自证，证明标记断言真在检内容而非恒真；②[secrets]/[PII] 铁律——证据摘要涉及 provider/account，必须机检无明文凭据模式混入

**可观测行为**: 从文档剔除 `KERNEL_V1_MIXED_FIRE_DRILL_PASS` 行后的副本上，标记 grep 必不中；原文档不含常见凭据模式（sk-*/ghp_*/xoxb-/AKIA*/PRIVATE KEY）

**验证命令**:
```bash
TMP=$(mktemp); grep -v KERNEL_V1_MIXED_FIRE_DRILL_PASS docs/fire-drills/kernel-v1-mixed-20260724.md > "$TMP"
if grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS "$TMP"; then echo "FAIL: oracle 不敏感"; exit 1; fi
if grep -qE '(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xoxb-|AKIA[0-9A-Z]{16}|-----BEGIN[ A-Z]*PRIVATE KEY)' docs/fire-drills/kernel-v1-mixed-20260724.md; then echo "FAIL: 疑似明文凭据"; exit 1; fi
```

**硬阈值**: 两个负向检查均不命中（exit 0）；命中任一 = FAIL

---

## 真实调用方请求 shape

N/A — 本 sprint 无"设备/agent 调服务端"链路，无第三方 API 调用（规则 A/B 不适用）。角色 provider/account 的实际运行发生在 Harness 接力链层，不是本合同交付物的调用路径。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A — DoD 与测试中无 force_*/stub/假数据。）
补充说明：六角色"实际运行"本身不可由 evaluator 在 E2E 内重放，其真实性判定方式见判定点登记表第 2 行（结构机检 + authenticated human review 人工核真；PRD ASSUMPTION 已认可以本次 run 各阶段产物/日志摘要为口径）。

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A — 不触及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径；packages/brain 为禁改区。）

## 接缝清单（接缝断言 vs 逻辑断言）

- 本合同全部断言为**逻辑断言**（仓库本地文件内容 / 三点 diff 检查，环境无关，CI 绿 = 真 done），无 logic-done-pending 项。
- 唯一碰真实世界的点：各角色 provider/account 是否真在混合分配上跑过 → 由文档证据段（含产物指针）+ authenticated human review 在真目标（本次 run 的实际产物）上核真，属任务自带流程闸门，不产生额外接缝断言。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DOC="docs/fire-drills/kernel-v1-mixed-20260724.md"

# 1. 任务规定最低验收命令（字面要求，一字不改）
test -f "$DOC" || { echo "FAIL: 文件不存在 $DOC"; exit 1; }
grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS "$DOC" || { echo "FAIL: 缺标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS"; exit 1; }

# 2. 生产版本与 merge commit 字面
grep -q '1\.267\.65' "$DOC" || { echo "FAIL: 缺版本 1.267.65"; exit 1; }
grep -q '4ff4112ae55bbab9467dcecff6be0ba222a67cd8' "$DOC" || { echo "FAIL: 缺 merge commit 字面"; exit 1; }

# 3. 六角色证据段结构 + role_assignments 对照字面
node sprints/07241410-kernel-fire-drill-mixed/tests/check-roles.cjs || { echo "FAIL: 角色证据段检查未过"; exit 1; }

# 4. 越界检查（仅新增 docs/fire-drills/ 一个文件；packages/brain、migrations、CI workflows、现有测试零改动）
git fetch origin main --quiet 2>/dev/null || true
node sprints/07241410-kernel-fire-drill-mixed/tests/check-scope.cjs || { echo "FAIL: 越界检查未过"; exit 1; }

# 5. oracle 敏感性自证（负向：剔除标记后 grep 必不中，防恒真假绿）
TMP=$(mktemp)
grep -v KERNEL_V1_MIXED_FIRE_DRILL_PASS "$DOC" > "$TMP"
if grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS "$TMP"; then echo "FAIL: oracle 不敏感"; exit 1; fi

# 6. 无明文凭据（secrets/PII 铁律）
if grep -qE '(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xoxb-|AKIA[0-9A-Z]{16}|-----BEGIN[ A-Z]*PRIVATE KEY)' "$DOC"; then
  echo "FAIL: 演练文档疑似含明文凭据"; exit 1
fi

echo "✅ Golden Path 验证通过"
```

**PASS 标准**: 脚本 exit 0
**FAIL 标准**: 任一断言非 0 exit（含 git diff 基线不可达）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `sprints/07241410-kernel-fire-drill-mixed/tests/fire-drill-doc.test.ts` | 含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS、含版本 1.267.65 与 merge commit 4ff4112ae 字面、六角色证据段齐全、不含明文凭据模式 | → 4 failures（ENOENT，交付物未创建） |

---

## notes

- contract-gate: present（packages/brain/src/lib/contract-gate.js 存在，cecelia repo，代码层 gate 生效）
- **oracle 留证（[oracle留证]/[模板真跑] 铁律，2026-07-24 真跑记录）**：解释器确认启动（node v20.20.2 / GNU bash 5.2.15）。红路径（交付物不存在时）：B1 exit=1、B2 exit=2、B3 exit=1（FAIL: 文件不存在）、B4 exit=1（FAIL: diff 中未新增交付物）、B5 exit=2、B6 exit=1 — 六条全红，无假绿。绿路径校验：用临时样例文档（含全部合同要素）真跑 B1/B2/B3/B5/B6 全部 exit=0 stdout OK，随后样例已删除（B4 绿路径需交付物入 commit diff，由 generator 阶段自然验证）。
- vitest Red 证据：`npx vitest run sprints/07241410-kernel-fire-drill-mixed/tests/` → Tests 4 failed (4)，全部 ENOENT（交付物未创建），见 /tmp/sprint-red.log
- [禁抄先例] 已履行：本合同全部断言从本 PRD「E2E 验收」期望点与任务描述字面派生，未复用历史合同 E2E 模板
- 角色链流程约束（接力链不得跳过、human review 前禁 merge）由 Brain run 与 review_required=true 承载，generator 侧对应铁律 [禁自merge]
