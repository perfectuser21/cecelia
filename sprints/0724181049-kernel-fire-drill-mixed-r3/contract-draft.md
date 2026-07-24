# Sprint Contract Draft (Round 1)

**Sprint**: Kernel v1 mixed provider fire drill 终试（r3）— 新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md

**锚定父路声明**：独立小路（无父路）— PRD `journey_id: none`，本 sprint 为 kernel-v1 接力链自证的一次性 fire drill 存证，不覆盖任何已有 Golden Path。

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 唯一交付物是静态 markdown 文档（docs/fire-drills/kernel-v1-mixed-20260724-r3.md），验收全部为本地文件/git 断言，不新增、不修改任何 API 端点（Reviewer 第 6 维按规则自动满分口径处理 schema 项）。

---

## 已知约束（来自回归测试）

- （暂无已知约束 — 纯文档 sprint，不触碰 line04/video/publisher 等任何代码模块，无对应回归测试文件）
- [累积FR] （本 line 暂无历史 — PRD「累积 FR」段为空）
- context-manifest: N/A（PRD `journey_id: none`，无 line manifest 可查询）

---

## Golden Path

[Brain 派发 fire drill 任务] → [kernel-v1 接力链各角色按 mixed provider 真实运行留证] → [generator 仅新增 r3 报告文件] → [验收断言全过 + diff 范围守卫] → [human review 批准后 merge]

### Step 1: Brain 派发 harness_initiative，接力链各角色真实运行并留证
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 点（planner=claude/account1、proposer=claude/account1、reviewer=grok/grok、evaluator=grok/grok、generator=codex/team3，judge 独立运行）

**可观测行为**: 本次 run（run_id=4c7fcc5b-32ee-4a7f-9649-3b857ed30610）各角色的 provider/account 实际运行证据摘要被写入交付文件（PRD ASSUMPTION：证据由本次 run 的 attempt 日志 / Brain harness runs API 汇总，交付文件是证据落盘载体）。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r3.md"
for pair in "planner=claude/account1" "proposer=claude/account1" "reviewer=grok/grok" "evaluator=grok/grok" "generator=codex/team3" "judge="; do
  grep -qF "$pair" "$DOC" || { echo "FAIL: 缺角色证据 $pair"; exit 1; }
done
grep -qF "4c7fcc5b-32ee-4a7f-9649-3b857ed30610" "$DOC" || { echo "FAIL: 证据未锚定本次 run_id"; exit 1; }
echo OK
```

**硬阈值**: 5 组 provider/account 字面对 + judge 证据行（`judge=` 前缀，provider/account 值以实际 run 为准，PRD 未预设）各 ≥1 处；证据段含本次 run_id ≥1 处。

---

### Step 2: generator 仅新增交付文件，含全部字面标记
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 点 + 「预期受影响文件」段（唯一交付物，位置锚定 docs/fire-drills/）

**可观测行为**: 仓库出现 docs/fire-drills/kernel-v1-mixed-20260724-r3.md，字面包含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3、生产版本 1.267.67、merge commit 19887912bbb581597f12c714a9ed187f051e2850。同名文件已存在时视为重跑，以本次 r3 实际证据覆盖（PRD 边界情况）。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r3.md"
test -f "$DOC" || { echo "FAIL: 文件不存在"; exit 1; }
grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3 "$DOC" || { echo "FAIL: 缺标记"; exit 1; }
grep -qF "1.267.67" "$DOC" || { echo "FAIL: 缺生产版本"; exit 1; }
grep -qF "19887912bbb581597f12c714a9ed187f051e2850" "$DOC" || { echo "FAIL: 缺 merge commit"; exit 1; }
echo OK
```

**硬阈值**: 4 个字面标记（marker / 1.267.67 / merge commit 全 40 位 / 文件本身存在）全部命中，缺一即 FAIL。

---

### Step 3: 验收命令通过且 diff 范围不越界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 点 + 「边界情况」第 3 条（diff 仅允许 docs/fire-drills/ 下新增；触碰 packages/brain、现有合同测试、migrations、产品逻辑即 FAIL）

**可观测行为**: PRD 指定的两条验收命令（test -f + grep -q）exit 0；PR diff 相对 origin/main 只含交付文件与本 sprint harness 自身产物。

**验证命令**:
```bash
git fetch origin main --quiet
VIOL=$(git diff --name-only origin/main...HEAD | grep -vE '^(docs/fire-drills/|sprints/0724181049-kernel-fire-drill-mixed-r3/)' || true)
[ -z "$VIOL" ] || { echo "FAIL: diff 越界文件: $VIOL"; exit 1; }
echo OK
```

**硬阈值**: 允许清单外的 diff 文件数 = 0。允许清单为 `docs/fire-drills/` 与 `sprints/0724181049-kernel-fire-drill-mixed-r3/` 两个前缀——后者是 harness 接力链自身合同产物（PRD/合同/DoD/tests/task-plan 必然入分支），`[AI_ADDED]` 显式列出以免验收自吞；packages/brain/、migrations、.github/workflows/、现有测试等一律越界即 FAIL（铁律：共享 CI 基础设施默认禁区）。

---

### Step 4: human review 批准前禁止 merge
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 点（evaluator/judge PASS 后进入 authenticated human review，批准前禁止 merge，review_required=true）；机检手段为 `[AI_ADDED]`，理由：evaluator 在 merge 前时点本地执行，「origin/main 尚不含交付文件」是无需 gh 鉴权的确定性 merge 门禁探针（铁律：禁止 generator 自行 merge；PR 被 CI 兜底提前合并必须可被抓）。

**可观测行为**: evaluator/judge 运行时点，origin/main 上不存在交付文件；merge 只能发生在 authenticated human review 批准之后。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r3.md"
test -f "$DOC" || { echo "FAIL: 交付文件不存在"; exit 1; }
git fetch origin main --quiet
if git cat-file -e "origin/main:$DOC" 2>/dev/null; then
  echo "FAIL: human review 批准前文件已出现在 origin/main"; exit 1
fi
echo OK
```

**硬阈值**: evaluate 时点 `git cat-file -e origin/main:<DOC>` 必须非零（文件未上 main）。

---

### Step 5: 防伪与脱敏守卫
**来源**: `[AI_ADDED]` — 理由：①PRD 边界「禁止伪造运行证据」需要可机检 oracle——本次 run_id 唯一属于本轮，历史 r1/r2 文件不可能包含它，等价于 DB 时间窗防「历史数据冒充本轮产出」；②铁律「凭据安全/日志脱敏」——证据摘要只许写 provider/account 别名，禁止泄漏 key/token 明文。

**可观测行为**: 交付文件证据段锚定本次 run_id；全文无凭据明文特征串。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r3.md"
test -f "$DOC" || { echo "FAIL: 交付文件不存在"; exit 1; }
grep -qF "4c7fcc5b-32ee-4a7f-9649-3b857ed30610" "$DOC" || { echo "FAIL: 未锚定本次 run_id"; exit 1; }
grep -qE "(sk-ant-|xai-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{16}|OP_SERVICE_ACCOUNT_TOKEN=)" "$DOC" && { echo "FAIL: 疑似凭据明文"; exit 1; } || true
echo OK
```

**硬阈值**: run_id 命中 ≥1 处；凭据特征串命中数 = 0。

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> 模式 B final-e2e 由 evaluator 作为独立 task 执行（本合同只产出脚本）。本 sprint 验收全部为本地文件/git 断言，不依赖 Brain 端口存活。

```bash
#!/bin/bash
set -euo pipefail

DOC="docs/fire-drills/kernel-v1-mixed-20260724-r3.md"
RUN_ID="4c7fcc5b-32ee-4a7f-9649-3b857ed30610"

# 1. PRD 字面验收命令（PRD E2E 点 1-2，任务描述强制要求的两条命令原样在此）
test -f "$DOC" || { echo "FAIL: 文件不存在 $DOC"; exit 1; }
grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3 "$DOC" || { echo "FAIL: 缺标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3"; exit 1; }

# 2. 版本与 merge commit 字面存在（PRD E2E 点 3）
grep -qF "1.267.67" "$DOC" || { echo "FAIL: 缺生产版本 1.267.67"; exit 1; }
grep -qF "19887912bbb581597f12c714a9ed187f051e2850" "$DOC" || { echo "FAIL: 缺 merge commit"; exit 1; }

# 3. 六角色 provider/account 证据行（PRD E2E 点 4；judge 行 provider/account 以实际 run 为准，只锚定前缀）
for pair in "planner=claude/account1" "proposer=claude/account1" "reviewer=grok/grok" "evaluator=grok/grok" "generator=codex/team3" "judge="; do
  grep -qF "$pair" "$DOC" || { echo "FAIL: 缺角色证据 $pair"; exit 1; }
done

# 4. [AI_ADDED] 防伪锚定：证据必须含本次 run_id（历史 r1/r2 文件不可能包含，等价 DB 时间窗防历史冒充）
grep -qF "$RUN_ID" "$DOC" || { echo "FAIL: 证据未锚定本次 run_id"; exit 1; }

# 5. diff 范围守卫（PRD E2E 点 5；允许清单 = 交付文件 + 本 sprint harness 自身产物）
git fetch origin main --quiet
VIOL=$(git diff --name-only origin/main...HEAD | grep -vE '^(docs/fire-drills/|sprints/0724181049-kernel-fire-drill-mixed-r3/)' || true)
[ -z "$VIOL" ] || { echo "FAIL: diff 越界文件: $VIOL"; exit 1; }

# 6. merge 门禁（PRD E2E 点 6：authenticated human review 批准前禁止 merge）
if git cat-file -e "origin/main:$DOC" 2>/dev/null; then
  echo "FAIL: human review 批准前文件已出现在 origin/main"; exit 1
fi

# 7. [AI_ADDED] 凭据脱敏守卫（铁律：凭据安全 / 日志脱敏）
grep -qE "(sk-ant-|xai-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{16}|OP_SERVICE_ACCOUNT_TOKEN=)" "$DOC" && { echo "FAIL: 交付文档疑似含凭据明文"; exit 1; } || true

echo "✅ Golden Path 验证通过"
```

**PASS 标准**: 脚本 exit 0
**FAIL 标准**: 任一断言非零退出（含 git fetch 不可达——通道故障 = FAIL，禁止兜底放行）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 新增 docs/fire-drills/kernel-v1-mixed-20260724-r3.md 一个文件，字面含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3、版本 1.267.67、merge commit 19887912bbb…、六角色 provider/account 运行证据摘要（judge 值以实际 run 为准） |
| **NFR（做得多好）** | 性能/可靠性 | 整链 timeout_seconds=28800（task payload 显式给定）；交付物为静态 markdown，无运行时性能面 |
| **Invariant（永不违反）** | 不变量 | diff 只许 docs/fire-drills/ + 本 sprint harness 产物；禁止伪造运行证据（run_id 锚定）；human review 批准前禁止 merge；文档不含凭据明文 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效与退役 | fire drill 报告为一次性历史存证，永久存档不退役；其中的版本/commit 信息只描述 2026-07-24 时点事实，不承诺时效 |
| **死亡告警（停了谁知道）** | 停摆可见性 | N/A（静态文档无运行时）；接力链 run 失败由 Brain run failure_reason 如实记录（PRD 边界第 1 条），走 harness 既有告警面 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 验收脚本 exit 0（evaluator 机检回执）→ judge PASS → authenticated human review 批准记录 → merge 后文件在 origin/main 可查（终态回执） |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| merge 门禁是否被提前突破 | A. gh pr view 查 mergedAt/reviewDecision; B. git cat-file -e 查 origin/main 是否已含交付文件 | B | 纯 git 本地可查，无需 gh 鉴权，evaluator 环境确定可跑 | 「重跑且前轮已合并」场景会保守误 FAIL（方向安全：宁误杀不漏放）；本 r3 文件名全新，实际不触发 |
| ⚠️ 角色运行证据是否真实（非伪造/非复用历史） | A. 人工逐条核对 attempt 日志; B. 文件锚定本次 run_id 4c7fcc5b + human review 兜底 | B（机检）+ A（human review 阶段抽查） | run_id 唯一属于本轮，历史 r1/r2 文件不可能包含；等价 DB 时间窗 | 伪造证据混入永久存证，直接污染 fire drill 结论 |
| judge 角色 provider/account 写什么 | A. 合同预设固定值; B. 只锚定 `judge=` 前缀，值由实际 run 决定 | B | PRD 第 19 行只给了 5 组 pair，judge 值未预设；写死即「写死环境假设值」违反铁律 | 若 judge 证据行缺失，验收 FAIL（保守方向） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 任一角色 provider 配额/鉴权失败（如上轮 429） | run 如实记 failure_reason，终止本轮，不产出伪造证据 | 是（换账号/等窗口后重跑新 round，如 r2→r3） | 无降级——禁止 mock 顶替真实运行证据 |
| 验收脚本任一断言 FAIL | evaluator FAIL，任务不 merge | 是（generator 修复后重验） | 无降级 |
| git fetch origin 不可达 | 脚本非零退出 = FAIL | 是 | 禁止 warning 降级放行（铁律：部署链失败路径禁止 warning 降级） |
| human review 拒绝 | PR 不 merge，run 记录拒绝原因 | — | 无降级，merge 权在 human |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 交付静态文档，无对外暴露 agent、无外部用户可写入接口。

---

## 接缝清单（碰真实世界的点）

1. **mixed provider 真实运行**（claude/account1、grok/grok、codex/team3 的配额与鉴权）— 真目标验证：本次 run 各角色 attempt 真实完成 + 交付文件中 run_id 锚定的证据摘要；上轮 r2 即在此接缝真实炸掉（evaluator 429），本轮换 grok 账号。CI 绿 ≠ done，run 真跑完才算。
2. **authenticated human review 门禁** — 真目标验证：evaluate 时点 origin/main 不含交付文件（Step 4 命令）+ merge 只在 human 批准后发生。未经真验前本项状态：logic-done-pending（由 controller 在 human review 环节闭合）。

---

## 禁 mock 边清单

（本单纯文档改动——唯一交付物为 docs/ 下新增 markdown，不触碰调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A。注意：接力链本身的 provider 接缝由上方「接缝清单」+ run_id 锚定覆盖，不属于本单代码改动的 mock 边。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A — 所有断言均在真实 repo 文件与真实 git 状态上执行，无 force_*/stub/假数据。）

## 真实调用方请求 shape

N/A — Golden Path 不含「设备/agent 调服务端」链路，无新增/变更任何 HTTP 接口。

---

## 铁律逐条映射（Step 1.3 三源之一：controller/PRD 注入铁律 → INV 条目或显式 N/A）

按 PRD「Invariant 约束」段原文顺序编号 INV-1…INV-53：

| INV | 铁律摘要 | 覆盖方式 / N/A 理由 |
|-----|----------|---------------------|
| INV-1 | manual oracle 真实 exit code + 解释器确认启动 | 覆盖 — 见下方「Red 验证记录」，全部 manual 命令已真跑并记录 exit code |
| INV-2 | manual:node -e 的 ${} 须 GAN 批准前真跑 | 覆盖 — node -e 命令已真跑（Red 记录）；程序体用 includes() 无模板插值 |
| INV-3 | smoke-invariant-1784808160-58494 | N/A — smoke 占位铁律，无可执行语义 |
| INV-4 | smoke-invariant-1784806023-5054 | N/A — 同上 |
| INV-5 | 冷启动重置类测试需补非冷启动面 | N/A — 无状态重置类测试 |
| INV-6 | 周期扫描 + 付费调用须有已处理前置检查 | N/A — 无周期扫描/付费调用 |
| INV-7 | 跨模块时间常数隐含依赖须显式断言 | N/A — 无时间常数 |
| INV-8 | theater_mismatch：android 关键词触发 | 覆盖 — 合同/DoD 无 android 关键词，target_environment=local_api |
| INV-9 | target_environment 从 DB payload 读 | 覆盖 — PRD 已声明 target_environment=local_api 入 payload，本合同一致，不另从文件推断 |
| INV-10 | judge 需 .brain-result.json 顶层 exit_code+log_tail+behavior_tests[] | 覆盖（提示义务方）— Notes 提示 evaluator 按该 schema 产出；本合同 BEHAVIOR 均可独立执行产 exit code |
| INV-11 | varchar 长度须显式截断 | N/A — 无 DB 写入 |
| INV-12 | 复活死功能先查 git log -D | N/A — 全新文件，非复活 |
| INV-13 | null/false 失败契约必写 else | N/A — 无代码交付 |
| INV-14 | smoke-invariant-1784543934-2387 | N/A — smoke 占位 |
| INV-15 | journey_features updated_at 停滞兜底探测 | N/A — journey_id=none |
| INV-16 | relay 容器 Step6 后退出跳过 Step7 | N/A — controller 侧义务，非合同断言面 |
| INV-17 | host/环境白名单断言核对 headed 接管 | 覆盖 — 合同断言全为本地文件/git 断言，无 host 白名单 |
| INV-18 | headed relay payload 带 base_repo/pr_url | N/A — controller 侧义务 |
| INV-19 | 退役判断查生产库不靠记忆 | N/A — 无退役动作 |
| INV-20 | catch 吞错 job 须失败计数 | N/A — 无后台 job |
| INV-21 | 表名认领冲突先 grep 写入方 | N/A — 无 DB 表 |
| INV-22 | 新后台 job 必须声明消费方 | N/A — 无后台 job |
| INV-23 | 多设备 os_type UI 区分强制检查 | N/A — 无 UI |
| INV-24 | git_sha=unknown 判变/终验同一语义 | N/A — 无判变链路 |
| INV-25 | git 判 ref 存在须 --verify ^{commit} | 覆盖 — 合同 git 断言用 cat-file -e 定点对象检查与 diff --name-only，不用裸 rev-parse 判 ref |
| INV-26 | smoke worktree 禁触生产资源 | N/A — 无 smoke worktree 场景 |
| INV-27 | 失败路径禁止 warning 降级 | 覆盖 — 全部断言显式 exit 1；唯一 `\|\| true` 为 gate 认可的负向单语句/管道捕获形态，不吞正向失败 |
| INV-28 | 判变基准用生产实体自报 | N/A — PRD ASSUMPTION 明示版本/commit 以 task payload 为事实源，本 sprint 不核验部署 |
| INV-29 | 测试须 await fn() ≥1，读源码包 async | 覆盖 — tests/ 全部 it() 为 async + await readFile |
| INV-30 | Test Contract 固定 4 列，testFile backtick | 覆盖 — 见 Test Contract 表 |
| INV-31 | Red commit 只 add 精确路径 | 覆盖 — 本轮 git add 仅精确列出 sprint 产物 4 路径 |
| INV-32 | 回归用 source-code inspection 验接线 | N/A — 无调度接线 |
| INV-33 | 新 cron 先查 scheduler-jobs.js | N/A — 无 cron |
| INV-34 | 禁止 generator 自行 merge，merge 权归 controller | 覆盖 — BEHAVIOR-6 merge 门禁 + review_required=true |
| INV-35 | tmux 子 shell 不继承环境变量 | N/A — 无 tmux 场景 |
| INV-36 | Proposer 复用历史合同模板须核对本次真实派发历史 | 覆盖 — 本合同断言全部从本 PRD 字面推导，未复用历史 fire-drill 合同 E2E 断言 |
| INV-37 | .github/workflows 共享 CI 默认禁区 | 覆盖 — diff 允许清单不含 .github/，触碰即越界 FAIL |
| INV-38 | PR 被 CI 兜底提前合并须可抓 | 覆盖 — BEHAVIOR-6：evaluate 时点 origin/main 含交付文件即 FAIL |
| INV-39 | smoke-invariant-1783850042-79911 | N/A — smoke 占位 |
| INV-40 | brain/src PR 须带 smoke allowlist | N/A — 不触碰 packages/brain |
| INV-41 | 新 task_type 七点清单 | N/A — 无新 task_type |
| INV-42 | 服务存活判定双信号 | N/A — 无常驻服务 |
| INV-43 | 本机禁放 LaunchAgents | N/A — 无宿主服务 |
| INV-44 | 新常驻服务须进 launchd-patrol manifest | N/A — 同上 |
| INV-45 | smoke-invariant-1783693282-93097 | N/A — smoke 占位 |
| INV-46 | 单 slot 串行，并行只许跨 slot | N/A — 调度层义务，本合同单 ws1 天然串行 |
| INV-47 | 禁止写死环境假设值 | 覆盖 — judge 证据值不预设（只锚定前缀）；版本/commit 来自 task payload 事实源，非环境猜测 |
| INV-48 | 真环境验证才算 done | 覆盖 — 验收对象即真目标（真实 repo 文件 + 真实 git 状态 + run_id 锚定真实 run）；接缝清单列 provider 真运行 |
| INV-49 | 测试默认多租户 | N/A — 无租户面 |
| INV-50 | 凭据安全 | 覆盖 — BEHAVIOR-7 / E2E 第 7 步凭据明文特征串扫描，命中即 FAIL |
| INV-51 | 日志脱敏 | 覆盖 — 同上（证据摘要只许 provider/account 别名） |
| INV-52 | 端点鉴权 | N/A — 无新端点 |
| INV-53 | 租户隔离 | N/A — 无租户面 |

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fire drill r3 交付文档 | `tests/fire-drill-doc.test.ts` | 文件存在且含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R3；生产版本 1.267.67 与 merge commit；六角色 provider/account 证据行齐全；证据锚定本次 run_id | → 4 failures（文件尚不存在，readFile ENOENT） |

> BEHAVIOR-5（diff 范围守卫）、BEHAVIOR-6（merge 门禁）、BEHAVIOR-7（凭据脱敏）为 git 状态/负向扫描类断言，由 DoD manual:bash 与 E2E 脚本承载，无对应 vitest 单测（vitest 红绿只覆盖文件内容 4 项）。

---

## Red 验证记录（INV-1/INV-2：manual 命令 GAN 批准前真跑，exit code 实录）

在 worktree（交付文件尚不存在）逐条真跑 DoD manual 命令的结果——全部如预期 FAIL（真红）：

| DoD 条目 | 命令首词/解释器 | 实测 exit code | 输出摘要 |
|---|---|---|---|
| BEHAVIOR-1 | bash（test -f） | 1 | 文件不存在（静默非零） |
| BEHAVIOR-2 | node -e | 1 | ENOENT: docs/fire-drills/kernel-v1-mixed-20260724-r3.md |
| BEHAVIOR-3 | node -e | 1 | ENOENT（同上，解释器确认启动） |
| BEHAVIOR-4 | bash（test -f && grep） | 1 | 文件不存在 |
| BEHAVIOR-5 | bash（git diff 守卫，含存在性前置） | 1 | FAIL: 交付文件不存在 |
| BEHAVIOR-6 | bash（git cat-file 门禁，含存在性前置） | 1 | FAIL: 交付文件不存在 |
| BEHAVIOR-7 | bash（凭据扫描，含存在性前置） | 1 | 文件不存在（非零退出） |

---

## Notes

- contract-gate: cecelia 仓库，packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 正常生效（无跳过）。
- judgment-pending-user: 角色运行证据真实性判定（⚠️ 行）——所选 run_id 锚定 + human review 兜底方案 PrepPRD 未显式拍板，待 human review 环节确认；机检方向保守（缺锚定即 FAIL），不引入放行风险。
- INV-10 提示：evaluator 产出 .brain-result.json 时须含顶层 exit_code + log_tail + behavior_tests[]（每条含 exit_code + log_tail），本合同 7 条 BEHAVIOR 均为可独立执行命令，逐条可采集。
- 重跑语义（PRD 边界第 2 条）：同名文件已存在时以本次 r3 证据覆盖；run_id 锚定保证覆盖后内容仍归属本轮。
