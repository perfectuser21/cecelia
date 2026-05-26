contract_branch: cp-05270009-ws-9e2bb3da-ws1
workstream_index: 1
sprint_dir: sprints/ws2-route-b-verify

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 创建 verify-route-b.sh 端到端验证脚本

**范围**: 在 `sprints/ws2-route-b-verify/` 下创建 `verify-route-b.sh`，验证 `/dev` 无 `--task-id` 时 Route B（`POST /api/brain/tasks`）端到端生效
**大小**: S（< 80 行）
**依赖**: 无

---

## ARTIFACT 条目

- [x] [ARTIFACT] (B1) `sprints/ws2-route-b-verify/verify-route-b.sh` 文件存在
  Test: `node -e "require('fs').accessSync('sprints/ws2-route-b-verify/verify-route-b.sh')"`

- [x] [ARTIFACT] 脚本含 `#!/bin/bash` shebang 和 `set -e` 安全标志
  Test: `node -e "const c=require('fs').readFileSync('sprints/ws2-route-b-verify/verify-route-b.sh','utf8');if(!c.includes('#!/bin/bash'))process.exit(1)"`

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — B2–B6）

> **journey_type = dev_pipeline，target_environment = mac_web（本机 bash 执行，无 UI）**
> Mode A：evaluator 逐 ws 跑 — 验证脚本文件内容（真红：文件不存在时 readFileSync → ENOENT → exit 1）
> Mode B：final-e2e — 运行 `bash verify-route-b.sh`（Brain 在线时 exit 0）

- [x] [BEHAVIOR] (B2) 脚本含 Brain 健康检查命令（/api/brain/health）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/ws2-route-b-verify/verify-route-b.sh\",\"utf8\");if(!c.includes(\"health\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] (B3) 脚本含 Route B 触发命令（POST /api/brain/tasks curl）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/ws2-route-b-verify/verify-route-b.sh\",\"utf8\");if(!c.includes(\"/api/brain/tasks\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] (B4) 脚本对 status 作双值断言（in_progress OR completed — Round 2 新增，修复 Round 1 问题 3）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/ws2-route-b-verify/verify-route-b.sh\",\"utf8\");if(!c.includes(\"in_progress\")||!c.includes(\"completed\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] (B5) 脚本含 task_type=dev 和 title 非空断言
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/ws2-route-b-verify/verify-route-b.sh\",\"utf8\");if(!c.includes(\"task_type\")||!c.includes(\"title\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [x] [BEHAVIOR] (B6) 脚本含基线计数或时间窗口防造假逻辑（date +%s 或 300）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"sprints/ws2-route-b-verify/verify-route-b.sh\",\"utf8\");const ok=c.includes(\"date +%s\")||c.includes(\"300\");if(!ok)process.exit(1);console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（dev_pipeline 专属 — Mode B final-e2e）

- [x] [BEHAVIOR:E2E] 完整 Golden Path 执行通过，stdout 含成功标志
  Test: manual:bash -c 'OUTPUT=$(bash sprints/ws2-route-b-verify/verify-route-b.sh 2>&1); echo "$OUTPUT" | grep -q "Route B.*验证通过\|✅" && echo OK || { echo "FAIL"; echo "$OUTPUT"; exit 1; }'
  期望: OK（Brain 在 localhost:5221 在线时）

---

## 自查 checklist 结果（Round 2）

1. PRD Response Schema: N/A（验证任务，无新 HTTP 端点）→ 无需 jq -e 字段匹配
2. Contract jq -e 字段: N/A（此 sprint 产物为 shell 脚本，不是新 API 端点）
3. N/A assertion
4. 禁用字段清单: N/A
5. BEHAVIOR 数量: 5 条（B2–B6）≥ 4 ✅；+E2E 1 条；覆盖 ≥ 4 类场景（健康检查 / Route B 触发 / status 双值断言 / task_type+title 字段 / 防造假时间窗口）✅
6. depends_on: ws1 唯一 ws，`depends_on: []` ✅
7. 假绿自查:
   - B2–B6（文件内容检查）：WS1 未实现时 `readFileSync` 抛 ENOENT → exit 1 → FAIL ✅ 真红
   - B4（status 双值断言）：脚本缺 in_progress 或 completed 字符串时 → exit 1 → FAIL ✅ 真红，不是环境操作
   - BEHAVIOR:E2E（bash 运行）：文件不存在时 bash 报错 → exit 1 → FAIL ✅ 真红
   - 无 mkdir/touch/echo/health-only 假绿操作 ✅
