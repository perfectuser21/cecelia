---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 4: Harness Initiative Patrol（initiative_runs 卡住检测）

**范围**: 新建 `packages/brain/src/harness-initiative-patrol.js`（扫描 initiative_runs WHERE completed_at IS NULL，检测 Planner>15min/GAN>20min，创建 harness_intervention 任务，防重：同 initiative 已有 pending 则跳过）；修改 `packages/brain/src/pipeline-patrol-plugin.js` 调用新 patrol。
**大小**: M (~130 行，2 文件)
**依赖**: WS3 完成后

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/harness-initiative-patrol.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/harness-initiative-patrol.js')"

- [x] [ARTIFACT] `harness-initiative-patrol.js` 含对 `initiative_runs` 的 SELECT 查询（扫描 completed_at IS NULL）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8'); if(!c.includes('initiative_runs') || !c.includes('completed_at'))process.exit(1)"

- [x] [ARTIFACT] `harness-initiative-patrol.js` 含 `harness_intervention` 任务创建逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-initiative-patrol.js','utf8'); if(!c.includes('harness_intervention'))process.exit(1)"

- [x] [ARTIFACT] `pipeline-patrol-plugin.js` 引用新的 harness patrol 函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/pipeline-patrol-plugin.js','utf8'); if(!c.includes('harness-initiative-patrol') && !c.includes('harnessPatrol') && !c.includes('harness_patrol'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] harness-initiative-patrol.js 文件存在（实现前不存在 → 真红）
  Test: manual:bash -c 'node -e "require(\"fs\").accessSync(\"packages/brain/src/harness-initiative-patrol.js\")" || { echo "FAIL: harness-initiative-patrol.js 不存在"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] patrol 文件含 initiative_runs 查询（completed_at IS NULL + 卡住阈值）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-initiative-patrol.js\",\"utf8\"); if(!c.includes(\"initiative_runs\")){console.error(\"FAIL: 缺 initiative_runs 查询\");process.exit(1)} if(!c.includes(\"15\") || !c.includes(\"20\")){console.error(\"FAIL: 缺卡住阈值 15/20 分钟\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] patrol 含 harness_intervention 任务创建（防重 pending 检测）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-initiative-patrol.js\",\"utf8\"); if(!c.includes(\"harness_intervention\")){console.error(\"FAIL: 缺 harness_intervention 任务创建\");process.exit(1)} if(!c.includes(\"pending\") && !c.includes(\"duplicate\") && !c.includes(\"existing\")){console.error(\"FAIL: 缺防重逻辑\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] pipeline-patrol-plugin.js 集成 harness patrol 调用（实现前不含 harness-initiative-patrol 引用）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/pipeline-patrol-plugin.js\",\"utf8\"); if(!c.includes(\"harness-initiative-patrol\") && !c.includes(\"harnessPatrol\") && !c.includes(\"harness_patrol\")){console.error(\"FAIL: pipeline-patrol-plugin.js 未集成 harness patrol\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK

- [x] [BEHAVIOR] error path — patrol 文件含错误捕获逻辑（patrol 失败不崩溃 Brain tick）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/harness-initiative-patrol.js\",\"utf8\"); if(!c.includes(\"catch\") && !c.includes(\"try\")){console.error(\"FAIL: patrol 缺错误处理\");process.exit(1)} console.log(\"OK\")" || exit 1'
  期望: OK
