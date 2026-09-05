# Sprint Contract Draft (Round 1)

**Sprint**: Crystal 第3件 — 契约 reviewer skill（15 秒轻对抗审契约完备性）
**journey_type**: autonomous
**target_environment**: local_api

## 锚定父路声明

独立小路（无父路）—— Crystal 结晶线第 3 件，PRD「累积 FR」为空（本 line 暂无历史），无既有 Golden Path 父路可挂。本 sprint 自成一条从「输入技能契约」到「输出排序漏洞清单 + 判定假设洞落库」的独立小路。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

> 当前仓库（cecelia）根目录不存在 `product-map/generated/product-map.json`（该文件仅 zenithjoy-workspace 有），按 skill v9.18 cross-repo file-existence gated 规则整体跳过，不阻塞。

## Contract Gate

`packages/brain/src/lib/contract-gate.js` 存在（cecelia worktree），代码层 Contract Gate 生效；本合同 [BEHAVIOR]/E2E 命令已按「Contract Gate 合规惯用法速查表」书写（curl -sf | jq -e 单管道、psql 计数带 5 分钟时间窗、负向测试捕获后断言）。
contract-gate: enforced (cecelia worktree)

## Unified Map 半径

[MAP_NOT_CONFIGURED] — 本 attempt 无 Brain 连接（runtime_resources.postgres=false），task.payload 无 map_scope/map_repo，radius 无法计算。must_run_assertions 空，不回退领域硬编码。

## Response Schema（推导来源: PRD 字面 + REST 惯例 [NEW_PATTERN]；Brain 写库复用既有端点）

本 sprint 交付物是一个 **skill + 驱动脚本 CLI**，无新增 Brain HTTP 端点。涉及两处结构化契约：

### ① 驱动脚本输出 JSON（scan.mjs stdout / --out 文件）[NEW_PATTERN]

**成功产出（漏洞清单，exit 0）**：
```json
{
  "contract_id": "<string>",
  "scanned_at": "<ISO8601 string>",
  "findings": [
    {
      "id": "<string>",
      "severity": "critical|high|medium|low",
      "surface": "missing_precondition|undecidable_postcondition|undeclared_failure_mode",
      "title": "<string>",
      "detail": "<string>",
      "is_judgment_assumption": false
    }
  ],
  "total_found": 0,
  "truncated": false,
  "judgments_written": 0
}
```
- `findings` (array, 必填): 按 `severity` 降序（critical>high>medium>low），同级按输入稳定序；最多 8 条。`findings[0]` = 最严重（真实死因）。来源——PRD Golden Path 步骤 3。
- `severity` (string 枚举, 必填): 仅 `critical|high|medium|low`。来源——PRD「按严重度排序」。
- `surface` (string 枚举, 必填): 三类缺陷面之一。来源——PRD「缺失前置 / 不可判定后置 / 未声明失败模式」。
- `is_judgment_assumption` (bool, 必填): true 则该洞属「判定假设」，落 Brain decisions(category=judgment)。来源——PRD 步骤 4。
- `total_found` (int, 必填): 截断前的原始漏洞总数。来源——PRD 边界「漏洞数 > 8 只保留 8 并标注被截断」。
- `truncated` (bool, 必填): `total_found > 8` 时为 true。来源——同上。
- `judgments_written` (int, 必填): 实际写入 decisions 的判定假设洞条数（Brain 不可达时为 0）。来源——PRD 步骤 4 + 边界「落库失败只告警不阻塞」。

**禁用字段名**（[NEW_PATTERN]，无既有 api_registry 冲突，仅列同义防漂）: `vulnerabilities`（用 `findings`）、`level`/`priority`（用 `severity`）、`category`（顶层用 `surface`，`category` 保留给 Brain decisions）、`count`（用 `total_found`）。

**错误产出（契约无法解析，exit ≠ 0）**：
```json
{ "error": "<string>", "contract_id": "<string|null>" }
```
> 死规则（PRD 边界）：契约格式非法/无法解析 → 输出 `error` 对象 + 非 0 exit，**禁止**返回 `{"findings":[],...}` 假空清单。空清单（0 漏洞）与解析失败必须可区分。

### ② Brain decisions 写入（复用既有端点，非新增）

`POST /api/brain/strategic-decisions`（server.js:371 挂载），body 逐字段复用既有 shape：
```json
{ "category": "judgment", "topic": "<string>", "decision": "<string>", "reason": "<string>", "made_by": "cecelia", "source_ref": "<string>" }
```
- `category` 必须字面 `"judgment"`（禁改成 `type`，Brain 忽略 `type`）。
- `made_by` 只能 `user|cecelia|system`（`decisions_made_by_check` 约束），本 skill 用 `cecelia`。
- `source_ref` 用于回读对账，本 skill 写 `skill-contract-auditor:<contract_id>`。

## 已知约束（来自回归测试 + 累积 FR）

- [累积FR] （本 line 暂无历史，PRD 累积 FR 为空）
- context-manifest: unavailable（runtime_resources.postgres=false，Brain 不可达，无法拉 T3 端点）
- [回归测试] 现有 `harness-contract-reviewer` skill 是 **GAN 多轮 sprint 合同审查员**，与本 skill（单枪 15 秒审**技能契约本体**）语义必须区分：本 skill 新 slug `skill-contract-auditor`，description 显式声明「非 GAN、单枪、审技能契约本体」。
- [回归约束] 判定假设洞落库必须复用既有 `POST /api/brain/strategic-decisions`（category=judgment, made_by=cecelia），不得新建端点、不得直改 decisions 表（PRD「经 Brain API，非直改表」）。

## Golden Path

[操作者/Crystal 编排器输入一份技能契约] → [scan.mjs 加载 SKILL.md 固化提示词做单枪轻对抗，沿三缺陷面扫描] → [确定性流水线归一/排序/截断] → [判定假设洞写 Brain decisions] → [输出按严重度降序 ≤8 条漏洞清单]

---

### Step 1: 输入技能契约，触发单枪轻对抗扫描
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 1「调用本 reviewer skill，传入一份技能契约」

**可观测行为**: 传入一份合法技能契约文件路径（九格 CHECKS + 八格业务 postcondition 格式），skill 用固化的 09-05 提示词沿三类缺陷面（缺失前置 / 不可判定后置 / 未声明失败模式）单枪扫描，产出 findings 原始集。

**验证命令**:
```bash
node packages/workflows/skills/skill-contract-auditor/scan.mjs \
  --contract packages/workflows/skills/skill-contract-auditor/fixtures/search-account-contract.md \
  --findings packages/workflows/skills/skill-contract-auditor/fixtures/search-account-findings.json \
  --source-ref "skill-contract-auditor:search_account" --out /tmp/sa-report.json
jq -e '.contract_id == "search_account"' /tmp/sa-report.json
```
**硬阈值**: exit 0，产出 report JSON。
**验证命令（硬阈值 codify）**: `test -s /tmp/sa-report.json && jq -e '.findings | type == "array"' /tmp/sa-report.json`

---

### Step 2: 确定性流水线——按严重度降序排序、≤8 截断、第一条 = 真实死因
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3「按严重度降序，最多 8 条，第一条为最严重（真实死因）」+ 边界「漏洞数 > 8 只保留 8 并标注被截断」

**可观测行为**: search_account 基准契约输出 **8 条**漏洞，`severity` 降序（critical>high>medium>low），`findings[0]` 是那条「未登录态与查无此人混淆」的 critical 死因洞；漏洞数 > 8 时截断到 8 且 `truncated:true`。

**验证命令**:
```bash
# 8 条 + 降序 + 第一条为 critical 死因
jq -e '(.findings | length) == 8' /tmp/sa-report.json
jq -e '.findings[0].severity == "critical"' /tmp/sa-report.json
jq -e '.findings[0].id == "SA-01-login-vs-notfound"' /tmp/sa-report.json
jq -e '[.findings[].severity] == ([.findings[].severity] | sort_by({critical:0,high:1,medium:2,low:3}[.]))' /tmp/sa-report.json
jq -e '.total_found == 8 and .truncated == false' /tmp/sa-report.json
```
**硬阈值**: findings 长度 == 8；findings[0].severity == critical 且 id == SA-01-login-vs-notfound；severity 序列已降序；total_found==8 且 truncated==false。

---

### Step 3: 判定假设洞落库 Brain decisions（category=judgment）
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 4「清单中属判定假设的漏洞，写入 Brain decisions（category=judgment）」

**可观测行为**: search_account 8 条洞中 `is_judgment_assumption:true` 的（SA-01/SA-04/SA-05/SA-08 共 4 条）经 `POST /api/brain/strategic-decisions` 真实写入 decisions 表，category=judgment，source_ref=`skill-contract-auditor:search_account`；`report.judgments_written == 4`。

**验证命令**（真 Brain + 真 Postgres，见 ## E2E 验收）:
```bash
psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='judgment' AND source_ref='skill-contract-auditor:search_account' AND created_at > NOW() - interval '5 minutes'"
# 期望 >= 4
```
**硬阈值**: decisions 表 category=judgment 且 source_ref 匹配的近 5 分钟新增行 ≥ 4；report.judgments_written == 4。

---

### Step 4: 边界——零漏洞契约返回空清单，非法契约报错（不产假空）
**来源**: `[FROM_PRD]` — PRD 边界「零漏洞契约 → 空清单（0 条），不编造洞」+「契约无法解析 → 明确报错，不产出假空清单」

**可观测行为**: 喂零漏洞契约 → `findings:[]`, `total_found:0`, exit 0；喂非法/无法解析契约 → 输出 `error` 对象 + 非 0 exit，**不**返回空 findings。

**验证命令**:
```bash
# 零漏洞 → 空清单 exit 0
node packages/workflows/skills/skill-contract-auditor/scan.mjs \
  --contract packages/workflows/skills/skill-contract-auditor/fixtures/zero-vuln-contract.md \
  --findings packages/workflows/skills/skill-contract-auditor/fixtures/zero-vuln-findings.json \
  --out /tmp/zero-report.json
jq -e '(.findings | length) == 0 and .total_found == 0' /tmp/zero-report.json
# 非法契约 → error 对象 + 非 0 exit（负向测试，Contract Gate 合规捕获形态）
OUT=$(node packages/workflows/skills/skill-contract-auditor/scan.mjs \
  --contract packages/workflows/skills/skill-contract-auditor/fixtures/invalid-contract.md \
  --findings packages/workflows/skills/skill-contract-auditor/fixtures/search-account-findings.json 2>&1) && { echo "FAIL: 非法契约未报错反而 exit 0"; exit 1; } || true
echo "$OUT" | jq -e '.error | type == "string"' || { echo "FAIL: 非法契约未产出 error 对象"; exit 1; }
```
**硬阈值**: 零漏洞 → length==0 且 total_found==0 且 exit 0；非法契约 → exit≠0 且 stdout/stderr 含 `{"error":"..."}`。

---

### Step 5: 失败语义——Brain 不可达只告警不阻塞
**来源**: `[FROM_PRD]` — PRD 边界「判定假设洞落库失败（Brain 不可达）→ 清单仍产出，落库失败只告警不阻塞」

**可观测行为**: 指向一个不可达 Brain URL 跑 search_account → 漏洞清单仍完整产出（exit 0，findings 8 条），`judgments_written:0`，stderr 有 WARN。

**验证命令**:
```bash
node packages/workflows/skills/skill-contract-auditor/scan.mjs \
  --contract packages/workflows/skills/skill-contract-auditor/fixtures/search-account-contract.md \
  --findings packages/workflows/skills/skill-contract-auditor/fixtures/search-account-findings.json \
  --brain-url "http://127.0.0.1:59999" --source-ref "skill-contract-auditor:unreachable" \
  --out /tmp/unreach-report.json 2> /tmp/unreach.err
jq -e '(.findings | length) == 8 and .judgments_written == 0' /tmp/unreach-report.json
grep -qi "warn" /tmp/unreach.err || { echo "FAIL: Brain 不可达未告警"; exit 1; }
```
**硬阈值**: exit 0；findings 8 条；judgments_written==0；stderr 含 WARN。

---

### Step 6: 出口——批量扫描 + 延迟 ≤15 秒
**来源**: `[FROM_PRD]` — PRD 范围「对第2件已产出契约的批量扫描能力」+ NFR「单份契约审查 ≤ 15 秒」

**可观测行为**: `--batch` 模式对一个目录内多份契约逐份产出各自漏洞清单；单份确定性流水线（解析+归一+排序+落库）壁钟 ≤ 15 秒。

**验证命令**:
```bash
START=$(date +%s)
node packages/workflows/skills/skill-contract-auditor/scan.mjs \
  --contract packages/workflows/skills/skill-contract-auditor/fixtures/search-account-contract.md \
  --findings packages/workflows/skills/skill-contract-auditor/fixtures/search-account-findings.json \
  --source-ref "skill-contract-auditor:timing" --out /tmp/timing.json
END=$(date +%s); [ $((END-START)) -le 15 ] || { echo "FAIL: 单份审查耗时 $((END-START))s > 15s"; exit 1; }
```
**硬阈值**: 单份扫描壁钟 ≤ 15s。

> 说明（接缝声明）：15s NFR 本意约束 **LLM 单枪轻对抗**的推理延迟；本合同的确定性流水线（解析/排序/落库）远快于 15s，此处以流水线壁钟 ≤15s 作为可机检下界 oracle。LLM 真实单枪延迟属 L3 接缝，见「## 未覆盖真实链路清单」。

---

## 真实调用方请求 shape

本 sprint 唯一「调用方 → 服务端」接缝是 `scan.mjs → Brain`。调用方（scan.mjs）复用生产既有 `POST /api/brain/strategic-decisions` shape，逐字段与既有 harness-contract-reviewer Step 5 写库一致：

| 字段 | 认证/位置 | 值 | 与生产一致性 |
|---|---|---|---|
| `category` | body | `"judgment"` 字面 | 与 strategic-decisions.js POST 一致（category 必填） |
| `topic` | body | `判定点: <title>` | 同 harness-contract-reviewer |
| `decision` | body | `所选方法/结论摘要` | 同 |
| `reason` | body | `依据 + source_ref` | 同 |
| `made_by` | body | `"cecelia"` | `decisions_made_by_check` 只允许 user\|cecelia\|system |
| `source_ref` | body | `skill-contract-auditor:<contract_id>` | migration 342 列，回读对账用 |

认证：Brain `POST /api/brain/strategic-decisions` 无额外 header 认证（server 本地端点），与既有 reviewer 写库一致；无 header/body 双路径分叉。

## 禁 mock 边清单

本单命中 **DB 写路径**（scan.mjs 经 Brain HTTP 写 decisions 表）。以下边在合同 failing test / E2E 中禁 mock：

- `scan.mjs ↔ Brain POST /api/brain/strategic-decisions ↔ decisions 表`（本单新写路径，Step 3 E2E 必须真 Brain server + 真 Postgres 验证行落库，禁止 stub/vi.mock 这条边）。

> 允许 mock 的更外层边界：`sprints/**/tests/*.test.ts` 单元测试里，`persistJudgments()` 的**告警-不阻塞分支**（Step 5 失败语义）可注入 fake `fetchImpl` 制造网络故障——这是测「Brain 不可达时不抛错」的错误处理分支，不是测「写成功」这条被改的边。写成功这条边**只**由 Step 3 E2E（真 Brain/真 PG）证明。纯排序/截断/解析逻辑（rankFindings/parseSkillContract）环境无关，单元测试直接跑，不涉及被改的边。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
SKILL_DIR="packages/workflows/skills/skill-contract-auditor"
BRAIN_PID=""
cleanup() { [ -z "$BRAIN_PID" ] || kill "$BRAIN_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 0. 从 DB_URL 派生 Brain 需要的离散 DB_* env（db-config.js 不吃连接串，只吃离散变量）
export DB_HOST=$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')
export DB_PORT=$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')
export DB_USER=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')
export DB_PASSWORD=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')
export DB_NAME=$(node -e 'process.stdout.write(new URL(process.env.DB_URL).pathname.replace(/^\//,""))')
export DATABASE_URL="$DB_URL"

# 1. 启动真实 Brain（server.js 启动时自跑 runMigrations，空库自举全 schema，含 decisions 表）
( cd packages/brain && PORT=5221 node server.js ) >/tmp/harness-brain.log 2>&1 &
BRAIN_PID=$!
for i in $(seq 1 90); do
  curl -sf "http://localhost:5221/" >/dev/null 2>&1 && break
  [ "$i" = 90 ] && { echo "FAIL: Brain 未在 90s 内就绪"; tail -30 /tmp/harness-brain.log; exit 1; }
  sleep 1
done
# 机检 decisions 表存在（migration 自举成功）
psql "$DB_URL" -tAc "SELECT to_regclass('public.decisions') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: decisions 表未建"; exit 1; }

# 2. search_account 基准：8 条 + 降序 + 第一条为 critical 死因 + 判定假设洞真实落库
node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/search-account-contract.md" \
  --findings "$SKILL_DIR/fixtures/search-account-findings.json" \
  --brain-url "http://localhost:5221" \
  --source-ref "skill-contract-auditor:search_account" --out /tmp/sa-report.json
jq -e '(.findings | length) == 8' /tmp/sa-report.json || { echo "FAIL: 非 8 条"; exit 1; }
jq -e '.findings[0].severity == "critical" and .findings[0].id == "SA-01-login-vs-notfound"' /tmp/sa-report.json \
  || { echo "FAIL: 第一条非 critical 死因"; exit 1; }
jq -e '[.findings[].severity] == ([.findings[].severity] | sort_by({critical:0,high:1,medium:2,low:3}[.]))' /tmp/sa-report.json \
  || { echo "FAIL: severity 非降序"; exit 1; }
jq -e '.total_found == 8 and .truncated == false' /tmp/sa-report.json || { echo "FAIL: total/truncated 异常"; exit 1; }
jq -e '.judgments_written == 4' /tmp/sa-report.json || { echo "FAIL: judgments_written != 4"; exit 1; }

# 3. 判定假设洞真实写进 decisions（真 PG，带 5 分钟时间窗防历史冒充）
JC=$(psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='judgment' AND source_ref='skill-contract-auditor:search_account' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$JC" -ge 4 ] || { echo "FAIL: decisions judgment 落库 $JC < 4"; exit 1; }

# 4. 边界：零漏洞契约 → 空清单（0 条），不编造
node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/zero-vuln-contract.md" \
  --findings "$SKILL_DIR/fixtures/zero-vuln-findings.json" \
  --brain-url "http://localhost:5221" --out /tmp/zero-report.json
jq -e '(.findings | length) == 0 and .total_found == 0' /tmp/zero-report.json || { echo "FAIL: 零漏洞非空清单"; exit 1; }

# 5. 边界：非法契约 → error 对象 + 非 0 exit（不产假空清单）
BADOUT=$(node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/invalid-contract.md" \
  --findings "$SKILL_DIR/fixtures/search-account-findings.json" 2>&1) \
  && { echo "FAIL: 非法契约未非 0 exit"; exit 1; } || true
echo "$BADOUT" | jq -e '.error | type == "string"' || { echo "FAIL: 非法契约未产 error 对象"; exit 1; }

# 6. 边界：>8 漏洞 → 截断到 8 且 truncated=true
node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/search-account-contract.md" \
  --findings "$SKILL_DIR/fixtures/overflow-findings.json" \
  --brain-url "http://localhost:5221" --source-ref "skill-contract-auditor:overflow" --out /tmp/of-report.json
jq -e '(.findings | length) == 8 and .truncated == true and .total_found > 8' /tmp/of-report.json || { echo "FAIL: >8 未截断"; exit 1; }

# 7. 失败语义：Brain 不可达 → 清单仍产出，落库 0，只告警
node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/search-account-contract.md" \
  --findings "$SKILL_DIR/fixtures/search-account-findings.json" \
  --brain-url "http://127.0.0.1:59999" --source-ref "skill-contract-auditor:unreachable" \
  --out /tmp/unreach-report.json 2>/tmp/unreach.err
jq -e '(.findings | length) == 8 and .judgments_written == 0' /tmp/unreach-report.json || { echo "FAIL: 不可达时清单/落库异常"; exit 1; }
grep -qi "warn" /tmp/unreach.err || { echo "FAIL: 不可达未告警"; exit 1; }

# 8. 批量扫描：目录内多份契约逐份产出清单
node "$SKILL_DIR/scan.mjs" --batch "$SKILL_DIR/fixtures/batch" --out-dir /tmp/batch-out
[ "$(ls /tmp/batch-out/*.json 2>/dev/null | wc -l | tr -d ' ')" -ge 2 ] || { echo "FAIL: 批量未逐份产出"; exit 1; }

# 9. 延迟：单份确定性流水线 ≤ 15s
START=$(date +%s)
node "$SKILL_DIR/scan.mjs" \
  --contract "$SKILL_DIR/fixtures/search-account-contract.md" \
  --findings "$SKILL_DIR/fixtures/search-account-findings.json" \
  --brain-url "http://localhost:5221" --source-ref "skill-contract-auditor:timing" --out /tmp/timing.json
END=$(date +%s); [ $((END-START)) -le 15 ] || { echo "FAIL: 单份耗时 $((END-START))s > 15s"; exit 1; }

echo "✅ Golden Path 验证通过（skill-contract-auditor）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `--findings` 指向非 JSON / findings 数组元素缺 `severity` 或 `severity` 非枚举值（如 `"urgent"`）→ 应报错而非静默排到末尾。
- 错输入: `--contract` 存在但内容为空文件 → 应归类为「非法契约」报错，不产假空清单。
- 重复提交: 同一 `--source-ref` 连跑两次 → decisions 是否重复写入（判定假设洞幂等性：PRD 未强制幂等，观察是否 2× 写入并记 findings，不阻塞）。
- 中途中断: 落库写到一半 Brain 掉线 → 已写的保留、剩余告警，report.judgments_written 反映真实已写数。
- 边界值: findings 恰好 8 条（truncated 应为 false）、恰好 9 条（truncated true，保留最严重 8）；同 severity 8 条（稳定序验证）。
发现分级: P0/P1（假空清单混淆解析失败/漏洞漏报/落库串号）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 输入一份技能契约 → 单枪轻对抗沿三缺陷面扫描 → 按严重度降序输出 ≤8 条漏洞清单 → 判定假设洞写 Brain decisions(category=judgment) → 支持批量扫描。 |
| **NFR（做得多好）** | 性能/可靠性 | 单份审查 ≤15s；清单 ≤8 条按严重度降序，第一条最严重；判定假设洞必落库，落库失败只告警不阻塞。 |
| **Invariant（永不违反）** | 不变量 | ①空清单（0 洞）与解析失败必须可区分，禁止解析失败伪装成假空清单；②禁编造洞凑数（零漏洞契约必返空）；③判定假设洞落库走既有 Brain API，禁直改 decisions 表、禁新建端点。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | skill 提示词随「第2件九格 CHECKS schema」演进；schema 大改时本 skill 三缺陷面提示词需同步复核。无 token/凭据保质期。 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 本 skill 由操作者/Crystal 编排器按需调用，非常驻；落库失败在 stderr WARN + report.judgments_written 与 total 判定假设数不符可被对账发现。 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执确认 | 落库后以 `source_ref` 回读 decisions 表计数对账（report.judgments_written vs 表内近 5 分钟行数）确认真实生效，非仅看 HTTP 200。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 一个 finding 是否属「判定假设」洞（→ 落库） | A. 由 skill 提示词标 is_judgment_assumption; B. 关键词启发式（含"推断/假设/判定"）; C. 全部落库 | A. 提示词显式标 is_judgment_assumption 布尔 | 语义判断需 LLM，启发式误分类率高；全部落库污染 judgment 指标 | 漏标→判定假设洞不落库，账本保鲜指标失真；错标→非判定洞污染 decisions |
| ⚠️ 契约「无法解析」vs「零漏洞」如何区分 | A. 解析器抛错=非法，成功但空 findings=零漏洞; B. findings 空即报错 | A. 解析成功与否决定 error/空清单 | PRD 边界明令二者必须可区分，B 会把合法零漏洞契约误报错 | 混淆→合法零漏洞契约被误报错，或非法契约伪装成假空清单被下游当"已审通过" |
| severity 排序的稳定性（同级如何定序） | A. 输入原序稳定; B. 按 title 字典序; C. 随机 | A. 同 severity 保输入稳定序 | 可复现、可回归；随机破坏基准复跑 | 排序不稳定→search_account 基准复跑结果漂移，回归测试假红 |
| ⚠️ 哪条洞是「真实死因」（findings[0]） | A. 最高 severity 即死因; B. 提示词单独标 death_cause 字段 | A. 最高 severity（critical）排第一即死因 | PRD 定义「第一条为最严重（真实死因）」，与 severity 排序统一，避免双真相源 | 若 severity 标注失准，死因错位→操作者先修错的洞 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain 不可达/落库失败 | 清单照常产出（exit 0），judgments_written=0，stderr WARN | 是（source_ref 定位，可重跑补写；PRD 未强制去重，重跑可能重复写，记 findings） | 只告警不阻塞产出（PRD 边界明令） |
| 契约无法解析 | 输出 error 对象 + 非 0 exit | 是（纯读，无副作用） | fail-closed：绝不返回假空清单当"已审通过" |
| findings 输入非法（缺 severity/枚举外） | 报错 + 非 0 exit | 是 | fail-closed，不静默排末尾 |
| 漏洞数 > 8 | 保留最严重 8 条，truncated=true，total_found 记真实数 | 是 | 降级为 top-8，不静默丢弃计数 |

### 输入对抗面

N/A —— 本 skill 是内部开发工具，输入为受信的技能契约文件（由操作者/Crystal 编排器提供，非对外暴露 agent、非外部用户可写入接口）。契约文本仅作解析/漏洞扫描输入，不作为指令执行，无 prompt injection 越权面。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性流水线（排序/截断/解析/落库分支） | `sprints/09052206-kernel-5e43ebd9/tests/skill-contract-auditor.test.ts` | `按 severity 降序`；`漏洞数大于 8 时截断到 8`；`零漏洞返回空清单`；`severity 非枚举值时报错`；`无法解析契约抛 SkillContractParseError`；`Brain 不可达时不抛错只告警`；`只把 is_judgment_assumption 为 true 的洞发往 Brain` | import scan.mjs 解析失败（模块未创建）→ 全部 FAIL |

> Test File 为本 sprint 冻结测试完整真实路径，落 `sprints/09052206-kernel-5e43ebd9/tests/`（根 vitest include 内），随本轮 commit 冻结。BEHAVIOR 覆盖名均为对应 it() 测试名的字面子串。

## 未覆盖真实链路清单

| 真实链路点 | 为什么被降级/未硬 gate | 真验证补位计划（谁/何时/什么环境） |
|---|---|---|
| LLM 单枪轻对抗**语义准确性**（真读 search_account 契约真找出 8 洞、第一条真为真实死因） | 09-05 手测运行数据不在 repo，且 LLM 输出非确定性，无法作为确定性 L2 机检 gate。本合同 L2 gate 用**录制 findings fixture** 验证确定性流水线（排序/截断/落库/边界）；「8 条 + 第一条 critical 死因」是对**录制集经流水线后**的断言，非对 LLM 实时判断的断言。 | L3 探索层：evaluator 剧本全过后，人/Claude 用 SKILL.md 提示词对 search_account fixture 真跑一次单枪，人工核对是否复现 8 洞且第一条命中死因；发现分级 P0/P1 阻塞。 |
| LLM 单枪真实推理**延迟 ≤15s** | 确定性流水线远快于 15s，B-07 以流水线壁钟作下界 oracle；LLM 真实推理延迟需真模型调用，属接缝。 | L3 探索层：单枪真跑时同时计时，超 15s 记 finding。 |
| 判定假设洞落库**幂等性**（同 source_ref 重跑是否重复写） | PRD 未强制去重（步骤 4 只要求"写入"），本合同不硬 gate 幂等。 | 探索提示「重复提交」项覆盖；如发现重复写污染指标，回 PRD 补幂等要求。 |

> 说明：本合同**无对第三方 API 的 mock 豁免**（Brain 为内部端点，Step 3 真调真验，非 mock）。单元测试对 `persistJudgments` 注入 fake `fetchImpl` 仅测「不可达告警分支」这一更外层错误处理边，写成功这条被改的边由 Step 3 E2E 真 Brain/真 PG 证明（见「## 禁 mock 边清单」）。
