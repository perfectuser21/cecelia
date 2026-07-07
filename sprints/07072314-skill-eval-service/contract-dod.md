# Contract DoD — Skill Evaluator 内部验收台（thin 贯穿）

Sprint: 07072314-skill-eval-service
Task: 52145edd-e409-4459-9490-7a02bf8e87de
日期: 2026-07-07

---

## [BEHAVIOR] B01 — 令牌验证：无 X-Eval-Proxy-Token 直打上传端点返回 403

不携带 `X-Eval-Proxy-Token` 请求 Brain 上传端点时，系统必须返回 HTTP 403，不得处理任何 zip 数据，不得写入 staging，不得建立任何 task 记录。

```manual:bash
# 前置：Brain 运行在 localhost:5221
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@/tmp/test.zip" \
  http://localhost:5221/api/brain/skill-eval/upload)
[ "$HTTP_CODE" = "403" ] && echo "PASS: 403 returned" || (echo "FAIL: got $HTTP_CODE, expected 403" && exit 1)
```

---

## [BEHAVIOR] B02 — zip 硬校验：魔数 / 解压体积 / 压缩比 / 文件数 / 唯一 SKILL.md / 路径穿越

上传端点在令牌验证通过后，必须对 zip 执行以下全部硬校验，任一失败返回 400 并附错误说明，不写 staging，不建 task：

1. zip 魔数：文件头前 4 字节为 `50 4B 03 04`（PK\x03\x04）
2. 解压后总大小 ≤ MAX_UNZIP_MB（默认 50 MB）
3. 压缩比 ≤ MAX_COMPRESS_RATIO（默认 100:1）
4. zip 内文件数 ≤ MAX_ZIP_FILES（默认 2000）
5. 必须包含恰好 1 个 `SKILL.md`（大小写精确匹配，多个或零个均拒绝）
6. zip 内任意条目路径含 `../` 或以 `/` 开头（绝对路径）→ 拒绝整个 zip，不可只跳过该条目

```manual:bash
# 测试路径穿越拦截：构造含 ../evil.sh 的 zip
cd /tmp && mkdir -p test_zip_dir
echo "evil" > test_zip_dir/../evil.sh 2>/dev/null || true
python3 -c "
import zipfile
with zipfile.ZipFile('/tmp/traversal_test.zip', 'w') as z:
    z.writestr('../etc/passwd', 'traversal_payload')
    z.writestr('SKILL.md', '# skill')
"
TOKEN=$(grep EVAL_PROXY_TOKEN /workspace/.env 2>/dev/null | cut -d= -f2 || echo "\${EVAL_PROXY_TOKEN}")
HTTP_CODE=$(curl -s -o /tmp/resp.json -w "%{http_code}" \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@/tmp/traversal_test.zip" \
  -F "skill_name=test" \
  -F "source_platform=test" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  http://localhost:5221/api/brain/skill-eval/upload)
[ "$HTTP_CODE" = "400" ] && echo "PASS: path traversal rejected" || (echo "FAIL: got $HTTP_CODE" && cat /tmp/resp.json && exit 1)
```

---

## [BEHAVIOR] B03 — SHA-256 去重：同包三态行为

同一 zip（SHA-256 相同）上传时，系统按 task 状态返回不同结果，不重复调度：

- task status = completed → 返回 `{"task_id": "<已有>", "report_url": "<历史URL>", "deduplicated": true}`，HTTP 200
- task status = pending/running → 返回 `{"task_id": "<已有>", "status": "pending|running"}`, HTTP 200，不建新 task
- 首次上传（DB 无记录）→ 建新 task，返回 `{"task_id": "<新>", "status": "pending"}`，HTTP 201

```manual:bash
# 构造合法 zip（含 SKILL.md）
python3 -c "
import zipfile
with zipfile.ZipFile('/tmp/dedup_test.zip', 'w') as z:
    z.writestr('SKILL.md', '# Test Skill\n\nThis is a test skill.')
    z.writestr('main.py', 'print(\"hello\")')
"
TOKEN=$(node -e "require('dotenv').config({path:'/workspace/.env'}); console.log(process.env.EVAL_PROXY_TOKEN || 'test-token')" 2>/dev/null || echo "test-token")

# 第一次上传
R1=$(curl -s -w "\n%{http_code}" \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@/tmp/dedup_test.zip" \
  -F "skill_name=dedup-test" \
  -F "source_platform=Claude" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  http://localhost:5221/api/brain/skill-eval/upload)
echo "First upload: $R1"

# 第二次上传同一 zip，状态应为 pending → 返回同一 task_id，不建新 task
R2=$(curl -s -w "\n%{http_code}" \
  -H "X-Eval-Proxy-Token: $TOKEN" \
  -F "file=@/tmp/dedup_test.zip" \
  -F "skill_name=dedup-test" \
  -F "source_platform=Claude" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  http://localhost:5221/api/brain/skill-eval/upload)
echo "Second upload (dedup): $R2"
TASK_ID_1=$(echo "$R1" | head -1 | python3 -c "import json,sys; print(json.load(sys.stdin).get('task_id',''))")
TASK_ID_2=$(echo "$R2" | head -1 | python3 -c "import json,sys; print(json.load(sys.stdin).get('task_id',''))")
[ "$TASK_ID_1" = "$TASK_ID_2" ] && echo "PASS: same task_id returned" || (echo "FAIL: different task_ids" && exit 1)
```

---

## [BEHAVIOR] B04 — 单 slot 串行调度（MAX_CONCURRENT_SKILL_EVAL=1）

同一时刻最多 1 个 skill_eval task 处于 running 状态。tick 派发前必须查询 DB running 数量；若已有 running 任务则跳过派发（不报错，等下次 tick）。slot 释放必须在 completed 和 failed 两条路径都执行（含异常退出）。

```manual:bash
# 验证 DB 中 running 的 skill_eval tasks 不超过 1
DB_URL=$(grep DATABASE_URL /workspace/.env 2>/dev/null | cut -d= -f2 || echo "postgresql://postgres:postgres@localhost:5432/cecelia")
RUNNING_COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM tasks WHERE task_type='skill_eval' AND status='running';" | tr -d ' ')
[ "$RUNNING_COUNT" -le "1" ] && echo "PASS: running count=$RUNNING_COUNT" || (echo "FAIL: running count=$RUNNING_COUNT > 1" && exit 1)
```

---

## [BEHAVIOR] B05 — 额度预检：5h 池 ≥85% AND 7d 池 ≥90% 才派发

tick 在派发 skill_eval task 前，必须检查 account2 的额度水位。当 5h 池余量 < 85% 或 7d 池余量 < 90% 时，task 保持 pending 状态，发飞书告警，不派发。

```manual:bash
# 验证：额度预检逻辑存在于 dispatcher.js 中
grep -q "QUOTA_5H_MIN_PCT\|5h.*pool\|quota.*check\|accountQuota" \
  /workspace/packages/brain/src/skill-eval/dispatcher.js \
  && echo "PASS: quota check code found" \
  || (echo "FAIL: quota check not found in dispatcher.js" && exit 1)

# 验证环境变量可配置（不 hardcode）
grep -qE "process\.env\.(QUOTA_5H_MIN_PCT|SKILL_EVAL_QUOTA_5H|EVAL_QUOTA)" \
  /workspace/packages/brain/src/skill-eval/dispatcher.js \
  && echo "PASS: env-var driven" \
  || (echo "FAIL: quota threshold may be hardcoded" && exit 1)
```

---

## [BEHAVIOR] B06 — 背压：pending ≥20 时拒绝新提交

当 pending 状态的 skill_eval task 数量 ≥ MAX_SKILL_EVAL_QUEUE（默认 20）时，上传端点返回 HTTP 429，body 包含 `queue_full` 字段，不写 staging，不建 task。

```manual:bash
# 验证背压逻辑存在
grep -qE "queue.*full|MAX_SKILL_EVAL_QUEUE|pending.*>=|429" \
  /workspace/packages/brain/src/skill-eval/upload-handler.js \
  && echo "PASS: backpressure code found" \
  || (echo "FAIL: backpressure logic not found" && exit 1)
```

---

## [BEHAVIOR] B07 — evals 表落库：每次评估（含失败）写入一行

每次 skill_eval 任务结束（completed 或任意 failed 状态），必须在 evals 表写入一行，包含 task_id / skill_name / status / report_url / duration_ms / created_at。不允许用内存统计替代。

```manual:bash
DB_URL=$(grep DATABASE_URL /workspace/.env 2>/dev/null | cut -d= -f2 || echo "postgresql://postgres:postgres@localhost:5432/cecelia")
# 验证 evals 表存在且有正确列
psql "$DB_URL" -c "\d evals" 2>&1 | grep -E "task_id|skill_name|status|report_url|duration_ms" \
  && echo "PASS: evals table schema correct" \
  || (echo "FAIL: evals table missing or schema wrong" && exit 1)
```

---

## [BEHAVIOR] B08 — 报告保护：不带 Basic Auth 访问 report_url 返回 401

发布到 HK 的评估报告 URL，不携带 Basic Auth 凭据时必须返回 HTTP 401。报告页面本身不包含 Basic Auth 凭据在 URL 中。

```manual:bash
# 此项在 Final E2E 中验证（需真实 report_url）
# 本地预检：验证 nginx 配置包含 auth_basic 指令
ssh hk-vps "grep -A5 'skill-evals' /etc/nginx/conf.d/zj-docs.conf | grep -q 'auth_basic'" \
  && echo "PASS: auth_basic configured" \
  || (echo "FAIL: no auth_basic for skill-evals" && exit 1)
```

---

## [BEHAVIOR] B09 — 状态查询端点正确返回 status / queue_position / report_url

GET `/api/brain/skill-eval/status/:task_id` 对已存在 task 返回 `{status, queue_position, report_url}`；对不存在 task_id 返回 404。

```manual:bash
# 查询不存在的 task_id 必须 404
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:5221/api/brain/skill-eval/status/00000000-0000-0000-0000-000000000000)
[ "$HTTP_CODE" = "404" ] && echo "PASS: 404 for unknown task_id" || (echo "FAIL: got $HTTP_CODE" && exit 1)
```

---

## [BEHAVIOR] B10 — 索引页追加：评估完成后条目出现在 /skill-evals/index.html

每次评估完成后，HK `/data/docs/skill-evals/index.html` 必须新增本次评估条目，包含 task_id、skill_name、完成时间、报告链接。最新 50 条可见。

```manual:bash
# 在 Final E2E 后验证
# 前置：已完成一次评估，$TASK_ID 已设置
ssh hk-vps "grep -q '$TASK_ID' /data/docs/skill-evals/index.html" \
  && echo "PASS: task found in index" \
  || (echo "FAIL: task_id missing from index.html" && exit 1)
```

---

## Final E2E（完整链路验收）

> 此脚本为全链路真实验收，依赖 ~/incoming/日报skill-v1.2-7.7.zip 存在 + 1Password 凭据。

```manual:bash
#!/usr/bin/env bash
# Final E2E — Skill Evaluator thin 贯穿
# target_environment: local_api（Brain API + 真实 HK 公网链路）
# 前置：~/incoming/日报skill-v1.2-7.7.zip 存在
set -euo pipefail

source ~/.credentials/sync-credentials.sh 2>/dev/null || true
source ~/.credentials/zenjoymedia-docs.env 2>/dev/null || true

DOCS_URL="https://docs.zenjoymedia.media"
BASIC_AUTH="${DOCS_BASIC_AUTH:-$(op item get 'ZenithJoy Docs Basic Auth' --vault CS --field password 2>/dev/null || echo 'missing')}"
ZIP_PATH="$HOME/incoming/日报skill-v1.2-7.7.zip"

[ -f "$ZIP_PATH" ] || (echo "FAIL: zip not found at $ZIP_PATH" && exit 1)

# Step 1: 上传（走公网 Basic Auth）
echo "[1/6] Uploading zip via public endpoint..."
RESPONSE=$(curl -sf -u "$BASIC_AUTH" \
  -F "file=@$ZIP_PATH" \
  -F "skill_name=日报Skill-v1.2" \
  -F "source_platform=Claude" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  "$DOCS_URL/eval-api/upload")
TASK_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])")
echo "task_id: $TASK_ID"

# Step 2: 轮询至 completed（≤30min）
echo "[2/6] Polling for completion (max 30min)..."
STATUS="pending"
for i in $(seq 1 360); do
  STATUS_JSON=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/eval-api/status/$TASK_ID")
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
  echo "  tick $i: $STATUS"
  if [ "$STATUS" = "completed" ]; then
    REPORT_URL=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['report_url'])")
    break
  fi
  if echo "$STATUS" | grep -q "failed"; then
    echo "FAIL: task failed with status $STATUS"
    exit 1
  fi
  sleep 5
done
[ "$STATUS" = "completed" ] || (echo "FAIL: timeout after 30min, status=$STATUS" && exit 1)
echo "report_url: $REPORT_URL"

# Step 3: 报告内容断言（带 Basic Auth）
echo "[3/6] Asserting report content..."
REPORT_BODY=$(curl -sf -u "$BASIC_AUTH" "$REPORT_URL")
echo "$REPORT_BODY" | grep -q "功能地图" || (echo "FAIL: 功能地图 missing in report" && exit 1)
echo "$REPORT_BODY" | grep -q "裁决" || (echo "FAIL: 裁决 missing in report" && exit 1)
echo "  PASS: report content verified"

# Step 4: 不带 Basic Auth 必须 401（报告保护）
echo "[4/6] Verifying report protection (no-auth → 401)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL")
[ "$HTTP_CODE" = "401" ] || (echo "FAIL: report not protected, got $HTTP_CODE" && exit 1)
echo "  PASS: 401 without auth"

# Step 5: 不带令牌直打 Brain 上传端点必须 403
echo "[5/6] Verifying Brain token enforcement (no-token → 403)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@$ZIP_PATH" \
  "http://localhost:5221/api/brain/skill-eval/upload")
[ "$HTTP_CODE" = "403" ] || (echo "FAIL: Brain upload not token-protected, got $HTTP_CODE" && exit 1)
echo "  PASS: 403 without token"

# Step 6: 评估索引页含本次 task_id 条目
echo "[6/6] Verifying index page contains task entry..."
INDEX_BODY=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/skill-evals/")
echo "$INDEX_BODY" | grep -q "$TASK_ID" || (echo "FAIL: index.html missing task_id=$TASK_ID" && exit 1)
echo "  PASS: task found in index"

echo ""
echo "=== ALL ASSERTIONS PASSED ==="
echo "task_id:    $TASK_ID"
echo "report_url: $REPORT_URL"
```

---

## DoD 检查清单

- [ ] B01: 无 token → 403
- [ ] B02: zip 硬校验（魔数 / 大小 / 压缩比 / 文件数 / SKILL.md / 路径穿越）
- [ ] B03: SHA-256 去重三态正确
- [ ] B04: 单 slot 串行保证（DB running ≤ 1）
- [ ] B05: 额度预检（5h ≥85% AND 7d ≥90%）
- [ ] B06: 背压（pending ≥20 → 429）
- [ ] B07: evals 表每次落库
- [ ] B08: 报告 401 保护
- [ ] B09: 状态查询端点正确（含 404）
- [ ] B10: 索引页追加条目
- [ ] Final E2E: 真实 zip 上传全链路通过
- [ ] Brain unit tests: upload-handler / dispatcher / publisher 全绿
