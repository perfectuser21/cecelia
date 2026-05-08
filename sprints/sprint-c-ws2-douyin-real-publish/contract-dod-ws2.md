---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 2: Lead 自验机制工程化 + E2E smoke 脚手架

**范围**: 建立 Lead 自验 evidence 文件模板 + 截图归档目录 + E2E smoke 测试骨架（不允许 mock SCP/CDP，每步含显式 Step 标记）
**大小**: M（100-300 行）
**依赖**: WS1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md` 文件存在
  Test: `test -f .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] lead-acceptance 模板含 PRD 7 步 checklist（Step 1 到 Step 7 各 1 行标题）
  Test: `[ "$(grep -cE "^[#]+\\s*(步骤|Step) [1-7]" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md)" -ge "7" ] || exit 1`

- [ ] [ARTIFACT] lead-acceptance 模板含 ≥ 3 个截图引用占位（markdown image syntax 指向 ./screenshots/）
  Test: `[ "$(grep -cE "!\\[.*\\]\\(\\./screenshots/[^)]+\\)" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md)" -ge "3" ] || exit 1`

- [ ] [ARTIFACT] lead-acceptance 模板含 cmd stdout 占位区块（步骤 2 CDP 探活 + 步骤 3 Mac mini 触发）
  Test: `grep -q "19222" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md && grep -q "batch-publish-douyin" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] lead-acceptance 模板含 Lead 签名占位行模板（"Cecelia, YYYY-MM-DD, 自验通过" 或填充后形态）
  Test: `grep -qE "Cecelia.*(YYYY|2026-)" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] lead-acceptance 模板含 item_id 占位字段
  Test: `grep -qE "item_id|ItemId|Item ID" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/screenshots/` 目录存在（.gitkeep 占位）
  Test: `test -d .agent-knowledge/content-pipeline-douyin/screenshots || exit 1`

- [ ] [ARTIFACT] `tests/content-pipeline-douyin-e2e.test.js` 文件存在
  Test: `test -f tests/content-pipeline-douyin-e2e.test.js || exit 1`

- [ ] [ARTIFACT] E2E smoke 含 ≥ 5 个 Step 显式标记（step-1 到 step-7 至少出现 5 个）
  Test: `[ "$(grep -cE "[Ss]tep[ _-]?[1-7]" tests/content-pipeline-douyin-e2e.test.js)" -ge "5" ] || exit 1`

- [ ] [ARTIFACT] E2E smoke 不含 mock SCP/CDP/playwright connect 关键字（PRD 真链路要求）
  Test: `! grep -qE "jest\\.mock.*child_process|jest\\.mock.*ssh|jest\\.mock.*playwright|mockImplementation.*scp|playwright.*\\.mock\\(" tests/content-pipeline-douyin-e2e.test.js || exit 1`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/lead-acceptance-template.test.ts`，覆盖：
- 解析 lead-acceptance 模板：必含 7 个步骤标题、≥ 3 个截图占位、Lead 签名行模板
- 解析 E2E smoke：含 ≥ 5 个 Step 显式标记
- E2E smoke 静态扫描：不含 mock SCP/CDP 任何变体
- E2E smoke 失败信息含挂在哪一步的 step 编号
