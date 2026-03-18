# Learning: 新建 packages/engine/skills/cto-review/SKILL.md

**Branch**: cp-03182035-engine-cto-review-skill
**Date**: 2026-03-18
**PR**: #1087

## 背景

cto-review 是完成开发任务三个核心组件之一（dev + intent-expand + cto-review），三者均属于 Engine，不属于 workflows。SKILL.md 本体一直缺失，需要在正确位置 `packages/engine/skills/cto-review/SKILL.md` 创建。

### 根本原因

PR #1084 在 packages/workflows/skills/ 下集成了 cto-review 触发逻辑，但 SKILL.md 本体从未在任何位置创建。三个核心 Engine skill（dev/intent-expand/cto-review）中，cto-review 是唯一没有 SKILL.md 的。路径归属也有误——workflows 是 Agent 协议层，Engine skills 才是正确位置。

### 下次预防

- [ ] 新增 Brain task_type 时，同步检查对应的 Engine SKILL.md 是否存在
- [ ] Engine skills 目录下每个 skill 必须有 SKILL.md，否则 scan-rci-coverage.cjs 会报 uncovered
- [ ] skill 文件中的维度名称（如 `DoD符合度`）需与 DoD 测试字符串完全匹配（含空格）

## 技术细节

- `packages/engine/skills/cto-review/SKILL.md` 包含五个审查维度、PASS/WARN/FAIL 决定规则、Brain execution-callback 回调格式
- brain task_type=cto_review 路由到西安 Codex（Codex B）执行
- devloop-check.sh 条件 2.5 等待 cto_review_status=PASS 后才放行 push
