contract_branch: cp-05271809-ws-241ad22e-ws4
workstream_index: 4
sprint_dir: sprints/harness-journey-tracking

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 4: harness-report/SKILL.md Notion Project/Task 创建步骤

**范围**: packages/workflows/skills/harness-report/SKILL.md — 在 Step 2 后插入 Notion Project 创建（Run 级，status=Done）+ Notion Task 遍历（WS{n}—{PR_TITLE}，status=Done），含 WARN 降级（非阻断）
**大小**: S（SKILL.md 文档新增段落 ~40 行）
**依赖**: WS2（harness-report 文档归档步骤）已完成

## ARTIFACT 条目

- [ARTIFACT] packages/workflows/skills/harness-report/SKILL.md 新增 Notion Project/Task 段落存在

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [BEHAVIOR] harness-report/SKILL.md 含 api/brain/notion/project
  Test: manual:bash -c 'grep -c "api/brain/notion/project" packages/workflows/skills/harness-report/SKILL.md | grep -v "^0$" && echo PASS || exit 1'

- [BEHAVIOR] harness-report/SKILL.md 含 api/brain/notion/task
  Test: manual:bash -c 'grep -c "api/brain/notion/task" packages/workflows/skills/harness-report/SKILL.md | grep -v "^0$" && echo PASS || exit 1'

- [BEHAVIOR] harness-report/SKILL.md 含 "Done" 状态值（大写D，PRD原文）
  Test: manual:bash -c 'grep -c "\"Done\"" packages/workflows/skills/harness-report/SKILL.md | grep -v "^0$" && echo PASS || exit 1'

- [BEHAVIOR] harness-report/SKILL.md 含 WARN 降级（Brain API 离线不阻断）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\"); const idx=c.indexOf(\"api/brain/notion/project\"); if(idx<0) process.exit(1); const s=c.slice(idx,idx+2000); if(!s.includes(\"WARN\")) process.exit(1); console.log(\"PASS: 含 WARN 降级\")"'

- [BEHAVIOR] harness-report/SKILL.md 含 WS{n} 标题格式
  Test: manual:bash -c 'grep -c "WS{n}" packages/workflows/skills/harness-report/SKILL.md | grep -v "^0$" && echo PASS || exit 1'

- [BEHAVIOR] harness-report/SKILL.md Notion Project payload 含 journey_id
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/workflows/skills/harness-report/SKILL.md\",\"utf8\"); const idx=c.indexOf(\"api/brain/notion/project\"); if(idx<0) process.exit(1); const s=c.slice(idx,idx+1500); if(!s.includes(\"journey_id\")) process.exit(1); console.log(\"PASS: Notion Project payload 含 journey_id\")"'
