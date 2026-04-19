# Learning: Phase 1 Round 2 — 真正删除 /dev Standard 模式代码

**Branch**: cp-0419091427-phase1-round2
**Date**: 2026-04-19
**Task ID**: 18526648-ec62-43ab-993f-f166cbe04a14
**Depends on**: PR #2406 (L1), #2408 (L2), #2410 (Round 1)

## 做了什么

Round 1（PR #2410）只加了 SKILL.md 弃用通告 + Brain orphan-pr-worker 兜底，Standard 代码保留。Round 2 执行实际代码删除：

**文件级删除（大块）**：
- `01-spec.md §1.1-1.3` — Standard 主 agent 直写 Task Card 整块（95 行）
- `02-code.md §3` — standard mode 分支（~50 行 探索 / 写代码 / DoD 验证 / 标记完成）
- `SKILL.md ## 流程（标准模式）` — 整个章节（含 Round 1 加的弃用警示）

**模式判断简化（三选一 → 二选一）**：
- `01-spec.md §0` — harness / autonomous / 默认 → harness / 主路径
- `02-code.md §0` — 同上
- 所有 `§0.2 autonomous_mode = true 时` 标题 → `§0.2 主路径`

**门禁代码清理**：
- `00.5-enrich.md:15-21` — 删 `AUTONOMOUS_MODE` 读取 + `exit 0`（Enrich 默认激活，由 enrich-decide 决定是否派 Subagent）
- `00.7-decision-query.md:22-27` — 删 AUTONOMOUS_MODE 门禁（Decision Query 默认激活）
- `04-ship.md discard 路径` — 删 `if AUTO==true else 人工模式 typed-confirm`，只保留 autonomous 行为（abort + 创建 Brain task）

**CLI flag 兼容降级**：
- `parse-dev-args.sh` — 固定 `AUTONOMOUS_MODE=true` + 删 Brain payload 兜底查询 + `--autonomous` 打 warn 保留别名

**frontmatter + autonomous-research-proxy**：
- `SKILL.md` description 强调 Round 2 删完，trigger 去 `--autonomous`，新增 14.17.8 changelog
- `autonomous-research-proxy.md` 触发条件从 `autonomous_mode=true 时必须加载` 改为 `/dev 默认必须加载`

**版本**：14.17.7 → 14.17.8（6 处同步）

## 根本原因

Phase 1 Round 1 (PR #2410) 留了"弃用通告但代码未删"的过渡状态，风险：
- 新 PR 理论上仍可写 `autonomous_mode: false` 走 Standard 分支（虽然 orphan-pr-worker 会兜底）
- 双分支存在让 /dev 的流程文档比实际复杂 20-40%
- 未来维护成本持续增加

Round 2 收割掉这笔技术债：**真·一种 /dev 模式**，不再区分 autonomous/standard。

## 下次预防

- [ ] **任何 /dev 相关修改**：只考虑 harness vs 主路径两种分支，不再加第三种
- [ ] **不要再加 `autonomous_mode` 字段**到任何新代码或配置 schema
- [ ] **`--autonomous` CLI flag 可在 v15.0.0（下个主版本）彻底移除**（当前保留 warn 别名供老脚本过渡）
- [ ] **Phase 2（未来）**：Harness Evaluator 降级为 PR required check，消除 Stop Hook 条件 0.5 harness shortcut，届时 `harness_mode` 也能从 .dev-mode schema 去掉

## 涉及的文件

修改（8 个）：
- `packages/engine/skills/dev/SKILL.md`（流程章节删除 + description + changelog + 模式说明改写）
- `packages/engine/skills/dev/steps/01-spec.md`（-95 行 + 模式判断简化）
- `packages/engine/skills/dev/steps/02-code.md`（-50 行 + 模式判断简化）
- `packages/engine/skills/dev/steps/00.5-enrich.md`（门禁清理）
- `packages/engine/skills/dev/steps/00.7-decision-query.md`（门禁清理）
- `packages/engine/skills/dev/steps/04-ship.md`（discard 分支简化）
- `packages/engine/skills/dev/steps/autonomous-research-proxy.md`（触发条件改默认加载）
- `packages/engine/skills/dev/scripts/parse-dev-args.sh`（AUTONOMOUS_MODE=true 固定 + flag 降级 warn）

新增（1 个）：
- `docs/learnings/cp-04190914-phase1-round2.md`（本文件）

版本同步（6 处）：
- `packages/engine/VERSION` / `package.json` / `package-lock.json` / `.hook-core-version` / `hooks/VERSION` / `regression-contract.yaml`（bump 14.17.7 → 14.17.8）

feature-registry：
- `packages/engine/feature-registry.yml` 新增 14.17.8 条目

## 向后兼容 + 3 DevGate

- L1 alignment gate（检 Superpowers 契约）：pass
- L1 hygiene gate（检 TODO / 外部引用 / 版本同步）：pass
- L2 evidence gate（检 pipeline-evidence.jsonl）：skip（无 evidence 文件，opt-in）
- Brain 派 `harness_mode: true` 的任务仍正常走 shortcut
- Brain 派的 `autonomous_mode: true` 字段**被忽略**（parse-dev-args.sh 固定 true，dev-mode schema 不再读），行为不变
- 老脚本用 `/dev --autonomous` 仍可调（打 warn）

## 执行方式

延续 PR #2406/#2408/#2410 的"6 并行 agent team 备料 + /dev harness 落地"模式。本 Round 2 预制件在昨天（2026-04-18）Phase 1 T1-T6 产出（`~/claude-output/engine-phase1-unification/`），今天直接按 T1 diff-inventory 的 11 个 A 类 + 9 个 C 类 + 1 个 D 类 删除点应用 Edit，无需再派新 agent team。
