# Learning: L2 动态契约 — Evidence System + TDD Artifact 强制（opt-in 首轮）

**Branch**: cp-0418201225-l2-dynamic-contract
**Date**: 2026-04-18
**Task ID**: d3f225a9-b7a3-4c16-9836-0c05e94bab9b
**Depends on**: PR #2406 (L1 static contract)

## 做了什么

接 PR #2406 把对齐状态从"静态结构层"升级到"运行时行为层"。L1 保证文件存在 + 引用正确 + 副本 sha256 一致，L2 保证 `/dev` 运行时**真的按 Superpowers 方法论在跑**。

1. **Evidence JSONL Schema**（9 种 event closed set）
   - 运行时：`$WORKTREE/.pipeline-evidence.<branch>.jsonl`（不进 git）
   - Integrate 前：`mv` 到 `sprints/<sprint>/pipeline-evidence.jsonl`（进 git → CI 可读）
   - 事件：subagent_dispatched / tdd_red / tdd_green / pre_completion_verification / critical_gap_abort / blocked_escalation / dispatching_parallel_agents / architect_reviewer_dispatched / finishing_discard_confirm

2. **recorder**：`packages/engine/scripts/record-evidence.sh`（383 行）
   - **防伪造**：sha256 / exit_code / ts 全部由脚本自算，拒绝用户传入
   - 字段校验：UUID task_id、event 闭集、必填字段、类型断言
   - 冒烟测试 10 条样例全 pass

3. **CI gate**：`packages/engine/scripts/devgate/check-pipeline-evidence.cjs`（484 行）
   - 读 JSONL + alignment.yaml.runtime_evidence，验证 required_events 覆盖
   - **opt-in 模式**：缺证据 warn exit 0（第一轮全标 opt-in）
   - **enforced 模式**：缺证据 fail exit 1（未来逐个 skill 切换）
   - Correlation 验证（如 tdd_green.test_file 必须匹配 tdd_red.test_file）
   - 209 行单元测试 7 case 全绿

4. **契约扩展**：`superpowers-alignment.yaml` 为 10 full + 1 partial skill 加 `runtime_evidence` 字段，全部 `mode: opt-in`

5. **Prompt 改动**：
   - `implementer-prompt.md` +57 行 TDD Deliverables Contract（Red/Green/Refactor 三阶段 + anti-backfill 硬规则 + DONE 报告新增 TDD_TEST_FILE/TDD_RED_LOG/TDD_GREEN_LOG 三字段）
   - `spec-reviewer-prompt.md` +42 行 Core Check #6 TDD Artifact Authenticity（6 步验证：文件存在 → red 合理 → green 合理 → 测试名一致 → anti-backfill mtime/git → exemption 判官）

6. **02-code.md 插桩**：3 个 P0 点
   - §2.2 Implementer 派发前
   - §2.3 Spec Reviewer 派发前
   - §2.6 Pre-Completion Verification 完成时

7. **CI 集成**：`.github/workflows/ci.yml` engine-tests job 新增 Pipeline Evidence Gate

## 根本原因

**用户观察（原话）**："我的 CI 是个静态的，好像也没有真正的保护东西来"。

L1 只能保证"文件结构合规"：
- ✅ alignment.yaml 登记的 14 skill 全都有 anchor/keywords/sha256
- ✅ 本地 prompt 副本和 Superpowers 官方 hash 一致
- ✅ 版本 6 处同步
- ❌ **但无法保证 `/dev` 跑起来真的派了 Implementer / 真的做了 TDD / 真的做了 Reviewer 独立审查**

L1 是"皮"（字节层静态）。L2 是"骨"（行为层动态）。

防伪造设计是关键：如果 evidence 可以轻易伪造（比如让用户自己传 sha256），则整个动态契约形同虚设。因此：
- sha256 永远由 recorder 脚本对实际文件计算
- exit_code 由 recorder 自己执行命令获得（或从指定 log 解析）
- ts 用服务器时钟
- task_id 校验 UUID 格式

## 下次预防

- [ ] **任何新的 /dev 关键点**：评估是否要插 record-evidence 调用。新事件类型要先扩 Evidence closed set 再插桩
- [ ] **enforced 切换**：某个 skill 的 runtime_evidence 切 enforced 前，必须在 opt-in 下跑满 **14 天零假阳性**（每个 PR 都有该证据）
- [ ] **第一个推荐切 enforced 的**：test-driven-development（tdd_red + tdd_green 最机械）
- [ ] **最后切 enforced 的**：finishing-a-development-branch（稀有事件）
- [ ] **修改 Superpowers prompt 时**：确认 alignment.yaml 的 local_prompt.sha256 也更新（bump-version.sh 不管这个，手动或加脚本）
- [ ] **record-evidence.sh 扩容新 event**：必须同步更新 (1) schema 文档、(2) 契约 `runtime_evidence.required_events` 选项、(3) recorder `ALLOWED_EVENTS`、(4) gate 脚本

## 涉及的文件

新增：
- `packages/engine/scripts/record-evidence.sh`（383 行）
- `packages/engine/scripts/record-evidence.README.md`
- `packages/engine/scripts/devgate/check-pipeline-evidence.cjs`（484 行）
- `packages/engine/tests/devgate/check-pipeline-evidence.test.cjs`（209 行，7 test cases）
- `sprints/l2-dynamic-contract/`（PRD / sprint-contract / evidence-schema / migration-notes / instrumentation-spec / prompt-changes / tdd-artifact-example）
- `docs/learnings/cp-04182012-l2-dynamic-contract.md`（本文件）

修改：
- `packages/engine/contracts/superpowers-alignment.yaml`（加 runtime_evidence 字段）
- `packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md`（+57 行）
- `packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md`（+42 行）
- `packages/engine/skills/dev/steps/02-code.md`（3 个插桩点）
- `packages/engine/feature-registry.yml`（新增 14.17.6 条目）
- `packages/engine/VERSION` / `package.json` / `package-lock.json` / `.hook-core-version` / `hooks/VERSION` / `skills/dev/SKILL.md` / `regression-contract.yaml`（bump 14.17.5 → 14.17.6）
- `.github/workflows/ci.yml`（engine-tests job 新增 Pipeline Evidence Gate）

## 执行方式

延续 PR #2406 的"6 并行 agent team 备料 + /dev harness 落地"模式：
- T1 Evidence Schema + 契约扩展
- T2 recorder 脚本
- T3 CI gate + 单元测试
- T4 02-code.md 插桩点
- T5 Implementer TDD + Spec Reviewer 第 6 项
- T6 PRD + DoD + Sprint Contract

## 局限性（opt-in 首轮）

本 PR 合并后：
- CI 会跑 check-pipeline-evidence 但**不阻塞合并**（所有 skill mode: opt-in）
- 旧 PR（包括本 PR）没有 evidence 文件 → gate 打印 "skipping"
- 下次真正跑 /dev autonomous 时才会产生第一个 pipeline-evidence.jsonl

迁移路径：
1. 合并本 PR（L2 基础设施）
2. 观察 2-3 周真实 /dev 的 evidence 覆盖率
3. 从覆盖率 100% 的 skill 开始切 enforced（预计 tdd_red/tdd_green 先转）
4. 逐步把所有 full skill 转 enforced
