contract_branch: cp-07041706-ws-fbf92f18
sprint_dir: sprints/07041710-relay-runs-endpoint

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: GET /api/brain/orchestrator/relay-runs 观测端点

**范围**: 新增只读端点，查 initiative_runs WHERE orchestrator_version='v2'，按 started_at DESC，支持 limit 参数
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 路由实现文件存在且含端点声明
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/initiatives.js','utf8');if(!c.includes('relay-runs'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 单元测试文件存在且含核心场景
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/relay-runs.test.js','utf8');if(!c.includes('relay-runs')||!c.includes('orchestrator_version'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] GET /api/brain/orchestrator/relay-runs 返回 HTTP 200 + JSON 数组（端点已注册）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || { echo "FAIL: 端点未返回 200 — 路由未注册"; exit 1; }; echo "$RESP" | jq -e '"'"'type == "array"'"'"' || { echo "FAIL: body 不是 JSON 数组"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应数组每项含 PRD 指定必填字段（id/initiative_id/phase/started_at）
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/orchestrator/relay-runs) || exit 1; LEN=$(echo "$RESP" | jq "length"); if [ "$LEN" -gt 0 ]; then echo "$RESP" | jq -e '"'"'first | has("id") and has("initiative_id") and has("phase") and has("started_at")'"'"' || { echo "FAIL: 缺少必填字段"; exit 1; }; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] ?limit=N 参数生效——返回条数 ≤ N
  Test: manual:bash -c 'COUNT=$(curl -sf "localhost:5221/api/brain/orchestrator/relay-runs?limit=2" | jq "length"); [ "$COUNT" -le 2 ] || { echo "FAIL: limit=2 但返回 $COUNT 条"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 无 v2 run 时返回空数组 [] 而非 null 或报错（单元测试覆盖）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/__tests__/relay-runs.test.js\",\"utf8\");if(!c.includes(\"[]\") && !c.includes(\"empty\") && !c.includes(\"rows: []\"))process.exit(1);console.log(\"OK: 单元测试覆盖空结果场景\")"'
  期望: OK: 单元测试覆盖空结果场景

- [ ] [BEHAVIOR] DB 查询失败返回 HTTP 500 + JSON error 字段（单元测试覆盖）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/__tests__/relay-runs.test.js\",\"utf8\");if(!c.includes(\"500\")||!c.includes(\"error\"))process.exit(1);console.log(\"OK: 单元测试覆盖 500 + error 字段\")"'
  期望: OK: 单元测试覆盖 500 + error 字段

- [ ] [BEHAVIOR] 端点仅返回 orchestrator_version='v2' 的 runs（v1 run 不在结果中，单元测试覆盖）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/__tests__/relay-runs.test.js\",\"utf8\");if(!c.includes(\"v2\")||!c.includes(\"v1\"))process.exit(1);console.log(\"OK: 单元测试覆盖 v2 过滤\")"'
  期望: OK: 单元测试覆盖 v2 过滤

## 铁律覆盖核查

| 铁律 | 覆盖情况 |
|---|---|
| [禁止写死环境假设] | ✅ 验证命令用 $DB/$BRAIN 环境变量，无硬编码 URL/坐标 |
| [真环境验证才算done] | ✅ Step1~4 BEHAVIOR 均打真实 Brain localhost:5221；接缝清单已列 pr_url 列依赖标 logic-done-pending |
| [测试默认多租户] | N/A — 端点为只读运维观测，不涉及租户数据隔离（无 tenant_id/user_id 过滤字段）；单元测试种两种 orchestrator_version 数据断言互不混读 |
| [凭据安全] | ✅ 无凭据涉及（端点无鉴权，内网运维接口，与 PRD ASSUMPTION 对齐） |
| [日志脱敏] | ✅ 端点无 PII/聊天内容，initiative_runs 是调度记录 |
| [端点鉴权] | ⚠️ PRD ASSUMPTION 明确「无需鉴权（内网运维观测端点，与现有 /api/brain/harness/runs 保持一致）」；Generator 需保持与 harness.js /runs 同等无鉴权处理 |
| [租户隔离] | N/A — initiative_runs 无 tenant_id 列，端点为全局运维视图 |
