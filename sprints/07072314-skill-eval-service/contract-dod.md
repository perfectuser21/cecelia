# Contract DoD — Skill Evaluator 内部验收台

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
version: v1.0（首轮）
drafted: 2026-07-07

---

## [BEHAVIOR] INV-01 — 单 slot 串行（Invariant 1）

**描述**：Brain tick 同时运行的 skill_eval 任务数不超过 1。

**断言**：
- `SELECT COUNT(*) FROM skill_eval_tasks WHERE status='running'` 在任意时刻 ≤ 1
- 当 slot 被占用时，新的 pending 任务不转 running，直到当前 running 任务完成或失败

**manual:bash**：
```bash
# 验证数据库中 running 状态的 skill_eval 任务数 ≤ 1
psql -U cecelia -d cecelia -c \
  "SELECT COUNT(*) as running_count FROM skill_eval_tasks WHERE status='running';" \
  | grep -E '^\s+[01]\b'
```

**自动化测试**：`tests/invariant-01-single-slot.test.js`

---

## [BEHAVIOR] INV-02 — 背压拒绝（Invariant 2）

**描述**：pending 队列 ≥ 20 时，新上传请求返回 HTTP 429，不建 task。

**断言**：
- `POST /api/brain/skill-evals/upload`（pending=20 时）→ HTTP 429
- 响应 body: `{ "error": "排队已满" }`
- 数据库 skill_eval_tasks 记录数不增加

**manual:bash**：
```bash
# 查当前 pending 数量
psql -U cecelia -d cecelia -c \
  "SELECT COUNT(*) FROM skill_eval_tasks WHERE status='pending';"

# 模拟背压：当 pending >= 20 时上传应被拒绝（需先构造 20 条 pending）
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -H "X-Eval-Proxy-Token: $SKILL_EVAL_PROXY_TOKEN" \
  -F "file=@/tmp/test-skill.zip" \
  | grep -q "429" && echo "PASS: 背压拒绝正常" || echo "FAIL"
```

**自动化测试**：`tests/invariant-02-backpressure.test.js`

---

## [BEHAVIOR] INV-03 — 额度预检拦截（Invariant 3）

**描述**：Brain 在将 pending→running 转换前验证 Claude 额度；不足则拦截并触发飞书告警。

**断言**：
- 模拟 5h 池 < 85%：pending 任务不转 running，飞书告警记录存在
- 模拟 7d 池 < 90%：同上
- 两池均满足时：任务正常转 running

**manual:bash**：
```bash
# 查看当前额度状态（Brain API）
curl -s http://localhost:5221/api/brain/quota/status | jq '.sonnet_5h_remaining_pct, .sonnet_7d_remaining_pct'

# 查看因额度不足被保持 pending 的任务
psql -U cecelia -d cecelia -c \
  "SELECT task_id, created_at, pending_reason FROM skill_eval_tasks WHERE status='pending' AND pending_reason LIKE '%quota%';"
```

**自动化测试**：`tests/invariant-03-quota-precheck.test.js`

---

## [BEHAVIOR] INV-04 — 硬校验五件套（Invariant 4）

**描述**：上传端点按序执行 6 项校验，任一失败即 HTTP 400 + 具体原因。

**断言（每项独立验证）**：

| 校验项 | 触发条件 | 预期响应 |
|--------|----------|----------|
| zip 魔数 | 文件不以 `PK\x03\x04` 开头 | 400 + `"invalid zip magic bytes"` |
| 文件大小 | zip > MAX_ZIP_MB | 400 + `"zip exceeds MAX_ZIP_MB"` |
| 解压大小 | 解压后 > 50MB | 400 + `"uncompressed size exceeds 50MB"` |
| 文件数 | > 2000 | 400 + `"too many files"` |
| 压缩比 | > 100:1 | 400 + `"compression ratio exceeds 100:1"` |
| SKILL.md | 缺失或有多个 | 400 + `"must contain exactly one SKILL.md"` |
| 路径穿越 | entry 含 `..` | 400 + `"path traversal detected"` |

**manual:bash**：
```bash
# 测试 zip 魔数校验（上传非 zip 文件）
echo "not a zip" > /tmp/fake.zip
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -H "X-Eval-Proxy-Token: $SKILL_EVAL_PROXY_TOKEN" \
  -F "file=@/tmp/fake.zip" \
  | tail -1 | grep -q "400" && echo "PASS: 魔数校验" || echo "FAIL"

# 测试无 SKILL.md（构造无 SKILL.md 的 zip）
mkdir -p /tmp/no-skill-md && echo "content" > /tmp/no-skill-md/README.md
cd /tmp && zip -r no-skill-md.zip no-skill-md/
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -H "X-Eval-Proxy-Token: $SKILL_EVAL_PROXY_TOKEN" \
  -F "file=@/tmp/no-skill-md.zip" \
  | tail -1 | grep -q "400" && echo "PASS: SKILL.md 校验" || echo "FAIL"
```

**自动化测试**：`tests/invariant-04-hard-validation.test.js`

---

## [BEHAVIOR] INV-05 — 代理令牌隔离（Invariant 5）

**描述**：直接访问 Brain 上传端点不带 X-Eval-Proxy-Token → HTTP 403。

**断言**：
- 无 Token → HTTP 403
- Token 错误 → HTTP 403
- 正确 Token → 进入业务逻辑

**manual:bash**：
```bash
# 不带 Token 直打 Brain
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -F "file=@/tmp/test.zip" \
  | grep -q "403" && echo "PASS: 无 Token → 403" || echo "FAIL"

# 带错误 Token
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -H "X-Eval-Proxy-Token: wrong-token" \
  -F "file=@/tmp/test.zip" \
  | grep -q "403" && echo "PASS: 错误 Token → 403" || echo "FAIL"
```

**自动化测试**：`tests/invariant-05-proxy-token.test.js`

---

## [BEHAVIOR] INV-06 — hash 去重（Invariant 6）

**描述**：同一 zip（SHA-256 相同）不重复建 task；合流返回历史结果。

**断言**：
- 命中 completed：HTTP 200，`status: duplicate`，`report_url` 与历史相同
- 命中 in_progress/pending：HTTP 200，`status: merged`，`task_id` 与历史相同
- 数据库 skill_eval_tasks 记录数不增加

**manual:bash**：
```bash
# 计算 zip hash
ZIP_FILE=~/incoming/日报skill-v1.2-7.7.zip
SHA256=$(sha256sum "$ZIP_FILE" | awk '{print $1}')
echo "SHA256: $SHA256"

# 查 DB 是否有该 hash 的历史记录
psql -U cecelia -d cecelia -c \
  "SELECT task_id, status, report_url FROM skill_eval_tasks WHERE zip_hash='$SHA256';"
```

**自动化测试**：`tests/invariant-06-hash-dedup.test.js`

---

## [BEHAVIOR] INV-07 — 报告 Basic Auth（Invariant 7）

**描述**：report_url 无 Basic Auth → HTTP 401；报告文件永久留存。

**断言**：
- `curl <report_url>` 不带 Auth → HTTP 401
- `curl -u user:pass <report_url>` → HTTP 200
- 报告 HTML 不在 staging 清理范围内（仅 zip 文件被清理）

**manual:bash**：
```bash
# 替换为实际 report_url
REPORT_URL="https://<hk-host>/skill-evals/<shortcode>-<slug>/report.html"

# 不带 Auth → 401
curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL" \
  | grep -q "401" && echo "PASS: 无 Auth → 401" || echo "FAIL"

# 带 Auth → 200
curl -s -o /dev/null -w "%{http_code}" -u "user:$EVAL_BASIC_PASS" "$REPORT_URL" \
  | grep -q "200" && echo "PASS: 有 Auth → 200" || echo "FAIL"

# 验证报告含关键词
curl -s -u "user:$EVAL_BASIC_PASS" "$REPORT_URL" | grep -q "功能地图" && echo "PASS: 含功能地图" || echo "FAIL"
curl -s -u "user:$EVAL_BASIC_PASS" "$REPORT_URL" | grep -q "裁决" && echo "PASS: 含裁决" || echo "FAIL"
```

**自动化测试**：`tests/invariant-07-report-auth.test.js`

---

## [BEHAVIOR] INV-08 — 超时强杀释放 slot（Invariant 8）

**描述**：评估超 SKILL_EVAL_TIMEOUT（30min）→ 强杀容器 → task=failed（reason: timeout）→ 释放 slot。

**断言**：
- 超时后 task status = `failed`，`failure_reason = "timeout"`
- running 计数恢复为 0（slot 释放）
- 飞书告警记录含超时事件
- 可接受新 task 进入 running 状态

**manual:bash**：
```bash
# 查找超时失败的任务
psql -U cecelia -d cecelia -c \
  "SELECT task_id, status, failure_reason, updated_at FROM skill_eval_tasks \
   WHERE failure_reason='timeout' ORDER BY updated_at DESC LIMIT 5;"

# 验证 slot 已释放（超时后 running 数应为 0）
psql -U cecelia -d cecelia -c \
  "SELECT COUNT(*) FROM skill_eval_tasks WHERE status='running';"
```

**自动化测试**：`tests/invariant-08-timeout-release.test.js`

---

## [BEHAVIOR] INV-09 — 全配置注入无硬编码（Invariant 9）

**描述**：所有可调参数来自环境变量，代码中不允许硬编码默认值以外的魔法数字。

**断言（代码审查）**：
- `grep -r "10 \* 1024 \* 1024\|10MB\|50MB\|2000\|1800\|86400" packages/brain/src/` 不应出现未引用环境变量的字面量
- 服务启动时打印配置摘要（可观测）
- 修改环境变量重启后行为改变

**manual:bash**：
```bash
# 验证 Brain 读取了正确的环境变量
curl -s http://localhost:5221/api/brain/config | jq '{
  MAX_ZIP_MB: .MAX_ZIP_MB,
  SKILL_EVAL_TIMEOUT: .SKILL_EVAL_TIMEOUT,
  MAX_CONCURRENT_SKILL_EVAL: .MAX_CONCURRENT_SKILL_EVAL,
  SKILL_EVAL_PENDING_LIMIT: .SKILL_EVAL_PENDING_LIMIT
}'

# 代码层面：确认无硬编码
grep -rn "30 \* 60\|1800\b" /workspace/packages/brain/src/ | grep -v "process\.env\|env\.\|config\." \
  && echo "FAIL: 发现硬编码" || echo "PASS: 无硬编码"
```

**自动化测试**：`tests/invariant-09-config-injection.test.js`

---

## [BEHAVIOR] INV-10 — 飞书告警聚合 & 连败升级（Invariant 10）

**描述**：同类告警 10min 内合并；连败 ≥ 3 次升级；webhook 失败 → 本地日志兜底。

**断言**：
- 10min 内触发 3 次相同类型告警 → 飞书只收到 1 条聚合消息
- 连续 3 次 task failed → 下一次告警有升级标记（`level: P0` 或 `@all`）
- 飞书 webhook URL 置空后触发告警 → `logs/feishu-fallback.jsonl` 有新记录

**manual:bash**：
```bash
# 查看飞书兜底日志
tail -20 /workspace/logs/feishu-fallback.jsonl 2>/dev/null | jq '.'

# 查连败计数器（Brain 内部状态）
curl -s http://localhost:5221/api/brain/alerts/state | jq '.skill_eval_consecutive_failures'

# 查聚合窗口内的待发告警
curl -s http://localhost:5221/api/brain/alerts/pending | jq '.skill_eval'
```

**自动化测试**：`tests/invariant-10-feishu-aggregation.test.js`

---

## [BEHAVIOR] FR-UPLOAD — 上传端点完整流程

**描述**：POST /api/brain/skill-evals/upload 端点按顺序：验 Token → 硬校验 → hash 去重 → 落 staging → 建 task → 返回 201。

**manual:bash**：
```bash
source ~/.credentials/skill-eval-proxy.env

# 正常上传
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST http://localhost:5221/api/brain/skill-evals/upload \
  -H "X-Eval-Proxy-Token: $SKILL_EVAL_PROXY_TOKEN" \
  -F "file=@~/incoming/日报skill-v1.2-7.7.zip" \
  -F "skill_name=日报skill" \
  -F "platform=zenithjoy" \
  -F "submitter=test")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)
echo "HTTP: $HTTP_CODE"
echo "Body: $BODY"
echo "$BODY" | jq -e '.task_id' && echo "PASS: 返回 task_id" || echo "FAIL"
[ "$HTTP_CODE" = "201" ] && echo "PASS: HTTP 201" || echo "FAIL: HTTP $HTTP_CODE"
```

---

## [BEHAVIOR] FR-STATUS — 状态轮询端点

**描述**：GET /api/brain/skill-evals/:task_id/status 返回 status/position/report_url。

**manual:bash**：
```bash
TASK_ID="<替换为实际 task_id>"

# 轮询状态（最多等 30min）
for i in $(seq 1 60); do
  RESP=$(curl -s http://localhost:5221/api/brain/skill-evals/$TASK_ID/status)
  STATUS=$(echo "$RESP" | jq -r '.status')
  echo "[$(date +%H:%M:%S)] status=$STATUS position=$(echo $RESP | jq -r '.position // "N/A"')"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo "Final: $RESP"
    break
  fi
  sleep 30
done
```

---

## E2E 验收（Final）

### 完整 E2E 验收命令序列

```bash
#!/bin/bash
set -euo pipefail

# 环境准备
source ~/.credentials/skill-eval-proxy.env
source ~/.credentials/hk-basic-auth.env  # EVAL_BASIC_USER, EVAL_BASIC_PASS
HK_HOST="<hk-vps-domain>"
BRAIN_HOST="localhost:5221"
ZIP_FILE=~/incoming/日报skill-v1.2-7.7.zip

echo "=== E2E 验收开始 ==="

# Step 1: 公网上传（经 HK Caddy + Basic Auth）
echo "--- Step 1: 上传 zip ---"
UPLOAD_RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "https://$HK_HOST/eval-api/upload" \
  -u "$EVAL_BASIC_USER:$EVAL_BASIC_PASS" \
  -F "file=@$ZIP_FILE" \
  -F "skill_name=日报skill" \
  -F "platform=zenithjoy")
HTTP_CODE=$(echo "$UPLOAD_RESP" | tail -1)
BODY=$(echo "$UPLOAD_RESP" | head -n -1)
[ "$HTTP_CODE" = "201" ] && echo "PASS: HTTP 201" || { echo "FAIL: HTTP $HTTP_CODE / $BODY"; exit 1; }
TASK_ID=$(echo "$BODY" | jq -r '.task_id')
echo "TASK_ID: $TASK_ID"

# Step 2: 轮询至 completed（≤30min）
echo "--- Step 2: 轮询评估状态 ---"
DEADLINE=$((SECONDS + 1800))
while [ $SECONDS -lt $DEADLINE ]; do
  STATUS_RESP=$(curl -s "https://$HK_HOST/eval-api/status/$TASK_ID" -u "$EVAL_BASIC_USER:$EVAL_BASIC_PASS")
  STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
  echo "[$(date +%H:%M:%S)] status=$STATUS"
  if [ "$STATUS" = "completed" ]; then
    REPORT_URL=$(echo "$STATUS_RESP" | jq -r '.report_url')
    echo "REPORT_URL: $REPORT_URL"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "FAIL: 评估失败 $(echo $STATUS_RESP | jq -r '.failure_reason')"; exit 1
  fi
  sleep 30
done
[ "$STATUS" = "completed" ] || { echo "FAIL: 超时未完成"; exit 1; }

# Step 3: 验证报告内容（带 Auth）
echo "--- Step 3: 验证报告内容 ---"
REPORT_BODY=$(curl -s -u "$EVAL_BASIC_USER:$EVAL_BASIC_PASS" "$REPORT_URL")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -u "$EVAL_BASIC_USER:$EVAL_BASIC_PASS" "$REPORT_URL")
[ "$HTTP_CODE" = "200" ] && echo "PASS: 报告 HTTP 200" || { echo "FAIL: HTTP $HTTP_CODE"; exit 1; }
echo "$REPORT_BODY" | grep -q "功能地图" && echo "PASS: 含'功能地图'" || { echo "FAIL: 缺'功能地图'"; exit 1; }
echo "$REPORT_BODY" | grep -q "裁决" && echo "PASS: 含'裁决'" || { echo "FAIL: 缺'裁决'"; exit 1; }

# Step 4: 不带 Auth → 401
echo "--- Step 4: 无 Auth 访问报告 → 401 ---"
curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL" \
  | grep -q "401" && echo "PASS: 无 Auth → 401" || { echo "FAIL: 应为 401"; exit 1; }

# Step 5: 无 Token 直打 Brain → 403
echo "--- Step 5: 无 Token 直打 Brain → 403 ---"
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://$BRAIN_HOST/api/brain/skill-evals/upload" \
  -F "file=@$ZIP_FILE" \
  | grep -q "403" && echo "PASS: 无 Token → 403" || { echo "FAIL: 应为 403"; exit 1; }

# Step 6: 评估索引页含该次评估条目
echo "--- Step 6: 验证索引页 ---"
curl -s -u "$EVAL_BASIC_USER:$EVAL_BASIC_PASS" "https://$HK_HOST/eval-api/index.html" \
  | grep -q "$TASK_ID" && echo "PASS: 索引页含 task_id" || { echo "FAIL: 索引页无此记录"; exit 1; }

echo "=== E2E 验收全部通过 ==="
```

---

## 铁律覆盖表

| Invariant | 编号 | 覆盖 [BEHAVIOR] | 状态 |
|-----------|------|-----------------|------|
| 单 slot 串行 | INV-01 | INV-01-single-slot | ✓ |
| 背压拒绝 | INV-02 | INV-02-backpressure | ✓ |
| 额度预检 | INV-03 | INV-03-quota-precheck | ✓ |
| 硬校验五件套 | INV-04 | INV-04-hard-validation | ✓ |
| 代理令牌隔离 | INV-05 | INV-05-proxy-token | ✓ |
| hash 去重 | INV-06 | INV-06-hash-dedup | ✓ |
| 报告 Basic Auth | INV-07 | INV-07-report-auth | ✓ |
| 超时释放 | INV-08 | INV-08-timeout-release | ✓ |
| 全配置注入 | INV-09 | INV-09-config-injection | ✓ |
| 飞书聚合 | INV-10 | INV-10-feishu-aggregation | ✓ |

**铁律覆盖：10/10**

---

## [BEHAVIOR] 条目汇总

1. INV-01 — 单 slot 串行
2. INV-02 — 背压拒绝
3. INV-03 — 额度预检拦截
4. INV-04 — 硬校验五件套
5. INV-05 — 代理令牌隔离
6. INV-06 — hash 去重
7. INV-07 — 报告 Basic Auth
8. INV-08 — 超时强杀释放 slot
9. INV-09 — 全配置注入无硬编码
10. INV-10 — 飞书告警聚合 & 连败升级
11. FR-UPLOAD — 上传端点完整流程
12. FR-STATUS — 状态轮询端点

**[BEHAVIOR] 条目总数：12**
