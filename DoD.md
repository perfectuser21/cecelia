contract_branch: cp-harness-review-approved-a4a522ce
workstream_index: 1
sprint_dir: sprints/harness-planner-upgrade-v1

- [x] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且版本号为 5.0
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('5.0')){process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] Step 0 包含 Brain context API 自动采集指令
  Test: 引用 F1-C1 命令
- [x] [BEHAVIOR] PRD 模板包含全部 8 个结构化章节（User Stories/Given-When-Then/FR-xxx/SC-xxx/假设/边界/范围/受影响文件）
  Test: 引用 F2-C1 命令
- [x] [BEHAVIOR] 9 类歧义自检完整覆盖 + ASSUMPTION 标记机制
  Test: 引用 F3-C1 + F3-C2 命令
- [x] [BEHAVIOR] OKR 对齐章节含独立 KR 字段 + 进度 + 推进 + fallback 假设
  Test: 引用 F4-C1 + F4-C2 命令
- [x] [BEHAVIOR] 全文无用户交互占位符
  Test: 引用 F1-C2 命令
