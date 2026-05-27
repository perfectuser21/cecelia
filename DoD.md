contract_branch: direct-task-injection
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — WS3: dev/SKILL.md 路径 A/B Brain 任务登记补全

**范围**: 在 `packages/workflows/skills/dev/SKILL.md` 的 Brain 任务登记段添加路径 A（Bug）完整流程和路径 B（小改动）登记步骤
**大小**: S（~40 行文档更新）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/workflows/skills/dev/SKILL.md` 包含路径 A/B 描述段
  Test: grep -q "路径 A" packages/workflows/skills/dev/SKILL.md

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] dev/SKILL.md 包含 api/brain/issues 端点调用
  Test: manual:bash -c 'grep -q "api/brain/issues" packages/workflows/skills/dev/SKILL.md && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] dev/SKILL.md POST /api/brain/tasks 含 issue_id 参数
  Test: manual:bash -c 'grep -q "issue_id" packages/workflows/skills/dev/SKILL.md && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] dev/SKILL.md POST /api/brain/tasks 含 journey_id 参数
  Test: manual:bash -c 'grep -q "journey_id" packages/workflows/skills/dev/SKILL.md && echo OK || exit 1'
  期望: OK

- [x] [BEHAVIOR] dev/SKILL.md 包含 journey_id 缺失 NULL 保护说明
  Test: manual:bash -c 'grep -q ":-null\|journey_id.*null\|缺失.*null\|NULL" packages/workflows/skills/dev/SKILL.md && echo OK || exit 1'
  期望: OK
