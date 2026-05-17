# engine-ship SKILL.md v16.1.0 设计文档

日期：2026-04-27
分支：cp-0427172630-engine-ship-skill-v16.1.0

## 背景

CLAUDE.md §8 要求 PR 合并后必须回写 Brain task status=completed。
engine-ship SKILL.md v16.0.0 的 §2 仅 fire-learnings-event，未自动调用 callback-brain-task.sh，
导致每次 /dev 结束后需人工或间接触发回写，违反"零人为交互点"原则。

## 改动范围

1. `packages/engine/skills/engine-ship/SKILL.md`：版本 16.0.0 → 16.1.0，§2 新增 callback-brain-task.sh 调用步骤
2. Engine 版本 bump：18.15.0 → 18.16.0（5 个文件）
3. `packages/engine/feature-registry.yml`：新增 changelog 条目
4. 运行 generate-path-views.sh 更新路径视图

## 测试策略

本次改动为 Config 类（SKILL.md 文本 + 版本号）：
- Trivial wrapper：文件内容检查（node -e readFileSync）
- 无运行时行为变更，无需 E2E / smoke

## DoD

- [x] [ARTIFACT] packages/engine/skills/engine-ship/SKILL.md 版本为 16.1.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/engine-ship/SKILL.md','utf8');if(!c.includes('version: 16.1.0'))process.exit(1)"
- [x] [BEHAVIOR] engine-ship SKILL.md 包含 callback-brain-task.sh 调用步骤
  Test: manual:bash -c "grep -q 'callback-brain-task' packages/engine/skills/engine-ship/SKILL.md"
- [x] [ARTIFACT] Engine 版本已 bump 到 18.16.0（package.json/VERSION/.hook-core-version/regression-contract.yaml）
  Test: manual:node -e "const v=require('./packages/engine/package.json').version;if(v!=='18.16.0')process.exit(1)"
