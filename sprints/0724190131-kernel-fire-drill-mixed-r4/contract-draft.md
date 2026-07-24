# Sprint Contract Draft (Round 1)

> Sprint: [FIRE DRILL 0724190131] Kernel v1 mixed provider 主链验收（r4）
> task_id: 91db186d-e6ba-4099-bcf1-0e1c4ec0625c ｜ journey_type: autonomous ｜ target_environment: local_api

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 是 docs-only 文档新增（docs/fire-drills/kernel-v1-mixed-20260724-r4.md），不新增/修改任何端点、DB schema 或产品逻辑。

## 已知约束（来自回归测试）

- [回归测试]（暂无已知约束）— repo 内无 fire-drill 域相关测试文件（仅 packages/engine/tests/scripts/fire-learnings-cursor.test.ts，属 engine learnings 域，与本 sprint 无关）
- [累积FR] PRD 明示「本 line 暂无历史」
- context-manifest: N/A（PRD journey_id: none，无可查询 line）
- [禁抄模板] 已核对：repo 中不存在 docs/fire-drills/ 目录与任何历史 fire-drill 合同/E2E 断言可复用；本合同全部断言从本次 task description + PRD 逐条推导

## 铁律映射（Step 1.3 — PRD Invariant 清单逐条对账）

适用（进 DoD/E2E 硬条款）：
- [oracle留痕] → INV-1：本合同全部 manual:bash 命令已在 GAN 批准前真跑并留痕真实 exit code（见文末 notes「oracle 留痕表」，红阶段全部非 0 = 真红）
- [ref校验] → INV-2：E2E 与 B5 判 origin/main 存在均用 `git rev-parse --verify "origin/main^{commit}"`
- [精确add] → INV-3：generator Red commit 只允许 `git add docs/fire-drills/kernel-v1-mixed-20260724-r4.md` 精确路径（写入 task-plan scope）；proposer 本轮同样只 add 合同四产物精确路径
- [禁自merge] / [提前合并] / [自报对账] → INV-4：merge 权归 controller + authenticated human review；DoD B6 在 evaluate 时用 origin/main 实际状态对账（origin/main 不得已含目标文档）
- [禁抄模板] → INV-5：见上「已知约束」核对记录
- [禁写死] → INV-6：合同断言值（1.267.67 / 19887912bbb…）均为 task description 显式 ground truth（PRD ASSUMPTION 拍板），非环境假设值；已在本 repo `git rev-parse --verify` 确认该 commit 真实存在
- [真环境] → INV-7：E2E 在真实 git 工作区对真实 origin/main 对账；接缝项（human review 顺序、角色真实运行）列入接缝清单真目标验证
- [lint要求] → INV-8：tests/ 内 it() 全部 async + await（await readFile ≥1/条）
- [合同表格] → INV-9：Test Contract 固定 4 列，testFile 用 backtick 包裹
- [theater检查] → INV-10：本合同/DoD 全文不含该铁律所指的移动端系统关键词（避免误触 theater_mismatch，此处刻意不写出该词本身）
- [环境读DB] → INV-11：target_environment=local_api 以 DB tasks.payload 注入为准（本合同不从文件另行推断）

N/A（一条一行，理由显式）：
- [真跑验证 manual:node] → N/A：本合同无 manual:node -e 断言（全部 manual:bash，且已按 INV-1 真跑）
- [smoke占位 1784808160-58494] → N/A：演练占位铁律，无实义断言
- [smoke占位 1784806023-5054] → N/A：演练占位铁律
- [smoke占位 1784543934-2387] → N/A：演练占位铁律
- [smoke占位 1783850042-79911] → N/A：演练占位铁律
- [smoke占位 1783693282-93097] → N/A：演练占位铁律
- [热态用例] → N/A：docs-only，无状态重置/冷启动类测试面
- [防重复扣费] → N/A：无外部付费调用
- [时间常数] → N/A：无跨模块时间常数
- [judge结果] → N/A：judge 侧输出协议，由 judge skill 履约，非本合同断言面
- [字段截断] → N/A：无 DB 写入
- [复活先考古] → N/A：无复活旧功能
- [else必写] → N/A：docs-only，无契约函数调用代码
- [report兜底] / [report必跑] → N/A：controller report 阶段职责，非合同断言面
- [headed核对] / [headed点火] → N/A：非 headed 场景（orchestrator=skill-relay 无头）
- [退役实锤] → N/A：无退役判断
- [吞错计数] → N/A：无后台 job
- [表认领] / [消费方] → N/A：无新表/后台落库 job
- [多设备UI] → N/A：无 UI
- [语义一致] → N/A：无 git_sha=unknown 类双端判定语义
- [worktree隔离] → N/A：无 smoke 部署根切换
- [禁降级] → N/A：非部署链；且本合同 E2E 所有失败路径均显式 exit 1，无 warning 降级
- [源码检验] → N/A：无调度接线改动
- [cron接线] → N/A：无 cron 功能
- [tmux环境] → N/A：非 headed relay
- [CI禁区] → N/A：本 sprint 不触碰 .github/workflows/**（PR diff 恰一行文档，由 B5 机械保证）
- [smoke登记] → N/A：非 feat+brain/src PR
- [七点清单] → N/A：无新 task_type
- [双信号] / [禁LaunchAgents] / [巡逻登记] → N/A：无常驻宿主服务
- [串行slot] → N/A：controller 调度侧职责
- [多租户] → N/A：docs-only 无租户数据面
- [凭据安全] / [日志脱敏] / [端点鉴权] / [租户隔离] → N/A：无凭据/日志/端点/租户数据；文档内容为运行证据摘要，不含任何凭据（human review 出口兜底核对）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r4.md，含 ①标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4 ②生产版本 1.267.67 ③merge commit 19887912bbb581597f12c714a9ed187f051e2850 ④六角色 provider/account 实际运行证据摘要；全链 planner→proposer→reviewer→generator→evaluator→judge→human review 走通 |
| **NFR（做得多好）** | 非功能需求 | 整链 timeout 28800s（payload.timeout_seconds）；频控待定（PrepPRD 未指定） |
| **Invariant（永不违反）** | 不变量 | PR diff 相对 origin/main 恰一行目标文档；human review 前禁止 merge；角色失败如实上报、禁换号伪装；不改 packages/brain/合同测试/迁移/产品逻辑；其余见「铁律映射」 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效与退役 | 文档为一次性 fire drill 审计证据，长期静态保留，无退役动作（N/A） |
| **死亡告警（停了谁知道）** | 告警手段 | N/A（静态文档无运行态）；主链运行失败由既有 Brain runs 历史 + watchdog_overdue 机制上报 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 真实生效回执 = authenticated human review 批准后 merge，origin/main 含目标文档；controller report 阶段回写任务状态。evaluate 阶段前置代理 = B6（origin/main 尚未含文档 + 本分支已含） |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 角色 provider/account 证据摘要是否真实反映实际运行 | A. 合同层机械 grep 角色×provider 关键词同现; B. judge 对账 Brain DB attempts/运行日志 | A（evaluator 机检）+ B（independent judge 复核，PRD 步骤 5 显式要求） | evaluator 在 local_api 只能机检文档内容；证据来源已由 PRD ASSUMPTION 拍板 = payload.role_assignments + 实际运行日志 | 文档写入未经核实的证据；由 judge 复核 + human review 出口双层兜底拦截 |
| merge 是否发生在 authenticated human review 批准之后 | A. evaluate 时断言 origin/main 尚未含目标文档（前置代理）; B. merge 后核对 PR timeline（approve 时刻早于 merge 时刻） | A+B 双层（A=DoD B6 机检；B=controller/judge 在 merge 后核对） | 「顺序」只有 PR timeline 能真验，evaluate 阶段只能验前置状态 | fire drill 流程证据失效（merge 早于 review），本次演练目标作废 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 任一角色 provider/account 不可用（如 quota 429） | 该角色失败如实上报进文档/run 记录，任务按失败处理 | 是（r4 重跑覆盖旧内容，文档写入幂等） | 禁止换号伪装或跳过角色（PRD 边界情况显式禁令），无降级 |
| PR diff 出现第二个文件 | 分支纪律硬失败，generator 从 origin/main 重建分支 | 是（重建分支重新产出） | 禁止追加 commit 掩盖（PRD 边界情况显式禁令） |
| 目标文档已存在（r4 重跑残留） | 以本次 run 实际证据整体覆盖，不留旧轮次残渣（B4 反向断言把关） | 是 | 无 |
| evaluate 时 origin/main 已含目标文档 | B6 FAIL，判提前合并违规，上报 controller | — | 禁止当 PASS 兜过 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 非对外暴露 agent，无外部不可信输入面（全部输入来自 Brain payload 与 repo 内部状态）。

## 真实调用方请求 shape

N/A — 无设备/agent 调服务端链路（docs-only，无任何 HTTP 调用方）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— DoD 全部断言直接跑在真实 git 工作区与真实文档上，无 force_*/stub/假数据。
注：接缝类两项（human review→merge 顺序、角色真实运行证据）不属 mock 豁免，属「evaluate 阶段只能验前置代理、真目标验证在 merge 后/judge 侧完成」，已列入下方接缝清单并标 logic-done-pending。

## 禁 mock 边清单

（本单纯文档改动，无调度/状态机/跨模块传递/生命周期钩子/DB 写路径改动，无接缝边，N/A）
tests/ 内亦无任何 vi.mock/stub——断言对象是真实文件系统上的目标文档与真实 git 仓库状态。

## Golden Path

独立小路（无父路）— PRD journey_id: none，本 sprint 为一次性 fire drill 验收路径。

[Brain 派发 harness_initiative 91db186d] → [六角色接力 + 分支纪律机械确认] → [仅含一个 fire-drill 文档的 PR 经 authenticated human review 后 merge]

### Step 1: generator 产出目标文档（四要素齐全）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 3 条 + 「范围限定」段

**可观测行为**: 合规分支上出现 docs/fire-drills/kernel-v1-mixed-20260724-r4.md，含 PASS_R4 标记、生产版本 1.267.67、merge commit 19887912bbb581597f12c714a9ed187f051e2850、六角色 provider/account 实际运行证据摘要（planner/proposer=claude·account1，reviewer/evaluator=grok·grok，generator=codex·team3）。

**验证命令**:
```bash
test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md && grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4 docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1
grep -q '1\.267\.67' docs/fire-drills/kernel-v1-mixed-20260724-r4.md && grep -q 19887912bbb581597f12c714a9ed187f051e2850 docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1
for kw in planner proposer reviewer generator evaluator judge claude account1 grok codex team3; do grep -qi "$kw" docs/fire-drills/kernel-v1-mixed-20260724-r4.md || { echo "FAIL: 缺 $kw"; exit 1; }; done
```

**硬阈值**: 全部 grep exit 0；11 个角色/provider/account 关键词逐个命中（对应 DoD B1/B2/B3）

---

### Step 2: 旧轮次残渣清零（r4 重跑覆盖）
**来源**: `[FROM_PRD]` — PRD「边界情况」第 1 条「不留旧轮次残渣」

**可观测行为**: 文档只含 R4 标记，不含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R1/R2/R3 任何旧标记。

**验证命令**:
```bash
if grep -Eq 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R[123]([^0-9]|$)' docs/fire-drills/kernel-v1-mixed-20260724-r4.md; then echo "FAIL: 旧轮次残渣"; exit 1; fi
test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1
```

**硬阈值**: 旧标记命中数 = 0，且文件必须存在（防「文件不存在也算无残渣」假绿）（对应 DoD B4）

---

### Step 3: 分支纪律机械确认（PR diff 恰一行）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 4 条（git diff --name-only origin/main...HEAD 恰好一行）

**可观测行为**: generator 分支相对 origin/main 的 diff 文件列表恰好一行，且为目标文档；sprints/**、.harness/**、合同产物均不在 PR 内。

**验证命令**:
```bash
git fetch origin main --quiet
git rev-parse --verify 'origin/main^{commit}' >/dev/null || exit 1
D=$(git diff --name-only origin/main...HEAD)
[ "$D" = "docs/fire-drills/kernel-v1-mixed-20260724-r4.md" ] || { echo "FAIL: diff 非恰一行目标文档"; printf '%s\n' "$D"; exit 1; }
```

**硬阈值**: diff 文件列表字符串整体等于目标路径（隐含行数 = 1）（对应 DoD B5）

---

### Step 4: evaluator 验收全 PASS
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 5 条

**可观测行为**: 独立 evaluator（grok/grok）跑 DoD B1–B6 + 下方 E2E 脚本，整体 exit 0；independent judge 独立复核 PASS。

**验证命令**: 即本合同 `## E2E 验收` 脚本整体（exit 0 = PASS）

**硬阈值**: E2E 脚本 exit code = 0，无任何 SKIP/WARN 降级路径

---

### Step 5: human review 前禁止 merge（出口守卫）
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 6 条；其中「用 origin/main 实际状态对账」的机械代理写法为 `[AI_ADDED]`，理由：evaluate 阶段无法直接验证「顺序」，用 origin/main 尚未含文档作前置代理，同时防提前合并/历史冒充（[提前合并]/[自报对账] 铁律）

**可观测行为**: evaluate 时刻 origin/main 尚不包含目标文档（即 merge 未发生），而 generator 分支已包含；最终 merge 仅发生在 authenticated human review 批准之后。

**验证命令**:
```bash
test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md || exit 1
if git cat-file -e origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r4.md 2>/dev/null; then echo "FAIL: origin/main 已含目标文档，疑似 human review 前已 merge"; exit 1; fi
```

**硬阈值**: origin/main 中目标文档不存在（cat-file -e 非 0）；顺序真验（approve 时刻早于 merge 时刻）在 merge 后由 controller/judge 按 PR timeline 核对（见接缝清单）（对应 DoD B6）

---

## 接缝清单（接缝断言 — 真目标验证方式）

1. **authenticated human review → merge 顺序**：碰真实世界点 = GitHub PR 流程。真目标验证 = merge 后核对 PR timeline（approve 时刻早于 merge 时刻），由 controller/judge 执行；evaluate 阶段仅有前置代理 B6。状态：`logic-done-pending`（human review 完成前不得标 done）。
2. **各角色 provider/account 实际运行**：碰真实世界点 = 各 provider 真实执行历史。真目标验证 = independent judge 对账 Brain DB attempts/运行日志与文档证据摘要一致（PRD 步骤 5）。evaluator 机检层 = B3 关键词同现。状态：`logic-done-pending`（judge 复核前不得标 done）。

逻辑断言（环境无关，CI/机检绿即 done）：B1/B2/B4/B5 —— 文档内容与 git diff 均为本地确定性检查。

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

# final-e2e — local_api：本地机械检查，evaluator 在 generator 分支工作区（repo 根目录）执行
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r4.md"

# Step 1a: 任务字面验收命令（task description 硬要求）
test -f "$DOC" || { echo "FAIL: 目标文档不存在"; exit 1; }
grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4 "$DOC" || { echo "FAIL: 缺 PASS_R4 标记"; exit 1; }

# Step 1b: 四要素内容完整性
grep -q '1\.267\.67' "$DOC" || { echo "FAIL: 缺生产版本 1.267.67"; exit 1; }
grep -q '19887912bbb581597f12c714a9ed187f051e2850' "$DOC" || { echo "FAIL: 缺 merge commit"; exit 1; }
for kw in planner proposer reviewer generator evaluator judge claude account1 grok codex team3; do
  grep -qi "$kw" "$DOC" || { echo "FAIL: 角色证据摘要缺关键词 $kw"; exit 1; }
done

# Step 2: 旧轮次残渣反向检查
if grep -Eq 'KERNEL_V1_MIXED_FIRE_DRILL_PASS_R[123]([^0-9]|$)' "$DOC"; then
  echo "FAIL: 检出旧轮次标记残渣"
  exit 1
fi

# Step 3: 分支纪律 — PR diff 恰一行目标文档（ref 存在性按 [ref校验] 铁律带 --verify）
git fetch origin main --quiet
git rev-parse --verify 'origin/main^{commit}' >/dev/null || { echo "FAIL: origin/main ref 不可用"; exit 1; }
DIFF_FILES=$(git diff --name-only origin/main...HEAD)
if [ "$DIFF_FILES" != "$DOC" ]; then
  echo "FAIL: PR diff 不是恰一行目标文档，实际为:"
  printf '%s\n' "$DIFF_FILES"
  exit 1
fi

# Step 4: merge 前置守卫 — human review 前 origin/main 不得已含文档
if git cat-file -e "origin/main:$DOC" 2>/dev/null; then
  echo "FAIL: origin/main 已包含目标文档，疑似 human review 前已 merge"
  exit 1
fi

echo "OK: fire drill r4 文档四要素 + 无旧轮次残渣 + 分支纪律恰一行 + merge 前置守卫全部 PASS"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fire drill r4 证据文档 | `sprints/0724190131-kernel-fire-drill-mixed-r4/tests/fire-drill-doc.test.ts` | 含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4；生产版本 1.267.67；provider/account 证据摘要；不含旧轮次标记 | → 4 failures（目标文档尚不存在，readFile ENOENT） |

## notes

- contract-gate: packages/brain/src/lib/contract-gate.js 存在（cecelia repo），走正常代码层 gate，无跳过。
- judgment-pending-user: 无（判定点登记表无 ⚠️ 级未拍板项；两项判定的兜底方式均为 PRD 显式拍板的 judge 复核 + human review 出口）。
- oracle 留痕表（[oracle留痕] 铁律，GAN 批准前真跑，红阶段预期全非 0）：见下表，由 proposer 在 Round 1 于 propose 分支工作区真实执行并记录：

| 命令 | 真实 exit code（红阶段） | 解释器确认 |
|---|---|---|
| DoD B1 manual:bash | 1 | bash 启动，test -f 失败（文档未创建，真红） |
| DoD B2 manual:bash | 1 | bash 启动，grep 无文件（真红） |
| DoD B3 manual:bash | 1 | bash 启动，首个关键词即 FAIL（真红） |
| DoD B4 manual:bash | 1 | bash 启动，test -f 失败（真红，防「无文件=无残渣」假绿） |
| DoD B5 manual:bash | 1 | bash 启动，propose 分支 diff 含 sprints/**（真红；generator 合规分支上应转绿） |
| DoD B6 manual:bash | 1 | bash 启动，test -f 失败（真红） |
| E2E 脚本整体 | 1 | bash -n 语法通过后真跑，Step 1a 即 FAIL（真红） |
