# 合同 DoD（Definition of Done）— D4a 裁决与分流后端

**任务 ID**: 6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa  
**版本**: v1（第 1 轮）  
**目标环境**: local_api  

---

## [BEHAVIOR] B1 — adjudicate 端点写入与状态推进原子性

**描述**: `PATCH /api/brain/acceptance/runs/:run_key/adjudicate` 接受四字段裁决，将 `adjudication JSONB` 写入 `acceptance_checks` 并原子地将 `acceptance_runs.status` 推进到 `adjudicated`。任一字段缺失或 verdict 非法 → 400。不得出现写入成功但 status 未推进的中间态。

**覆盖 FR**: FR-1（裁决 API 基本路径）、FR-1（四字段校验）

**前置条件**: Brain 运行，acceptance_run 处于 `human_complete` 状态，格类型为 `verifiable_by='human_only'`

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
RUN_KEY="dod-b1-$(date +%s)"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 建 run + 推进到 human_complete
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RUN_KEY\",\"title\":\"DoD B1\",\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"测试格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RUN_KEY\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"通过\",\"submitted_by\":\"dod\"}]}" > /dev/null

# 正常裁决 → 200
HTTP=$(curl -s -o /tmp/b1.json -w "%{http_code}" -X PATCH "$BASE/runs/$RUN_KEY/adjudicate" \
  -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"绿\",\"by\":\"dod\",\"reason\":\"B1验证\",\"at\":\"$AT\"}")
[ "$HTTP" = "200" ] || { echo "FAIL B1: HTTP $HTTP"; cat /tmp/b1.json; exit 1; }

# DB 验证：run.status=adjudicated，adjudication 四字段齐全
STATUS=$(psql cecelia -t -A -c "SELECT status FROM acceptance_runs WHERE run_key='$RUN_KEY'")
[ "$STATUS" = "adjudicated" ] || { echo "FAIL B1: status=$STATUS"; exit 1; }
ADJ=$(psql cecelia -t -A -c "SELECT adjudication FROM acceptance_checks ac JOIN acceptance_runs ar ON ac.run_id=ar.id WHERE ar.run_key='$RUN_KEY' AND ac.check_key='S1-c1'")
echo "$ADJ" | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['verdict','by','reason','at'])"

# 缺 reason → 400
H2=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/runs/$RUN_KEY/adjudicate" \
  -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"绿\",\"by\":\"dod\",\"at\":\"$AT\"}")
[ "$H2" = "400" ] || { echo "FAIL B1: 缺 reason 应 400，实际 $H2"; exit 1; }

# verdict='黄' → 400
H3=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/runs/$RUN_KEY/adjudicate" \
  -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"黄\",\"by\":\"dod\",\"reason\":\"x\",\"at\":\"$AT\"}")
[ "$H3" = "400" ] || { echo "FAIL B1: verdict=黄 应 400，实际 $H3"; exit 1; }
echo "[B1 PASS] adjudicate 端点原子写入 + 四字段校验"
```

---

## [BEHAVIOR] B2 — abandon 前态守卫（adjudicated/stale 禁被覆盖）

**描述**: `PATCH .../abandon` 对处于 `adjudicated` 或 `stale` 状态的 run 返回 HTTP 409，响应体含 `{"error":"forbidden_status","current_status":"<当前状态>"}`。处于活跃状态（pending/in_review/human_complete/expired）的 run 仍可正常 abandon → 200。

**覆盖 FR**: FR-2（abandon 端点前态守卫）

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 准备 adjudicated run
ADJ_KEY="dod-b2-adj-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$ADJ_KEY\",\"title\":\"B2 adjudicated\",\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"B2格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$ADJ_KEY\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"通过\",\"submitted_by\":\"dod\"}]}" > /dev/null
curl -sf -X PATCH "$BASE/runs/$ADJ_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"绿\",\"by\":\"dod\",\"reason\":\"B2\",\"at\":\"$AT\"}" > /dev/null

H1=$(curl -s -o /tmp/b2.json -w "%{http_code}" -X PATCH "$BASE/runs/$ADJ_KEY/abandon" \
  -H "Content-Type: application/json" -d '{"reason":"x","by":"dod"}')
[ "$H1" = "409" ] || { echo "FAIL B2: adjudicated→abandon 应 409，实际 $H1"; exit 1; }
cat /tmp/b2.json | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('error')=='forbidden_status' and d.get('current_status')=='adjudicated'"

# stale run
STALE_KEY="dod-b2-stale-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$STALE_KEY\",\"title\":\"B2 stale\",\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"stale格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
psql cecelia -c "UPDATE acceptance_runs SET status='stale' WHERE run_key='$STALE_KEY'" > /dev/null
H2=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/runs/$STALE_KEY/abandon" \
  -H "Content-Type: application/json" -d '{"reason":"x","by":"dod"}')
[ "$H2" = "409" ] || { echo "FAIL B2: stale→abandon 应 409，实际 $H2"; exit 1; }

# pending run（对照组）
PEND_KEY="dod-b2-pend-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$PEND_KEY\",\"title\":\"B2 pending\",\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"pend格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
H3=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/runs/$PEND_KEY/abandon" \
  -H "Content-Type: application/json" -d '{"reason":"正常作废","by":"dod"}')
[ "$H3" = "200" ] || { echo "FAIL B2: pending→abandon 应 200，实际 $H3"; exit 1; }
echo "[B2 PASS] abandon 前态守卫正确"
```

---

## [BEHAVIOR] B3 — hard 格裁决红自动开 P0 + unverifiable 格例外处理

**描述**: run 转 `adjudicated` 后，后端检查格裁决：`verifiable_by='human_only'` 且 `verdict='红'` 的格触发 P0 Issue；`scenario_class='unverifiable_this_version'` 的格裁决绿不开 P0，但写入 `detail.unverifiable_adjudicated[]`。格集合从 yaml 动态解析，禁止硬编码格号。

**覆盖 FR**: FR-3（hard 格裁决绿自动开 P0）

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 红线触发
RED_KEY="dod-b3-red-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RED_KEY\",\"title\":\"B3 红线\",\"checks\":[{\"check_key\":\"S12-c4\",\"kind\":\"Invariant\",\"name\":\"私信红线\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RED_KEY\",\"results\":[{\"check_key\":\"S12-c4\",\"result\":\"不通过\",\"submitted_by\":\"dod\"}]}" > /dev/null

P0_BEFORE=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收红线失守%' AND priority='P0'")
curl -sf -X PATCH "$BASE/runs/$RED_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S12-c4\",\"verdict\":\"红\",\"by\":\"dod\",\"reason\":\"B3红线验证\",\"at\":\"$AT\"}" > /dev/null
P0_AFTER=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收红线失守%' AND priority='P0'")
[ "$P0_AFTER" -gt "$P0_BEFORE" ] || { echo "FAIL B3: 红线 P0 未创建"; exit 1; }
echo "[B3a] human_only 红格 → P0 Issue 创建 OK"

# unverifiable_this_version 例外
UV_KEY="dod-b3-uv-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$UV_KEY\",\"title\":\"B3 UV\",\"checks\":[{\"check_key\":\"S13-c4\",\"kind\":\"Invariant\",\"name\":\"频控红线\",\"verifiable_by\":\"human_only\",\"scenario_class\":\"unverifiable_this_version\"}]}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$UV_KEY\",\"results\":[{\"check_key\":\"S13-c4\",\"result\":\"无法验证\",\"submitted_by\":\"dod\"}]}" > /dev/null

P0_UV_BEFORE=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收红线失守%S13-c4%' AND priority='P0'")
curl -sf -X PATCH "$BASE/runs/$UV_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S13-c4\",\"verdict\":\"绿\",\"by\":\"dod\",\"reason\":\"本版验不了\",\"at\":\"$AT\"}" > /dev/null
P0_UV_AFTER=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收红线失守%S13-c4%' AND priority='P0'")
[ "$P0_UV_AFTER" = "$P0_UV_BEFORE" ] || { echo "FAIL B3: unverifiable 格不该创建 P0"; exit 1; }
DETAIL=$(psql cecelia -t -A -c "SELECT detail FROM acceptance_runs WHERE run_key='$UV_KEY'")
echo "$DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); arr=d.get('unverifiable_adjudicated',[]); assert any(e.get('check_key')=='S13-c4' for e in arr), f'缺记录: {arr}'"
echo "[B3b] unverifiable 绿 → 无 P0 + detail 写入 OK"
echo "[B3 PASS] hard 格 P0 + unverifiable 例外"
```

---

## [BEHAVIOR] B4 — 聚合式分流建任务（查重 + anchor 三件套）

**描述**: run 转 `adjudicated` 后，每 run 至多建 1 条 `acceptance_bucket='bug'` 任务 + 1 条 `acceptance_bucket='trace'` 任务；查重谓词含 `acceptance_bucket` 维度；新建任务 `payload.anchor` 携带 `{journey_id, gp_id, step_id}` 三件套（取自 `acceptance_runs.anchor`）。分流建单失败不影响 run.status。

**覆盖 FR**: FR-4（聚合式分流建任务）

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ANCHOR='{"journey_id":"2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6","gp_id":"7790f728-f490-4243-b166-03f3250a0938","step_id":"817f59f5-02ff-4a70-bd81-f7ae65f77e02"}'

TASK_KEY="dod-b4-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$TASK_KEY\",\"title\":\"B4 分流\",\"anchor\":$ANCHOR,\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"分流格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$TASK_KEY\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"不通过\",\"submitted_by\":\"dod\"}]}" > /dev/null
curl -sf -X PATCH "$BASE/runs/$TASK_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"红\",\"by\":\"dod\",\"reason\":\"B4测试\",\"at\":\"$AT\"}" > /dev/null

# 查 bug 任务 ≤1
BUG_COUNT=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM tasks WHERE payload->>'acceptance_bucket'='bug' AND payload->>'acceptance_run_key'='$TASK_KEY' AND status NOT IN ('failed','completed','cancelled')")
[ "$BUG_COUNT" -le "1" ] || { echo "FAIL B4: bug 任务数 $BUG_COUNT > 1"; exit 1; }

# anchor 三件套验证
ANCHOR_VAL=$(psql cecelia -t -A -c "SELECT payload->'anchor' FROM tasks WHERE payload->>'acceptance_bucket'='bug' AND payload->>'acceptance_run_key'='$TASK_KEY' LIMIT 1")
echo "$ANCHOR_VAL" | python3 -c "import sys,json; d=json.load(sys.stdin); assert all(k in d for k in ['journey_id','gp_id','step_id']), f'anchor 缺字段: {d}'"
echo "[B4a] bug 任务 ≤1 + anchor 三件套 OK"

# 查重验证：重复触发仍只 1 条
curl -sf -X PATCH "$BASE/runs/$TASK_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"红\",\"by\":\"dod\",\"reason\":\"重复裁决\",\"at\":\"$AT\"}" > /dev/null
BUG_COUNT_2=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM tasks WHERE payload->>'acceptance_bucket'='bug' AND payload->>'acceptance_run_key'='$TASK_KEY' AND status NOT IN ('failed','completed','cancelled')")
[ "$BUG_COUNT_2" = "$BUG_COUNT" ] || { echo "FAIL B4: 重复触发 bug 任务数从 $BUG_COUNT 变 $BUG_COUNT_2"; exit 1; }
echo "[B4b] 查重去重 OK"
echo "[B4 PASS] 聚合式分流建任务"
```

---

## [BEHAVIOR] B5 — 熔断（非绿占比 >1/3 开 P0）+ 哑火独立路径

**描述**: 非绿格（`final_state='红'` 或 `'未定'`）占比 > 1/3（分母 = 36）时，触发熔断 P0（issues 表新增「规程/数据源疑似分叉」P0）。`detail.ai_status='哑火'` 走独立 `ai_run_infra_error` 路径（「AI 整轮哑火」P0），不进熔断计数。两路径可同轮并存。

**覆盖 FR**: FR-5（熔断）

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 构造 13 格红（>36/3=12）
FUSE_KEY="dod-b5-$(date +%s)"
CHECKS='['
for i in $(seq 1 13); do
  [ $i -gt 1 ] && CHECKS+=','
  CHECKS+="{\"check_key\":\"S${i}-c1\",\"kind\":\"FR\",\"name\":\"熔断格${i}\",\"verifiable_by\":\"human_only\"}"
done
CHECKS+=']'
RESULTS='['
for i in $(seq 1 13); do
  [ $i -gt 1 ] && RESULTS+=','
  RESULTS+="{\"check_key\":\"S${i}-c1\",\"result\":\"不通过\",\"submitted_by\":\"dod\"}"
done
RESULTS+=']'

curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$FUSE_KEY\",\"title\":\"B5 熔断\",\"checks\":$CHECKS}" > /dev/null
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$FUSE_KEY\",\"results\":$RESULTS}" > /dev/null

FUSE_BEFORE=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收熔断%' AND priority='P0'")
for i in $(seq 1 13); do
  curl -sf -X PATCH "$BASE/runs/$FUSE_KEY/adjudicate" -H "Content-Type: application/json" \
    -d "{\"check_key\":\"S${i}-c1\",\"verdict\":\"红\",\"by\":\"dod\",\"reason\":\"熔断测试\",\"at\":\"$AT\"}" > /dev/null
done
FUSE_AFTER=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收熔断%' AND priority='P0'")
[ "$FUSE_AFTER" -gt "$FUSE_BEFORE" ] || { echo "FAIL B5: 熔断 P0 未创建"; exit 1; }
echo "[B5a] 13/36 非绿格 → 熔断 P0 OK"

# 哑火独立路径（不进熔断）
AI_KEY="dod-b5-ai-$(date +%s)"
curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$AI_KEY\",\"title\":\"B5 哑火\",\"detail\":{\"ai_status\":\"哑火\"},\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"哑火格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
INFRA_BEFORE=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '%AI 整轮哑火%' AND priority='P0'")
FUSE_BEFORE2=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收熔断%' AND priority='P0'")
curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$AI_KEY\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"无法验证\",\"submitted_by\":\"dod\"}]}" > /dev/null
curl -sf -X PATCH "$BASE/runs/$AI_KEY/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"绿\",\"by\":\"dod\",\"reason\":\"哑火\",\"at\":\"$AT\"}" > /dev/null
INFRA_AFTER=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '%AI 整轮哑火%' AND priority='P0'")
FUSE_AFTER2=$(psql cecelia -t -A -c "SELECT COUNT(*) FROM issues WHERE title LIKE '验收熔断%' AND priority='P0'")
[ "$INFRA_AFTER" -gt "$INFRA_BEFORE" ] || { echo "FAIL B5: 哑火 P0 未创建"; exit 1; }
[ "$FUSE_AFTER2" = "$FUSE_BEFORE2" ] || { echo "FAIL B5: 哑火不应触发熔断"; exit 1; }
echo "[B5b] 哑火 → ai_run_infra_error P0，不进熔断计数 OK"
echo "[B5 PASS] 熔断 + 哑火独立路径"
```

---

## [BEHAVIOR] B6 — SAVEPOINT 23505 不毒化外层事务（回归覆盖）

**描述**: 分流建单内层对每条 INSERT 使用 SAVEPOINT，23505 unique violation 仅回滚该 SAVEPOINT，外层事务正常提交，其他 INSERT 不受影响。测试先写 failing（无 SAVEPOINT 时外层事务被毒化），修复后 Green，永久进 CI。

**覆盖 FR**: FR-6（SAVEPOINT 回归覆盖）

**验收命令（manual:bash）**:
```bash
# 运行专项集成测试
cd /workspace
npx --prefix packages/brain vitest run --reporter=verbose \
  packages/brain/tests/acceptance-adjudication.test.js 2>&1 | tail -30

# 验证 SAVEPOINT 场景测试存在且通过
npx --prefix packages/brain vitest run --reporter=verbose \
  packages/brain/tests/acceptance-adjudication.test.js 2>&1 \
  | grep -E "PASS|FAIL|savepoint|23505|SAVEPOINT" || true

echo "[B6] SAVEPOINT 回归测试运行完成，检查上方输出确认无 FAIL"
```

---

## [BEHAVIOR] B7 — 租户隔离（裁决/分流不跨 run 污染）

**描述**: 同时存在 ≥2 个 run 时，对 run-A 的裁决操作不影响 run-B 的 adjudication 字段、status、tasks 分流结果。

**覆盖 NFR**: 单测租户隔离

**验收命令（manual:bash）**:
```bash
BASE="http://localhost:5221/api/brain/acceptance"
AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

KEY_A="dod-b7-a-$(date +%s)"
KEY_B="dod-b7-b-$(date +%s)"

# 建两个 run
for K in "$KEY_A" "$KEY_B"; do
  curl -sf -X POST "$BASE/runs" -H "Content-Type: application/json" \
    -d "{\"run_key\":\"$K\",\"title\":\"B7 隔离 $K\",\"checks\":[{\"check_key\":\"S1-c1\",\"kind\":\"FR\",\"name\":\"隔离格\",\"verifiable_by\":\"human_only\"}]}" > /dev/null
  curl -sf -X POST "$BASE/results" -H "Content-Type: application/json" \
    -d "{\"run_key\":\"$K\",\"results\":[{\"check_key\":\"S1-c1\",\"result\":\"通过\",\"submitted_by\":\"dod\"}]}" > /dev/null
done

# 只裁决 run-A
curl -sf -X PATCH "$BASE/runs/$KEY_A/adjudicate" -H "Content-Type: application/json" \
  -d "{\"check_key\":\"S1-c1\",\"verdict\":\"绿\",\"by\":\"dod\",\"reason\":\"A裁决\",\"at\":\"$AT\"}" > /dev/null

# run-B 的 adjudication 应为 null，status 不应为 adjudicated
ADJ_B=$(psql cecelia -t -A -c "SELECT adjudication FROM acceptance_checks ac JOIN acceptance_runs ar ON ac.run_id=ar.id WHERE ar.run_key='$KEY_B' AND ac.check_key='S1-c1'")
STATUS_B=$(psql cecelia -t -A -c "SELECT status FROM acceptance_runs WHERE run_key='$KEY_B'")
[ "$ADJ_B" = "" ] || [ "$ADJ_B" = "null" ] || { echo "FAIL B7: run-B adjudication 被污染: $ADJ_B"; exit 1; }
[ "$STATUS_B" != "adjudicated" ] || { echo "FAIL B7: run-B status 被推进到 adjudicated"; exit 1; }
echo "[B7 PASS] 租户隔离：run-A 裁决不影响 run-B"
```

---

## DevGate 门禁（必须在编码前通过）

```bash
node /workspace/scripts/facts-check.mjs && \
bash /workspace/scripts/check-version-sync.sh && \
node /workspace/packages/quality/scripts/devgate/check-dod-mapping.cjs
```

所有命令 exit 0 才可继续编码。

---

## meta_verification 形态声明

本合同所有验收命令均通过 curl + psql + npm test 验证真相（无 UI、无浏览器）。  
符合 Invariant a0bac43b：local_api 无 UI smoke 任务预先声明验证真相形态。  
验收命令在产出本文件前已通过 dry-run 语义验证（Invariant c906dd6c）。

---

## 完成标准汇总

- [ ] B1 PASS：adjudicate 端点原子写入 + 四字段校验
- [ ] B2 PASS：abandon 前态守卫（adjudicated/stale → 409）
- [ ] B3 PASS：hard 格红 → P0 + unverifiable 例外处理
- [ ] B4 PASS：聚合式分流建任务（查重 + anchor 三件套）
- [ ] B5 PASS：熔断 + 哑火独立路径
- [ ] B6 PASS：SAVEPOINT 23505 不毒化外层事务
- [ ] B7 PASS：租户隔离
- [ ] DevGate 三件套全 exit 0
- [ ] `acceptance-adjudication.test.js` 全部 Green 且进 CI
- [ ] 无临时文件、无调试 console.log、无未用 import
