contract_branch: cp-05251409-ws-4e73a2b3-ws5
workstream_index: 5
sprint_dir: sprints/cecelia-pipeline-viz-v2

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 5: E2E 截图链路验证

**范围**: `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts` — 轻量 E2E 脚本，验证 WS1-WS4 完整截图写入链路
**大小**: S（40-60 行）
**依赖**: Workstream 4 完成后

---

## Risks

### R5a: /tmp/e2e-start-marker 未在截图前创建导致 COUNT 统计历史截图
**影响**: 若 E2E 脚本前置步骤未执行 `touch /tmp/e2e-start-marker`，`find -newer` 会统计所有历史 PNG，造假通过。
**缓解**: BEHAVIOR 2 的 `find -newer /tmp/e2e-start-marker` 依赖 final-e2e 脚本开头的 `execSync('touch /tmp/e2e-start-marker')`（已在 E2E 脚本中声明）；WS5 evaluator 在触发 E2E 前自动 touch 标记。

### R5b: 流水线目录结构检查因文件路径不同而 FAIL
**影响**: PRD DoD #8 检查 `sprints/cecelia-pipeline-viz-v2/contract-dod-ws*.md`，若 sprint 目录名拼写不同（如 `cecelia-pipeline-vis-v2`），所有文件检查 FAIL。
**缓解**: 目录名 `sprints/cecelia-pipeline-viz-v2/` 在 PRD DoD #8 中字面定义，generator 须使用完全相同的路径；此目录在 Round 1 已创建，路径已固定。

---

## ARTIFACT 条目

- [ ] [ARTIFACT] PRD DoD #8：`sprints/cecelia-pipeline-viz-v2/sprint-prd.md` 存在
  Test: node -e "require('fs').accessSync('sprints/cecelia-pipeline-viz-v2/sprint-prd.md');console.log('OK')"

- [ ] [ARTIFACT] PRD DoD #8：`sprints/cecelia-pipeline-viz-v2/contract-dod-ws1.md` 至 `contract-dod-ws5.md` 全部存在（每 WS 一份）
  Test: node -e "const fs=require('fs');['ws1','ws2','ws3','ws4','ws5'].forEach(w=>{fs.accessSync('sprints/cecelia-pipeline-viz-v2/contract-dod-'+w+'.md')});console.log('OK')"

- [ ] [ARTIFACT] `sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts` 存在且含截图目录验证逻辑
  Test: node -e "const c=require('fs').readFileSync('sprints/cecelia-pipeline-viz-v2/tests/ws5/e2e-screenshot-chain.test.ts','utf8');if(!c.includes('harness-screenshots'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `~/claude-output/harness-screenshots/` 目录可被创建（前置环境验证）
  Test: node -e "const p=require('path').join(process.env.HOME,'claude-output/harness-screenshots');require('fs').mkdirSync(p,{recursive:true});console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] WS5 E2E 脚本跑完后，`~/claude-output/harness-screenshots/` 目录存在（不缺失前置目录）
  Test: manual:bash -c 'mkdir -p "$HOME/claude-output/harness-screenshots" && ls "$HOME/claude-output/harness-screenshots" && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] `~/claude-output/harness-screenshots/` 目录有 ≥1 个 PNG 文件（E2E 跑后，带时间窗口）
  Test: manual:bash -c 'COUNT=$(find "$HOME/claude-output/harness-screenshots" -name "*.png" -newer /tmp/e2e-start-marker -type f 2>/dev/null | wc -l | tr -d " "); [ "$COUNT" -ge 1 ] && echo OK || { echo "FAIL: 无新 PNG，COUNT=$COUNT"; exit 1; }'
  期望: OK（需先 touch /tmp/e2e-start-marker 再跑 E2E）

- [ ] [BEHAVIOR] `/api/brain/harness/initiative/:id/detail` 端到端可访问（WS1-WS4 全部就位后链路完整）
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); [ "$CODE" = "200" ] && echo OK || { echo "FAIL: HTTP $CODE"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] Dashboard /pipeline 页的 initiative card 点击后，详情面板 API 请求成功（Playwright API 断言，非 UI）
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "SELECT id FROM tasks WHERE task_type='"'"'harness_initiative'"'"' LIMIT 1" | tr -d " "); RESP=$(curl -sf "localhost:5221/api/brain/harness/initiative/${TEST_ID}/detail"); echo "$RESP" | jq -e '"'"'.initiative_id | type == "string"'"'"' && echo "$RESP" | jq -e '"'"'.step_timing | type == "array"'"'"' && echo OK || exit 1'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 専属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 跑完 WS5 E2E 后，screenshots/ 目录有 ≥1 个 PNG 文件，~/claude-output/harness-screenshots/ 同步有文件
  Screenshots:
    - 01-pipeline-list.png  期望：/pipeline 列表页正常渲染，有 initiative card 可见
    - 03-detail-panel.png   期望：initiative 详情面板已展开，initiative-detail-panel 元素可见
    - 05-timeline.png       期望：步骤时间线区块可见（initiative-step-timeline 元素存在）
  期望：所有截图可读；Claude Read 图确认 DOM 与期望描述一致；~/claude-output/harness-screenshots/ 同步存在对应文件
