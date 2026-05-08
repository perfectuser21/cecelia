---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 1: 三份文档对齐 + journey.md

**范围**: SKILL.md / FIELDS.md 路径与字段对齐到 PRD 规定的 `creator/output/douyin/{date}/`；新建 journey.md 元数据文件
**大小**: S（< 100 行新增/修改）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/workflows/skills/douyin-publisher/SKILL.md` 不再含 `~/.douyin-queue` 历史路径
  Test: `[ "$(grep -c "~/.douyin-queue" packages/workflows/skills/douyin-publisher/SKILL.md)" = "0" ] || exit 1`

- [ ] [ARTIFACT] `packages/workflows/skills/douyin-publisher/SKILL.md` 含统一 NAS 路径 `creator/output/douyin/`
  Test: `grep -q "creator/output/douyin/" packages/workflows/skills/douyin-publisher/SKILL.md || exit 1`

- [ ] [ARTIFACT] `packages/workflows/skills/douyin-publisher/SKILL.md` 显式描述 SCP 跨机跳板架构（含 "xian-mac" 跳板字样）
  Test: `grep -qE "xian-mac.*跳板|跳板.*xian-mac|xian-mac.*SCP|SCP.*xian-mac" packages/workflows/skills/douyin-publisher/SKILL.md || exit 1`

- [ ] [ARTIFACT] `packages/workflows/skills/douyin-publisher/FIELDS.md` 含 video 类型必填字段表（title.txt / video.mp4 三件套）
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/douyin-publisher/FIELDS.md','utf8');for(const k of ['title.txt','video.mp4']){if(!c.includes(k))process.exit(1)}"`

- [ ] [ARTIFACT] `packages/workflows/skills/douyin-publisher/FIELDS.md` 含退出码 0/1/2 三态完整定义
  Test: `for code in "exit 0" "exit 1" "exit 2"; do grep -q "$code" packages/workflows/skills/douyin-publisher/FIELDS.md || exit 1; done`

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/journey.md` 文件存在
  Test: `test -f .agent-knowledge/content-pipeline-douyin/journey.md || exit 1`

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/journey.md` 含 `journey_type: agent_remote` 元数据
  Test: `grep -q "agent_remote" .agent-knowledge/content-pipeline-douyin/journey.md || exit 1`

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/journey.md` 含 8 步 Journey 定义
  Test: `[ "$(grep -cE "^[-*]?\\s*Step [1-8]" .agent-knowledge/content-pipeline-douyin/journey.md)" -ge "8" ] || exit 1`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/docs-alignment.test.ts`，覆盖：
- 解析 SKILL.md 提取主 NAS 路径 → 应等于 `creator/output/douyin/{date}/`
- 解析 FIELDS.md 提取退出码集合 → 应包含 {0, 1, 2}
- 解析 journey.md 提取 journey_type → 应等于 `agent_remote`
- 解析 journey.md 提取 Step 数组 → 长度应 = 8
