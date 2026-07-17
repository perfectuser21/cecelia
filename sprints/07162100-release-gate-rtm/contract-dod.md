# Contract DoD — 建制W8: 发布准入查账脚本（RTM Release Gate）

## 元数据

- task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
- sprint_dir: sprints/07162100-release-gate-rtm
- dod_version: v1
- created: 2026-07-17

---

## BEHAVIOR 条目

### [BEHAVIOR] BEHAVIOR-01: 接缝步实际等级 < L3 → exit 1 + 缺口清单

**来源**：INV-02，FR02，铁律第2条

**断言**：
- 给定含接缝步 L1 的 RTM fixture
- 运行 `node scripts/release-gate.mjs --rtm <fixture>`
- exit code **必须** = 1
- stdout **必须** 含 `[BLOCKED]` 字样
- stdout **必须** 含步骤号（如 `S1`）
- stdout **禁止** 含 `[PASS]`
- decisions 表**禁止**写入任何记录（无副作用）

**验收命令**：
manual:bash
```bash
OUTPUT=$(node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-with-gaps.md 2>&1); \
EXIT=$?; \
[ $EXIT -eq 1 ] && echo "✓ exit 1" || echo "✗ exit $EXIT"; \
echo "$OUTPUT" | grep -q "\[BLOCKED\]" && echo "✓ [BLOCKED] found" || echo "✗ [BLOCKED] missing"; \
echo "$OUTPUT" | grep -q "S1" && echo "✓ S1 found" || echo "✗ S1 missing"
```

---

### [BEHAVIOR] BEHAVIOR-02: RTM 缺失 → exit 2，禁默认放行

**来源**：INV-04，FR04，铁律第4条

**断言**：
- 运行 `node scripts/release-gate.mjs --path nonexistent-path-xyz`
- exit code **必须** = 2（不得为 0 或 1）
- stdout **必须** 含 `[NO_RTM]`
- stdout **禁止** 含 `[PASS]`
- decisions 表**禁止**写入任何记录

**验收命令**：
manual:bash
```bash
OUTPUT=$(node scripts/release-gate.mjs --path nonexistent-path-xyz-$(date +%s) 2>&1); \
EXIT=$?; \
[ $EXIT -eq 2 ] && echo "✓ exit 2" || echo "✗ exit $EXIT"; \
echo "$OUTPUT" | grep -q "\[NO_RTM\]" && echo "✓ [NO_RTM] found" || echo "✗ [NO_RTM] missing"; \
echo "$OUTPUT" | grep -q "\[PASS\]" && echo "✓ no [PASS] (correct)" || echo "✗ [PASS] found (wrong)"
```

---

### [BEHAVIOR] BEHAVIOR-03: 全达标 → exit 0 + 写 decisions 判定记录

**来源**：INV-01，INV-06，FR03，FR05，铁律第5条

**断言**：
- 给定全达标 RTM fixture（所有接缝步实际 L3，无非预期 L0）
- 运行 `node scripts/release-gate.mjs --rtm <fixture>`
- exit code **必须** = 0
- stdout **必须** 含 `[PASS]`
- decisions 表**必须**写入记录，字段要求：
  - `category = 'release-gate'`
  - `verdict = 'PASS'`
  - `path_id` 非空
  - `written_at` 为有效 ISO8601 时间戳

**验收命令（需 Brain API 运行）**：
manual:bash
```bash
OUTPUT=$(node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-all-pass.md 2>&1); \
EXIT=$?; \
[ $EXIT -eq 0 ] && echo "✓ exit 0" || echo "✗ exit $EXIT"; \
echo "$OUTPUT" | grep -q "\[PASS\]" && echo "✓ [PASS] found" || echo "✗ [PASS] missing"
```

**DB 验证（需 DB 可达）**：
manual:bash
```bash
VERDICT=$(psql "$DATABASE_URL" -tAc "SELECT verdict FROM decisions WHERE category='release-gate' ORDER BY written_at DESC LIMIT 1"); \
[ "$VERDICT" = "PASS" ] && echo "✓ DB verdict=PASS" || echo "✗ DB verdict=$VERDICT"
```

---

### [BEHAVIOR] BEHAVIOR-04: 非接缝步 L0（承诺≠L0）→ exit 1

**来源**：INV-03，FR09

**断言**：
- 给定 RTM fixture，含步骤 S10（承诺 L2，实际 L0）
- 运行 `node scripts/release-gate.mjs --rtm <fixture>`
- exit code **必须** = 1
- stdout **必须** 含 `S10`（或对应步骤号）
- stdout **必须** 含 `[BLOCKED]`

**验收命令**：
manual:bash
```bash
OUTPUT=$(node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-l0-step.md 2>&1); \
EXIT=$?; \
[ $EXIT -eq 1 ] && echo "✓ exit 1" || echo "✗ exit $EXIT"; \
echo "$OUTPUT" | grep -q "\[BLOCKED\]" && echo "✓ [BLOCKED] found" || echo "✗ [BLOCKED] missing"
```

---

### [BEHAVIOR] BEHAVIOR-05: Brain API 只读，POST → 405

**来源**：INV-07，FR07

**断言**：
- Brain API 运行在 `http://localhost:5221`
- `GET /api/brain/release-gate/path4-customer-service` → HTTP 200，响应含 `verdict` 字段
- `POST /api/brain/release-gate/path4-customer-service` → HTTP 405
- `PUT /api/brain/release-gate/path4-customer-service` → HTTP 405

**验收命令**：
manual:bash
```bash
# GET 查账
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/release-gate/path4-customer-service); \
[ "$STATUS" = "200" ] && echo "✓ GET 200" || echo "✗ GET $STATUS"

# POST 拒绝
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/release-gate/path4-customer-service); \
[ "$STATUS" = "405" ] && echo "✓ POST 405" || echo "✗ POST $STATUS"
```

---

### [BEHAVIOR] BEHAVIOR-06: exit 1/exit 2 时禁止写 decisions 表（无副作用）

**来源**：INV-01，NFR02，铁律第1条

**断言**：
- 运行含缺口 fixture（预期 exit 1）前后，decisions 表中 `category='release-gate'` 行数不变
- 运行 RTM 缺失（预期 exit 2）前后，decisions 表不增加任何行

**验收命令（需 DB 可达）**：
manual:bash
```bash
COUNT_BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM decisions WHERE category='release-gate'"); \
node scripts/release-gate.mjs --rtm scripts/__tests__/__fixtures__/rtm-with-gaps.md > /dev/null 2>&1; \
COUNT_AFTER=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM decisions WHERE category='release-gate'"); \
[ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo "✓ 无副作用（行数不变）" || echo "✗ 有副作用（$COUNT_BEFORE → $COUNT_AFTER）"
```

---

## 自动化测试对照表

| BEHAVIOR 条目 | 对应测试文件 | 测试描述 |
|--------------|-------------|---------|
| BEHAVIOR-01 | `scripts/__tests__/release-gate.test.mjs` | `[BEHAVIOR-01] 含接缝步 L1 → exit 1 + [BLOCKED] + S1` |
| BEHAVIOR-02 | `scripts/__tests__/release-gate.test.mjs` | `[BEHAVIOR-02] RTM 缺失 → exit 2 + [NO_RTM]` |
| BEHAVIOR-03 | `scripts/__tests__/release-gate.test.mjs` | `[BEHAVIOR-03] 全达标 → exit 0 + [PASS]` |
| BEHAVIOR-04 | `scripts/__tests__/release-gate.test.mjs` | `[BEHAVIOR-04] 非接缝步 L0 承诺≠L0 → exit 1` |
| BEHAVIOR-05 | `packages/brain/src/routes/__tests__/release-gate.test.js` | `[BEHAVIOR-05] POST/PUT → 405` |
| BEHAVIOR-06 | `scripts/__tests__/release-gate.test.mjs` | `[BEHAVIOR-06] exit 1 时不写 decisions`（mock DB） |

---

## 验收门控（全通才可合并）

- [ ] `BEHAVIOR-01` 测试通过（failing-first: 先红后绿）
- [ ] `BEHAVIOR-02` 测试通过
- [ ] `BEHAVIOR-03` 测试通过（含 DB mock 验证）
- [ ] `BEHAVIOR-04` 测试通过
- [ ] `BEHAVIOR-05` 测试通过
- [ ] `BEHAVIOR-06` 测试通过（无副作用 mock 验证）
- [ ] CLI E2E：`node scripts/release-gate.mjs --path path4-customer-service` → exit 1，含 6 条 `[BLOCKED]` 缺口
- [ ] API E2E：GET 200 + POST 405
- [ ] NFR01：CLI 执行时间 < 2s
- [ ] NFR04：无新 npm 依赖（`git diff package.json` 无新 dependencies）
