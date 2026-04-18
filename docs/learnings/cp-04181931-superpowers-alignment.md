# Learning: Engine ↔ Superpowers 对齐契约 + DevGate 防退化固化

**Branch**: cp-0418193131-superpowers-alignment
**Date**: 2026-04-18
**Task ID**: 4042c0b5-095c-48cc-8eea-923a9e3e6f52

## 做了什么

一次性把 Engine 与 Superpowers 5.0.7 的对齐状态从"文档引用"升级为"CI 强制验证"：

1. **契约**：`packages/engine/contracts/superpowers-alignment.yaml` 登记 14 个 Superpowers skill（10 full / 1 partial / 1 rejected / 2 not_applicable），每个 full/partial skill 含 anchor_file + required_keywords + local_prompt.sha256。
2. **本地化**：8 个 skill 的 18 个核心 prompt（2866 行）复制到 `packages/engine/skills/dev/prompts/`，含 subagent-driven-development 三角色 prompt、TDD、verification、systematic-debugging 全套 Root-Cause Tracing、receiving/requesting-code-review。
3. **DevGate**：3 个脚本（check-superpowers-alignment / check-engine-hygiene / bump-version），CI 每次 PR 强制跑。
4. **清理 31 条违规**：4 处 manual:TODO 占位符、4 处 superpowers:xxx/yyy.md 外部悬空引用、2 处硬编码 `~/.claude-account3/` 绝对路径、SKILL.md frontmatter 版本 7.2.0 → 14.17.5。
5. **CI 集成**：`.github/workflows/ci.yml` engine-tests job 新增 2 步 DevGate gate。

## 根本原因

**为什么需要做这件事**：

Engine 之前声称"吸收 Superpowers 92%"，但怀疑性审计揭示真相：
- 92% 是"skill 名字被引用了"，不是 92% 的方法论被吸收
- 实际"有代码且设计对齐"的吸收度只有 64%
- 4 个 skill 文档提名但无实装（finishing-a-development-branch、executing-plans、systematic-debugging 被架空、receiving-code-review 浅尝）
- `02-code.md` 里 4 处 `superpowers:xxx/yyy.md` 外部悬空引用（本地没有副本）
- 2 处硬编码 `~/.claude-account3/` 绝对路径（换账号或 CI 上必挂）
- `fetch-task-prd.sh` 生成的 DoD 模板含 `manual:TODO`，会被自己的 devgate-fake-test-detection 拒绝（讽刺漏洞）
- SKILL.md frontmatter 版本停在 7.2.0，Engine 已经 14.17.4

**越改越乱的结构性原因**：没有"契约"锁定状态。每次提名一个新 skill、改一处引用、bump 一次版本，都要靠人记。时间久了必然漂移。

## 下次预防

- [ ] **任何新引入 Superpowers skill**：必须同步更新 `packages/engine/contracts/superpowers-alignment.yaml`，含 sha256
- [ ] **任何 02-code.md / 01-spec.md / 04-ship.md 引用 superpowers: prompt**：必须指向 `packages/engine/skills/dev/prompts/`，禁用 `superpowers:xxx/yyy.md` 或外部绝对路径
- [ ] **任何 DoD 模板生成**：用 `manual:bash -c "echo REPLACE-WITH-REAL-TEST; exit 1"` 这样明确失败的占位符，禁 `manual:TODO`
- [ ] **Engine 版本 bump**：走 `bash packages/engine/scripts/bump-version.sh <new-version>`，自动同步 5 处（VERSION / package.json / .hook-core-version / SKILL.md frontmatter / regression-contract.yaml）+ package-lock
- [ ] **Superpowers 升级审视**：每季度 1 次，跑 `node packages/engine/scripts/devgate/check-superpowers-alignment.cjs --verbose`，若 upstream hash 变化（manifest 里的 source sha256）则主动复审本地副本

## 涉及的文件

新增：
- `packages/engine/contracts/superpowers-alignment.yaml`（391 行）
- `packages/engine/contracts/prompt-localization-manifest.yaml`（263 行）
- `packages/engine/skills/dev/prompts/`（8 skill / 18 文件 / 2866 行）
- `packages/engine/scripts/devgate/check-superpowers-alignment.cjs`（373 行）
- `packages/engine/scripts/devgate/check-engine-hygiene.cjs`（361 行）
- `packages/engine/scripts/devgate/README.md`（239 行）
- `packages/engine/scripts/bump-version.sh`（294 行）

修改：
- `packages/engine/skills/dev/steps/02-code.md`（4 处 superpowers 引用 + 2 处硬编码路径）
- `packages/engine/skills/dev/scripts/fetch-task-prd.sh`（4 处 manual:TODO 占位符）
- `packages/engine/skills/dev/SKILL.md`（frontmatter version 7.2.0 → 14.17.5）
- `packages/engine/VERSION` / `package.json` / `.hook-core-version` / `regression-contract.yaml`（bump 到 14.17.5）
- `packages/engine/feature-registry.yml`（新增 14.17.5 changelog 条目）
- `.github/workflows/ci.yml`（engine-tests job 新增 2 步 DevGate gate）

## 6 个并行 Agent Team 产出（预制件方式）

本 PR 走了非常规流程：先派 6 个并行 Explore/general-purpose agent 产出所有"预制件"到 `~/claude-output/engine-alignment-initiative/`（不碰 repo），再用 /dev harness + autonomous 模式一次性应用到 worktree。

- T1 Superpowers prompt 本地化：找源 + 复制 18 文件 + 计算 sha256
- T2 违规清单审计：精确定位 31 条违规
- T3 契约 yaml 起草：14 skill 登记
- T4 DevGate 脚本起草：3 个脚本 + README
- T5 CI + Hook patch：修正了 3 个假设错误（没有独立 engine-ci.yml；.hook-core-version 已对齐；check-version-sync 已覆盖 6 处）
- T6 PRD + DoD + Sprint Contract：23 条主 DoD + 30 条 WS 细化 DoD

好处：并行备料缩短实际 /dev 时间，且预制件独立可审。
