# Sprint PRD — [FIRE DRILL 072501] Kernel v1 mixed provider 收敛续跑 R9

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 / KR5（Engine CI 可信赖 — CI绿灯率≥95%）
- **当前进度**：50%
- **本次推进预期**：验证 harness 全链路（planner→proposer→独立 reviewer→generator→独立 evaluator→judge→人工审查）在合同失效续跑场景下不产生假绿/伪造证据，直接支撑 CI 可信赖度提升

## 背景

R7 已批准合同失效（见历史 run b21467a0 曾出现 `approved_but_contract_artifacts_missing` 故障类），本任务是同一 mixed-provider fire drill 的 R9 收敛续跑。历史 run 记录显示本 initiative（2255a63a）当前处于 planning 阶段，且同一 line 上此前存在 `892405df` initiative（journey_type=autonomous，已 done，产出远端分支 `cp-07250025-892405df` 与 OPEN PR #4317）。本次续跑必须复用该已有 PR/分支/delivery 文件，只修正过期占位与 R9 事实证据，不得另开交付面。

## Golden Path（核心场景）

系统从"合同失效"到"R9 收敛通过"的端到端演练：

1. **入口**：Controller 在 sprint_dir（`sprints/07250100-kernel-2255a63a/`）内按 Planner→Proposer→独立 Grok Reviewer 顺序生成/提交（可推送）sprint PRD 与合同产物到各自 branch；这些控制面产物允许存在，但不进入 delivery PR。
2. **Generator 执行**：Codex generator 复用现有 OPEN PR #4317（远端分支 `cp-07250025-892405df`），在独立 delivery worktree fetch/checkout 该分支；保留已有 Red SHA `50291fbba314a3fd736249b4cb2014277dccff41` 与 Green SHA `d6fce4971c40b67c2fb793290949fc1b2a664ae7`；只修正 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 中的 pr-state 占位与 R9 task/run/角色事实证据，推新 SHA。`origin/main...HEAD` diff 必须且只能包含该目标文档。
3. **独立 Claude Evaluator 核验**：
   - pr-state：真实执行 `gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup`，记录 command/exit_code=0/真实 log_tail；断言 state=OPEN、mergedAt=null、headRefName 匹配 `cp-07250025-892405df`、所有 checks 完成（`status=COMPLETED` 且 conclusion ∈ {SUCCESS, SKIPPED, NEUTRAL}）。
   - CI 结构化判据：`status≠COMPLETED` 或 conclusion 为空 = pending；conclusion ∈ {FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STALE, STARTUP_FAILURE} = 失败；docs-only 变更的 SKIPPED 不得判失败。
   - 生产 health：只记录同一次响应内的实际 `version`/`git_sha`；稳定判据是两个历史 merge SHA（`19887912bbb581597f12c714a9ed187f051e2850`、`2a96f975ecf1ce1ddfb818030f7642a08e2860b8`）都是该实际 git_sha 的祖先，不得硬编码"当前应为某版本号"。
   - 若合同 self-check 自身 oracle 与以上规则冲突，evaluator 必须标记 `failure_class=contract_invalid`，不得派 generator 修改不可变合同。
4. **Independent Judge**：在 evaluator PASS 后介入；judge PASS 之前不得存在人工批准，且 PR 不得 merge。
5. **认证人工审查（authenticated human review）**：仅在 judge PASS 之后创建 `merge_gate` review；只有认证 approve 之后才能 merge/report。
6. **批准物化**：approve 远端 contract SHA 的动作必须真实产生合同产物，不得复现历史故障 `approved_but_contract_artifacts_missing`。
7. **出口**：`docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 在 PR #4317 上更新完成、评估证据链（gh 输出 + 生产 health 响应 + judge/human 审批记录）齐备且可追溯。

## 边界情况

- 若 `gh pr view` 返回非预期字段（如 headRefOid 与既有 Green SHA 不一致）→ 视为证据不匹配，evaluator 判失败，不得静默放行。
- 若生产 health 端点不可达或响应缺 `git_sha` → 无法核验祖先关系，evaluator 判 pending/contract_invalid，不得假设祖先关系成立。
- 若 delivery PR diff 中出现 `packages/brain/`、`sprints/**`、`.harness/**`、合同产物、合同测试、迁移或产品逻辑文件 → 直接判违规，不得因"顺手改了"而放行。
- 若 judge 尚未 PASS 但已存在人工 approve 记录 → 视为流程违规（人工审查必须晚于 judge PASS）。

## 范围限定

**在范围内**：
- Planner/Proposer/独立 Reviewer 在 controller worktree sprint_dir 内的 PRD/合同产物生成与提交
- Generator 对现有 PR #4317 / 分支 `cp-07250025-892405df` / 文件 `docs/fire-drills/kernel-v1-mixed-20260724-r7.md` 的最小修正（占位替换 + R9 证据 + 新 SHA）
- Evaluator 对 pr-state / CI 结论集合 / 生产 health 祖先关系 / 合同自检冲突四类判据的真实核验
- Judge → 认证人工审查 → merge/report 的顺序闸门

**不在范围内**：
- 另开新 PR 或新增 delivery 文件
- 任何对 `packages/brain`、迁移、产品逻辑的改动作为本 delivery 的一部分
- 伪造/推断未实际执行的 gh 命令输出或生产 health 响应

## 假设

- [ASSUMPTION: "认证人工审查"的认证方式沿用现有 harness merge_gate review 机制，本 PRD 不重新定义认证协议]
- [ASSUMPTION: PR #4317 与分支 `cp-07250025-892405df` 在续跑开始时仍处于 OPEN 且未 merge 状态；若已变化由 evaluator 在核验时如实上报，而非由本 PRD 预设]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r7.md`：delivery PR #4317 上唯一允许修改的目标文档（占位替换 + R9 事实证据 + 新 SHA）
- `sprints/07250100-kernel-2255a63a/`：本 sprint 的控制面产物（PRD/合同草稿），不进入 delivery PR

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl + gh + psql）
# 期望验收点（自然语言）：
# 1. gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup 真实执行，exit_code=0，
#    断言 state=OPEN / mergedAt=null / headRefName=cp-07250025-892405df / 所有 checks COMPLETED 且 conclusion 属成功集合
# 2. 生产 health 响应的 git_sha 以 19887912bbb581597f12c714a9ed187f051e2850 与
#    2a96f975ecf1ce1ddfb818030f7642a08e2860b8 为祖先（git merge-base --is-ancestor 验证）
# 3. origin/main...HEAD（PR #4317）diff 只含 docs/fire-drills/kernel-v1-mixed-20260724-r7.md 一个文件
# 4. Red 50291fbba314a3fd736249b4cb2014277dccff41 / Green d6fce4971c40b67c2fb793290949fc1b2a664ae7 两个历史 SHA 在提交历史中保留可查
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本 task/ability golden-path-decisions 查询结果为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定，本任务 timeout_seconds=28800 由 harness 层控制）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 空
- 可观测: gh 命令与生产 health 响应必须记录真实 command/exit_code/log_tail，禁止伪造或省略证据（PrepPRD 显式要求）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [异常恢复路径] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id 为空（非路径 C 点火锚定），此段按 initiative 历史 run 降级填充 -->
- （本 line 暂无 journey_id 锚定的累积 FR 数据；参考同 initiative 历史 run `892405df`：已产出 OPEN PR #4317 + 分支 cp-07250025-892405df + delivery 文件 docs/fire-drills/kernel-v1-mixed-20260724-r7.md，Red/Green SHA 已固化，本 sprint 须在此基础上续跑而非重新生成）

## journey_type: autonomous
## journey_type_reason: 无 apps/dashboard、无远端 agent 协议改动、无 packages/engine 改动，纯 packages/brain harness 内部流程验证，落入默认 autonomous
## target_environment: local_api
## target_environment_reason: 核验动作为本地 gh CLI 调用 + Brain API（localhost:5221）+ 生产 health 端点直接 curl 比对，无浏览器/Windows/微信 RPA 介入，符合"纯 API/后台任务"local_api 定义
## journey_id: none
## step_id: none（PrepPRD 未锚定）
