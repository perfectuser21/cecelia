---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 路由配置前置注册

**范围**: `task-router.js` 新增 harness_intervention 到 VALID_TASK_TYPES + LOCATION_MAP(us)；`packages/brain/.env` 写入 BARK_TOKEN + FEISHU_WEBHOOK=（飞书中间层预留）
**大小**: S（<18 行净增，2 文件）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/task-router.js` 的 VALID_TASK_TYPES 数组包含 `'harness_intervention'`
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!s.includes(\"'harness_intervention'\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/task-router.js` 的 LOCATION_MAP 包含 `'harness_intervention': 'us'`
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!s.match(/'harness_intervention':\s*'us'/))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/.env` 存在并包含 `BARK_TOKEN=` 行
  Test: node -e "const s=require('fs').readFileSync('packages/brain/.env','utf8');if(!s.includes('BARK_TOKEN='))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/.env` 包含 `FEISHU_WEBHOOK=` 行（飞书中间层降级预留）
  Test: node -e "const s=require('fs').readFileSync('packages/brain/.env','utf8');if(!s.includes('FEISHU_WEBHOOK='))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] VALID_TASK_TYPES 包含 harness_intervention（写入前此项 FAIL）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/task-router.js\",\"utf8\");const match=s.match(/VALID_TASK_TYPES\s*=\s*\[[\s\S]*?\]/);if(!match||!match[0].includes(\"harness_intervention\")){console.error(\"FAIL: harness_intervention not in VALID_TASK_TYPES\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [x] [BEHAVIOR] LOCATION_MAP 明确映射 harness_intervention → 'us'（不靠 DEFAULT_LOCATION 兜底）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/task-router.js\",\"utf8\");if(!s.match(/{[^}]*'\''harness_intervention'\''\s*:\s*'\''us'\''/)){console.error(\"FAIL: 缺显式映射\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [x] [BEHAVIOR] .env 包含 BARK_TOKEN=...行（非空值）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/.env\",\"utf8\");const m=s.match(/BARK_TOKEN=(\S+)/);if(!m||m[1].length<5){console.error(\"FAIL: BARK_TOKEN 缺失或空\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [x] [BEHAVIOR] error path — VALID_TASK_TYPES 变更不破坏现有路由（regression：dev → us 仍工作）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/task-router.js\",\"utf8\");if(!s.match(/'\'dev'\''\s*:\s*'\''us'\''/)){console.error(\"FAIL: dev→us 路由被破坏\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）

- [x] [BEHAVIOR] .env 包含 FEISHU_WEBHOOK= 行（飞书中间层降级链可配置）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/.env\",\"utf8\");if(!s.includes(\"FEISHU_WEBHOOK=\")){console.error(\"FAIL: FEISHU_WEBHOOK 缺失，飞书中间层无法配置\");process.exit(1);}console.log(\"OK\")"'
  期望: OK（exit 0）
