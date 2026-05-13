---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: seed + drive + evidence 采集

**范围**: seed 脚本造演练 W 任务（第 1 轮 FAIL / 第 2 轮 PASS）、drive 脚本驱动 + 轮询 + 5 类证据采集
**大小**: M（100-300 行）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] seed 脚本存在且 node --check 通过
  Test: manual:node --check packages/brain/scripts/seed-w41-demo-task.js

- [x] [ARTIFACT] drive 脚本存在且 node --check 通过
  Test: manual:node --check packages/brain/scripts/drive-w41-e2e.js

- [x] [ARTIFACT] evidence 目录含 5 个非空文件
  Test: manual:bash -c 'EVID=sprints/w41-walking-skeleton-final-b19/evidence; for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt dispatch-events.csv brain-log-excerpt.txt; do [ -s "$EVID/$f" ] || { echo "缺 $f"; exit 1; }; done'

- [x] [ARTIFACT] seed-output.json 含合法 demo_task_id (UUID v4) + injected_at (ISO 8601)
  Test: manual:bash -c 'jq -e ".demo_task_id | test(\"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json && jq -e ".injected_at | test(\"^[0-9]{4}-[0-9]{2}-[0-9]{2}T\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'

