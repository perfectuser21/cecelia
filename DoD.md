contract_branch: cp-harness-propose-r2-801eba1e
workstream_index: 1
sprint_dir: sprints/codex-xian-verify

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: goals.js /health 新增 codex_bridge_status 探活字段

**范围**: `packages/brain/src/routes/goals.js` `/health` handler 新增对 `${XIAN_CODEX_BRIDGE_URL}/accounts` 的 2s 超时探活，根据结果写入 `codex_bridge_status: "online"|"offline"`；catch-all 确保任何失败/超时/throw 均写 `"offline"`；字段无论 HARNESS_XIAN_ENABLED 取值始终出现
**大小**: S (<100 行净增，1 文件)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/goals.js` /health handler 含 `codex_bridge_status` 字段写入
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/goals.js','utf8');if(!c.includes('codex_bridge_status'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/goals.js` 含 bridge 探活 URL（XIAN_CODEX_BRIDGE_URL 或默认值）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/goals.js','utf8');if(!c.includes('XIAN_CODEX_BRIDGE_URL')&&!c.includes('100.86.57.69'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/goals.js` 含 offline fallback（catch + 'offline' 字符串）
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/routes/goals.js','utf8');if(!c.includes('offline'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（evaluator 逐 WS 跑 — autonomous 模式 A，curl 测真实 Brain localhost:5221）

- [ ] [BEHAVIOR] GET /api/brain/health 响应包含 codex_bridge_status 字段，类型为 string
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/health | jq -e '"'"'.codex_bridge_status | type == "string"'"'"' || { echo "FAIL: 字段缺失或类型错误"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] codex_bridge_status 值为合法枚举 "online" 或 "offline"（不接受其他任何值）
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/health | jq -e '"'"'(.codex_bridge_status == "online") or (.codex_bridge_status == "offline")'"'"' || { echo "FAIL: 非法枚举值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] schema 完整性 — 响应同时包含 codex_bridge_status、status、uptime_seconds（新字段与现有字段共存）
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/health | jq -e '"'"'has("codex_bridge_status") and has("status") and has("uptime_seconds")'"'"' || { echo "FAIL: schema 不完整"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用变体不存在 — codex_bridge_status 不等于 up/down/ok/reachable/active/unavailable（null 防护）
  Test: manual:bash -c 'curl -sf localhost:5221/api/brain/health | jq -e '"'"'.codex_bridge_status != null and (.codex_bridge_status | IN("up","down","ok","reachable","active","unavailable") | not)'"'"' || { echo "FAIL: 使用了禁用变体"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — bridge 探活 offline 时 health 仍返 HTTP 200（goals.js 含 catch-all + offline fallback 逻辑，由 WS2 单元测试验证探活失败路径）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/health); [ "$CODE" = "200" ] || { echo "FAIL: health 返回 $CODE 而非 200"; exit 1; }; curl -sf localhost:5221/api/brain/health | jq -e '"'"'has("codex_bridge_status")'"'"' || { echo "FAIL: offline 路径下字段缺失"; exit 1; }; echo OK'
  期望: OK
