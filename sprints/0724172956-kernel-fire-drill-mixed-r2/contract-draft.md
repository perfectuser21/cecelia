# Sprint Contract Draft (Round 1)

**Sprint**: [FIRE DRILL 0724172956] Kernel v1 mixed provider 上岗复试
**journey_type**: autonomous
**target_environment**: local_api

覆盖父路声明：独立小路（无父路）——本 sprint 为一次性 fire drill 证据落档，PRD `journey_id: none`，无已有 Golden Path 父路。

notes:
- contract-gate: cecelia repo，代码层 Contract Gate 正常适用（packages/brain/src/lib/contract-gate.js 存在）。
- context-manifest: N/A（PRD journey_id=none，无累积 FR 端点可查）。
- merge 权归 controller：human review（authenticated）通过前禁止 merge，generator 只推 branch（对应铁律「禁止 generator 自行 merge PR」）。

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应。本 sprint 唯一交付物是仓库文档文件 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md`，无新增/修改任何 API 端点（api_registry 已查，仅用于确认无需对齐端点命名）。

## 已知约束（来自回归测试）

（暂无已知约束）— 本 sprint 关键词（fire drill / docs 文档落档）不命中 line04/video/publisher 任何测试目录；`docs/fire-drills/` 目录当前不存在，无历史测试。

来源补充：
- [累积FR] （本 line 暂无历史 — PRD 累积 FR 段为空）
- context-manifest: N/A（journey_id=none）

## Golden Path

[fire drill 链路各角色真跑] → [generator 汇总证据写入文档] → [文档存在且全部标记可机检] → [停在 human review 门前，不 merge]

### Step 1: fire drill 链路各角色以 mixed provider 配置真跑
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 条「Harness 链路以 mixed provider 配置跑完本 fire drill 各角色」

**可观测行为**: planner/proposer/reviewer/generator/evaluator/judge 六个角色各自留下 provider/account 实际运行证据（角色运行本身即本次 harness 链路的事实，不 mock、不由脚本伪造）。

**验证命令**: 本步骤的可机检投影在 Step 2 的文档内容断言（六角色证据行齐全）；链路真跑与否由 Brain harness 任务记录背书，不在合同内重复造 oracle。

**硬阈值**: 六角色缺一不可（见 Step 2 验证命令的 for 循环断言）。

---

### Step 2: generator 新增证据文档，含全部字面标记
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 条（文件路径、PASS 标记、版本、merge commit、六角色证据摘要均为 PRD 字面要求）

**可观测行为**: 仓库新增 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md`，内容包含：
- 字面标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2`
- 生产版本字面值 `1.267.67`
- merge commit 字面值 `19887912bbb581597f12c714a9ed187f051e2850`
- 六角色（planner/proposer/reviewer/generator/evaluator/judge）每角色至少一行 provider/account 证据摘要

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r2.md"
test -f "$DOC" || { echo "FAIL: 文件不存在"; exit 1; }
grep -q 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2' "$DOC" || { echo "FAIL: 缺 PASS 标记"; exit 1; }
grep -q '1\.267\.67' "$DOC" || { echo "FAIL: 缺生产版本字面值"; exit 1; }
grep -q '19887912bbb581597f12c714a9ed187f051e2850' "$DOC" || { echo "FAIL: 缺 merge commit 字面值"; exit 1; }
for ROLE in planner proposer reviewer generator evaluator judge; do
  grep -Ei "${ROLE}[^\n]*(provider|account)|(provider|account)[^\n]*${ROLE}" "$DOC" | grep -q . || { echo "FAIL: 角色 ${ROLE} 缺 provider/account 证据行"; exit 1; }
done
echo OK
```

**硬阈值**: 4 个字面 grep 全命中 + 6 个角色循环断言全过，任一缺失 exit 1。

---

### Step 3: merge commit 真实性核验
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止 generator 把 commit hash 当普通字符串抄错/编造——hash 必须能在本仓库解析为真实 commit 对象（同时落实铁律「git rev-parse 判 ref 存在必须带 --verify ^{commit}」）。

**可观测行为**: 文档里写的 merge commit 在仓库中真实存在。

**验证命令**:
```bash
git rev-parse --verify '19887912bbb581597f12c714a9ed187f051e2850^{commit}' >/dev/null || { echo "FAIL: merge commit 在仓库不可解析"; exit 1; }
echo OK
```

**硬阈值**: rev-parse --verify exit 0。

---

### Step 4: 范围守卫 + 停在 human review 门前
**来源**: `[FROM_PRD]` — PRD「范围限定」（不得修改 packages/brain、现有合同测试、migrations、产品逻辑、CI 配置）与「可观测结果」（human review 通过前保持不 merge）

**可观测行为**: 交付分支相对 origin/main 的 diff 不触碰禁区路径；PR 保持 open 状态直至 authenticated human review。

**验证命令**:
```bash
CHANGED=$(git diff --name-only origin/main...HEAD -- 'packages/brain' 'migrations' '.github/workflows' | head -20)
[ -z "$CHANGED" ] || { echo "FAIL: 越界改动: $CHANGED"; exit 1; }
echo OK
```

**硬阈值**: 禁区路径 diff 为空。「不 merge」由 controller/branch protection 执行（合同 notes 已声明 merge 权归 controller），evaluator 不代为 merge。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路，交付物为静态文档，无任何调用方。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 全部断言直接作用于真实仓库文件与真实 git 对象，无 force_*/stub/假数据。

说明一处边界：Golden Path Step 1「六角色真跑」的运行事实由 Brain harness 链路本身产生（本 fire drill 的目的就是链路真跑），合同 oracle 验证其**证据投影**（文档内六角色证据行）；合同不伪造也不 mock 任何角色运行。

## 禁 mock 边清单

（本单纯文档新增改动，无调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A）

## 接缝清单

接缝清单：空 — 本 sprint 交付静态文档，不碰真机/生产 env/真实调用方；全部断言为环境无关的逻辑断言（文件内容 + 本仓库 git 对象），CI/本地验绿即真 done，无 logic-done-pending 项。六角色「真跑」的运行事实由本次 harness fire drill 链路自身产生（这正是 drill 的目的），合同 oracle 机检其证据投影。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 新增 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md`，含 PASS 标记、版本 1.267.67、merge commit、六角色 provider/account 证据摘要 |
| **NFR（做得多好）** | 性能/可靠性 | 验收命令必须机检可跑（test -f + grep，本地秒级）；版本字面值 1.267.67 必须逐字出现 |
| **Invariant（永不违反）** | 不变量 | 不触碰 packages/brain、migrations、现有合同测试、CI 配置；human review 前禁止 merge；见 contract-dod.md「Invariant 覆盖（铁律映射）」 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 文档为一次性 fire drill 证据存档，永久留档不退役；标记 R2 与日期已内嵌文件名，不会与后续 drill 冲突 |
| **死亡告警（停了谁知道）** | 停了谁知道 | N/A — 静态文档无运行时；若文件被误删，CI 无守护（可接受：历史证据文档不是运行依赖） |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 文档进 PR → CI 绿 → authenticated human review 通过 → controller merge；merge 后 `git show origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r2.md` 可查即最终回执 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 六角色证据行是否齐全 | A. grep 角色名出现即算; B. grep 角色名与 provider/account 关键词同行才算 | B. 同行才算 | 角色名单独出现（如目录/标题）不构成证据；证据摘要行必然同时含角色与 provider/account 字样 | fire drill 缺角色证据仍假绿标 done，复试证据不完整 |
| merge commit 是否真实 | A. 文档字面 grep 即算; B. grep + git rev-parse --verify ^{commit} 双验 | B. 双验 | hash 可被抄错/编造，仓库对象解析是唯一真值源 | 证据文档记录了不存在的 commit，档案失信 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 任一 grep/test 断言失败 | evaluator FAIL，任务不标 done，PR 不 merge | 是（断言只读，可任意重跑） | 无降级——修文档内容后重跑，禁止放宽断言 |
| 同名文件意外已存在（PRD 边界情况） | generator 以本次证据覆盖写入，覆盖后仍须全部断言通过 | 是（写入幂等：整文件覆盖） | 无 |
| human review 未完成 | 链路停在 review 门前，禁止 merge | N/A | 无——不存在绕过路径 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 交付静态文档，非对外暴露 agent，无外部不可信输入。

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DOC="docs/fire-drills/kernel-v1-mixed-20260724-r2.md"

# 1. 文件存在（PRD 验收命令字面要求）
test -f "$DOC" || { echo "FAIL: 文件不存在 $DOC"; exit 1; }

# 2. PASS 标记（PRD 验收命令字面要求）
grep -q 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2' "$DOC" || { echo "FAIL: 缺 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 标记"; exit 1; }

# 3. 生产版本与 merge commit 字面值（PRD E2E 期望验收点 3）
grep -q '1\.267\.67' "$DOC" || { echo "FAIL: 缺生产版本 1.267.67"; exit 1; }
grep -q '19887912bbb581597f12c714a9ed187f051e2850' "$DOC" || { echo "FAIL: 缺 merge commit 字面值"; exit 1; }

# 4. merge commit 真实性（AI_ADDED 防编造：仓库必须能解析该 commit 对象）
git rev-parse --verify '19887912bbb581597f12c714a9ed187f051e2850^{commit}' >/dev/null || { echo "FAIL: merge commit 在仓库不可解析"; exit 1; }

# 5. 六角色 provider/account 证据行齐全（PRD 边界情况：缺任一角色不算完成）
for ROLE in planner proposer reviewer generator evaluator judge; do
  grep -Ei "${ROLE}.*(provider|account)|(provider|account).*${ROLE}" "$DOC" | grep -q . || { echo "FAIL: 角色 ${ROLE} 缺 provider/account 证据行"; exit 1; }
done

# 6. 范围守卫（PRD E2E 期望验收点 5：diff 不触碰禁区）
CHANGED=$(git diff --name-only origin/main...HEAD -- 'packages/brain' 'migrations' '.github/workflows' | head -20)
[ -z "$CHANGED" ] || { echo "FAIL: 越界改动: $CHANGED"; exit 1; }

echo "✅ Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 证据文档存在与 PASS 标记 | `tests/fire-drill-doc.test.ts` | 含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 标记 | → 1 failure（文件不存在） |
| 版本与 merge commit 字面值 | `tests/fire-drill-doc.test.ts` | 含生产版本 1.267.67 与 merge commit 字面值 | → 1 failure（文件不存在） |
| 六角色证据行 | `tests/fire-drill-doc.test.ts` | 六角色每个都有 provider/account 证据行 | → 1 failure（文件不存在） |
