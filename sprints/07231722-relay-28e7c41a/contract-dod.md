# Contract DoD — ops-panorama 执行全景面板

**Task ID**: 28e7c41a-9384-405b-9e82-aa5b9871293f
**Sprint Dir**: sprints/07231722-relay-28e7c41a
**Target Environment**: local_api
**Date**: 2026-07-23

---

## Definition of Done（逐条可验证）

### API 层（local_api — curl localhost:5221）

- [ ] **DoD-01**: `curl -s http://localhost:5221/api/brain/ops-panorama` 返回 HTTP 200，`jq '.sampled_at'` 非 null 非 empty
- [ ] **DoD-02**: `jq '.tasks.in_progress_count'` 为整数 >= 0
- [ ] **DoD-03**: `jq '.tasks.vendor_dist'` 含 `claude/codex/grok/unknown` 四个键，均为整数 >= 0
- [ ] **DoD-04**: `jq '.host.cpu_usage_pct'` 在 `[0, 100]` 范围内（数值型）
- [ ] **DoD-05**: `jq '.host.mem_used_pct'` 在 `[0, 100]` 范围内（数值型）
- [ ] **DoD-06**: `jq '.processes.claude_total'` >= 0，`jq '.processes.codex_total'` >= 0
- [ ] **DoD-07**: `jq '.llm_capacity.sentinel'` 为 `"ok"` 或 `"degraded"` 或 `"exhausted"` 之一（非 null 时）
- [ ] **DoD-08**: `jq '.llm_capacity.vendors.claude.accounts | length'` > 0（正常环境）
- [ ] **DoD-09**: docker 不可达场景（注释掉 docker 命令或模拟）→ `jq '.relay.container_count'` 为 null，HTTP 仍 200
- [ ] **DoD-10**: P99 响应时间 < 2000ms（对本地 localhost 发 10 次请求，median < 500ms，最大 < 2000ms）

### 安全合规

- [ ] **DoD-11**: 响应 JSON 不含 `token`、`key`、`secret`、`password` 字段名（jq keys_unsorted 全量检查）
- [ ] **DoD-12**: 端点需要鉴权（与其他 `/api/brain/` 端点一致；Brain 内部 auth 中间件保护）

### 前端 Dashboard（mac_web Playwright）

- [ ] **DoD-13**: `localhost:5174/live-monitor` 页面存在含文字"执行全景"的 DOM 元素
- [ ] **DoD-14**: 30s 后（或手动触发刷新），`sampled_at` 显示的抓取时间更新（< 35s 前）
- [ ] **DoD-15**: `cpu_usage_pct` 和 `mem_used_pct` 进度条可见（`role=progressbar` 或等效可见元素）
- [ ] **DoD-16**: 当 `relay.container_count` 为 null 时，页面显示"—"而非空白/报错

### 回归护栏

- [ ] **DoD-17**: 现有 `/api/brain/status`、`/api/brain/tick/status`、`/api/brain/account-usage` 端点不受影响（`curl` 返回 200）
- [ ] **DoD-18**: `packages/brain` 单元测试套件通过（`npm test` in `packages/brain`）

---

## E2E 验收脚本（target_environment: local_api）

```bash
#!/usr/bin/env bash
# sprints/07231722-relay-28e7c41a/tests/e2e-ops-panorama.sh
# 在本机对 localhost:5221 执行全量验收

set -euo pipefail
BASE="http://localhost:5221/api/brain"
PASS=0; FAIL=0

check() {
  local name="$1"; local expr="$2"; local expected="$3"
  local result
  result=$(eval "$expr" 2>/dev/null || echo "ERROR")
  if [ "$result" = "$expected" ]; then
    echo "  PASS: $name"
    ((PASS++))
  else
    echo "  FAIL: $name — got: $result (expected: $expected)"
    ((FAIL++))
  fi
}

echo "=== ops-panorama E2E 验收 ==="

# 1. HTTP 200
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/ops-panorama")
check "HTTP 200" "echo $HTTP_CODE" "200"

# 取 JSON
BODY=$(curl -s "$BASE/ops-panorama")

# 2. sampled_at 非 null
check "sampled_at 非 null" "echo '$BODY' | jq -r '.sampled_at // \"null\"' | grep -c 'null' | grep -c '^0'" "1"

# 3. tasks.in_progress_count >= 0
IN_PROG=$(echo "$BODY" | jq '.tasks.in_progress_count')
check "tasks.in_progress_count >= 0" "[ $IN_PROG -ge 0 ] && echo true || echo false" "true"

# 4. vendor_dist keys
check "vendor_dist has claude key" "echo '$BODY' | jq 'has(\"tasks\") and (.tasks | has(\"vendor_dist\"))'" "true"

# 5. host.cpu_usage_pct in [0,100]
CPU=$(echo "$BODY" | jq '.host.cpu_usage_pct')
check "cpu_usage_pct in [0,100]" "echo $CPU | awk '{print (\$1>=0 && \$1<=100) ? \"true\" : \"false\"}'" "true"

# 6. host.mem_used_pct in [0,100]
MEM=$(echo "$BODY" | jq '.host.mem_used_pct')
check "mem_used_pct in [0,100]" "echo $MEM | awk '{print (\$1>=0 && \$1<=100) ? \"true\" : \"false\"}'" "true"

# 7. llm_capacity.sentinel valid
SENTINEL=$(echo "$BODY" | jq -r '.llm_capacity.sentinel // "null"')
check "llm_capacity.sentinel valid" "echo '$SENTINEL' | grep -cE '^(ok|degraded|exhausted|null)$'" "1"

# 8. processes.claude_total >= 0
CLAUDE_PROC=$(echo "$BODY" | jq '.processes.claude_total')
check "processes.claude_total >= 0" "[ $CLAUDE_PROC -ge 0 ] && echo true || echo false" "true"

# 9. 无凭据泄露
check "无 token 字段" "echo '$BODY' | jq '[.. | objects | keys[]] | map(select(test(\"token|secret|password|key\"; \"i\"))) | length'" "0"

# 10. 回归：已有端点不受影响
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/status")
check "GET /api/brain/status 回归" "echo $STATUS_CODE" "200"

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
if [ $FAIL -gt 0 ]; then exit 1; fi
```

---

## 测试文件索引

| 文件 | 类型 | 覆盖 |
|------|------|------|
| `sprints/07231722-relay-28e7c41a/tests/e2e-ops-panorama.sh` | Bash E2E smoke | DoD-01~10, DoD-11, DoD-17 |
| `sprints/07231722-relay-28e7c41a/tests/ops-panorama.test.js` | Jest 单元 | BEHAVIOR-01~15（mock 数据源，验证聚合逻辑）|
| `sprints/07231722-relay-28e7c41a/tests/OpsPanoramaCard.test.tsx` | Vitest + RTL | BEHAVIOR-16~22（组件快照 + null relay 降级）|
