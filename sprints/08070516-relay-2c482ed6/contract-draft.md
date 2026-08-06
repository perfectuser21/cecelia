# Sprint Contract Draft (Round 1) — 修复 ledger-hygiene m2「归属完整率」口径失真

**Sprint**: sprints/08070516-relay-2c482ed6
**journey_type**: autonomous
**target_environment**: local_api

---

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 是 Brain 内部守卫指标口径修正（`computeMetrics` 的 m2 子查询 SQL）+ 冒烟脚本 payload 补齐，不新增/不修改任何 API 端点（api_registry 已查，无同名端点冲突）。

**内部契约（不可漂移的既有 shape）**：m2 指标对象保持 `{ key: 'm2', name: '归属完整率', value: number, debt: number, enabled: boolean }`，keys 不增不减（下游 evaluateRatchet / renderHygieneMarkdown 依赖）。

## 口径修正规范（What→How 翻译，PRD:19-22 的技术断言）

1. **新增导出常量** `LEDGER_SELF_ISSUE_PREFIX = '[ledger-hygiene]'`（packages/brain/src/ledger-hygiene.js）：守卫自产 issue 的 title 前缀，与 `raiseBreachAlerts` 写入 title（`[ledger-hygiene] ${b.name} ...`，:352）及当日去重查询（:359）同源。命名沿用既有 `LEDGER_SELF_ATOM_PREFIX` 模式。
2. **m2 issues 子查询**（`/* attribution_issues */`）排除自产：debt 计数增加谓词 `AND title NOT LIKE '${LEDGER_SELF_ISSUE_PREFIX}%'`（total 同步排除，防分母污染）。
3. **m2 tasks 子查询**（`/* attribution_tasks */`）排除两类噪声：
   - 守卫自产 [紧急] task：`AND title NOT LIKE '[紧急] ' || '${LEDGER_SELF_ATOM_PREFIX}%'` 形态（前缀 = capture-triage.js:162 的 `[紧急] ` 模板 + 既有 `LEDGER_SELF_ATOM_PREFIX`，即逐字 `[紧急] issue: [ledger-hygiene]`，代码里必须由常量拼接派生，禁止孤立第三份字面量）
   - 冒烟标记：`AND payload->>'smoke_tag' IS NULL`（标记形态判定见判定点登记表 J1）
4. **attribution_harness 停计**：`/* attribution_harness */` 子查询在 ability_id 接线前不再计入 m2 的 debt 与 total 求和（删除该查询或保留但不入和均可，代码注释注明「ability_id 接线后恢复属后续 sprint」）。同一 harness 任务缺 journey_id 时仅在 tasks 子查询计 1 次 → 双重计数随之消除（PRD:22）。
5. **既有测试同步授权**：`packages/brain/src/__tests__/ledger-hygiene.test.js:69-78` 的 m2 断言（`tasks缺2 + issues缺1 + harness缺1 → debt=4`, `value=14/18`）是旧口径的镜像，授权 Generator 将其更新为停计口径（debt=3, value=12/15），其余既有测试不得改动。
6. **SQL 注释锚保留**：`/* attribution_tasks */`、`/* attribution_issues */` 注释保留（回归测试的 mock 路由锚）。
7. **冒烟脚本**：`packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh`、`claude-headed-dispatch-smoke.sh` 中所有 POST /api/brain/tasks 建 task 的 body 必须携带 `smoke_tag`（现状 3/4 条已带；invalid-mode 一条虽预期 400 不建 task，防御性补齐——校验逻辑将来放行时残留 task 仍可被 m2 排除）。

## 已知约束（来自回归测试 + 累积FR）

- [ledger-hygiene.test.js] → `m2 归属完整率：tasks缺2 + issues缺1 + harness缺1 → debt=4`（**本 sprint 口径变更点**，授权更新见规范§5）
- [ledger-hygiene.test.js] → `单指标 SQL 失败 → 该指标 enabled=false，其他指标不受影响`（safeMetric 降级机制不得破坏）
- [ledger-hygiene.test.js] → `首跑无 prev → 建基线，零击穿`；棘轮仅对 `debt > prevDebt` 击穿（PRD:29「骤降不误报」由既有 evaluateRatchet 语义保证，本次不改棘轮）
- [ledger-hygiene-m7-organic.test.js] → `LEDGER_SELF_ATOM_PREFIX 与既有 atom 写入格式一致`、`m7 capture 计数以参数化窗口界查询且排除自产前缀`（m7 自产排除同源模式 = 本次 m2 的参照，不得破坏）
- [ledger-hygiene-m7.test.js] → m7/窗口/渲染既有行为不得回退
- [累积FR] context-manifest: unavailable（journey_id=none，issue 直派任务，PRD:76-79 已注明本 line 暂无历史）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | m2 debt 只统计真实归属缺失：排除守卫自产 issue/task、排除带 smoke_tag 的冒烟 task、attribution_harness 接线前停计（双重计数消除）；冒烟脚本建 task 全部携带 smoke_tag |
| **NFR（做得多好）** | 性能/可靠性 | 只读复现脚本单次运行 <30s；DevGate 三检通过；回归测试永留 brain CI 不可删（PRD:55） |
| **Invariant（永不违反）** | 不变量 | ①真实归属缺失必须仍被计入（排除不误伤，PRD:30）；②排除前缀经共享常量派生、与写入侧同源（禁孤立字面量）；③m2 指标对象 shape 不变 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | attribution_harness 停计是临时口径：ability_id 接线 sprint 负责恢复（代码注释注明，PRD:32）；排除前缀随写入侧文案演进由同源测试守护 |
| **死亡告警（停了谁知道）** | 告警手段 | 守卫本身即告警器：口径失效表现为 m2 debt 异常漂移，由每日 ledger_hygiene 日报 + 棘轮击穿 issue 暴露；回归测试在 brain CI 红灯即时暴露 |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 修正生效以真库差分断言确认（DoD 四场景 [BEHAVIOR] + E2E）；合并上线后次日 ledger_hygiene 日报 m2 debt 应回落（当前 462 → 真实欠账约 300 上下），由晨报复核 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| J1 一条 task 是否属冒烟测试噪声 | A. `payload->>'smoke_tag'` 非空; B. title 含 smoke 关键词模糊匹配 | A. payload smoke_tag 标记 | headed 派发冒烟脚本建 task 已逐条携带 smoke_tag（codex/claude-headed-dispatch-smoke.sh:9,25,33,41 实证），机器标记零歧义；title 关键词会误伤真实业务任务（PRD ASSUMPTION 2 授权 Proposer 依现有脚本形态判定） | 真实归属缺失 task 被误排除 → 守卫漏报（仅当业务 task 伪造 smoke_tag 字段，可控） |
| J2 一条 issue/task 是否守卫自产 | A. title 前缀逐字 LIKE 匹配（共享常量派生）; B. sub_area+body 内容启发式 | A. 前缀逐字匹配 | 写入侧 title 模板固定（ledger-hygiene.js:352 + capture-triage.js:162），前缀经常量同源测试守护，m7 已验证此模式 | 用户手工建的同前缀 issue 被误排除（概率极低，前缀含 [ledger-hygiene] 语义自明） |
| J3 attribution_harness 是否「未接线」 | A. 依调研静态判定停计（全库仅 15 行非空）; B. 运行时探测非空占比自动启停 | A. 静态停计 + 注释标注恢复条件 | PRD ASSUMPTION 1 拍板「接线前停计而非本次接线」；运行时自动启停引入新判定噪声，超 thin-slice | ability_id 未来接线后该子项仍停计 → 由代码注释 + 后续 sprint 恢复（PRD:32 拍板，低危） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| m2 子查询 SQL 失败 | safeMetric 捕获 → m2 enabled=false，不阻断其他指标（既有机制，不变） | 是（只读查询） | 该指标不参与当日棘轮 |
| 冒烟脚本 cleanup trap 失败（task 残留） | 残留 task 因带 smoke_tag 不再污染 m2（本次修复的核心收益之一） | 是（DELETE by smoke_tag） | 7 天滚动窗自然滚出 |
| E2E 差分期间生产库并发写入 | 差分漂移 → 场景整体重试一次，仍失败则 FAIL（不兜底放行） | 是（每次新 tag + cleanup） | 无 |

### 输入对抗面（decisions 27b57469 第9要素）

N/A — 内部守卫指标计算，无对外暴露 agent、无外部用户可写入接口。

## 真实调用方请求 shape（规则 A）

N/A — 本 sprint 无「设备/agent 调服务端」链路：m2 计算是 Brain 进程内函数（tick job），冒烟脚本是研发侧工具（其 POST /api/brain/tasks 的 body shape 即上文规范§7 引用的脚本现行字面，非新增调用方）。

## 未覆盖真实链路清单（规则 C — mock 豁免显式登记）

| 被 mock 顶替的真实链路点 | 为什么 | 真验证补位 |
|---|---|---|
| tests/ledger-hygiene-m2-noise.test.js 用 mock pool 顶替 DB 查询往返（单测层） | 单测需确定性行值驱动求和/谓词断言，沿用 brain 既有 ledger-hygiene*.test.js 先例 | DoD 四场景 [BEHAVIOR]（tests/m2-noise-scenarios.sh 真库注入差分）+ `## E2E 验收` 脚本，由 evaluator 在真 cecelia 库（localhost:5432 + smoke-ledger-hygiene.mjs 真跑）执行 |

规则 B（第三方真调一次）：N/A — 本 sprint 无第三方 API 依赖（无 LLM/支付/平台 API）。

## 禁 mock 边清单

- ledger-hygiene m2 SQL ↔ 真 Postgres（tasks/issues 表读路径）：本单改 m2 子查询谓词，排除语义只在真库可验——DoD 四场景 [BEHAVIOR] 与 `## E2E 验收` 脚本必须真连 cecelia 库注入/差分/清理，禁止以 mock pool 结果替代这些断言（mock pool 仅限 tests/*.test.js 单测层辅助，已在规则 C 清单登记补位）。
- 本单不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径（m2 为只读 SELECT 口径修正；冒烟脚本改动为 POST body 字段补齐，无新写路径）。

---

## Golden Path
[守卫例行计算 m2] → [自产排除] → [冒烟排除] → [harness 停计/双重计数消除] → [不误伤真实欠账] → [常量同源守护]

### Step 1: 守卫例行计算 m2（只读复现入口跑通）
**来源**: `[FROM_PRD]` — PRD:18「Brain 例行运行 ledger-hygiene 守卫计算 m2……只读复现入口 smoke-ledger-hygiene.mjs」

**可观测行为**: 只读脚本输出的指标表含「归属完整率」行，debt 为非负整数（后续所有差分断言的基线读数入口）。

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)"
[ -d packages/brain/node_modules ] || npm --prefix packages/brain ci --prefer-offline >/dev/null 2>&1
D0=$(node packages/brain/scripts/smoke-ledger-hygiene.mjs | awk -F'|' '/归属完整率/{gsub(/ /,"",$4); print $4; exit}')
[[ "$D0" =~ ^[0-9]+$ ]] || { echo "FAIL: m2 debt 非数字: $D0"; exit 1; }
echo "OK m2_debt=$D0"
```

**硬阈值**: debt 匹配 `^[0-9]+$`，脚本 30s 内退出（超时即 FAIL，由 evaluator 执行超时兜底）

---

### Step 2: 自产排除 — 守卫自产 issue/task 不计入 m2
**来源**: `[FROM_PRD]` — PRD:20「排除守卫自产：[ledger-hygiene]% 前缀 issue 与 [紧急] issue: [ledger-hygiene]% 前缀 task 不计入（复用 LEDGER_SELF_ATOM_PREFIX 共享常量模式）」

**可观测行为**: 注入 1 条 `[ledger-hygiene]` 前缀 issue（journey_id NULL）+ 1 条 `[紧急] issue: [ledger-hygiene]` 前缀 task（无 journey_id）后重算，m2 debt 不变。

**验证命令**:
```bash
bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh noise
# 场景内部：D0 基线 → 注入自产 issue + 自产 task + smoke_tag task → D1 == D0 断言 → cleanup
```

**硬阈值**: 场景 exit 0（内部断言 D1 == D0；并发漂移允许整场景重试 1 次，二次失败 = FAIL）

---

### Step 3: 冒烟排除 — 带 smoke_tag 的测试 task 不计入 m2
**来源**: `[FROM_PRD]` — PRD:21「排除冒烟噪声：headed 派发冒烟脚本建的测试 task 带机器可识别标记，m2 子查询按标记排除」

**可观测行为**: 注入 1 条 `payload.smoke_tag` 非空、无 journey_id 的 harness_initiative task 后重算，m2 debt 不变（与 Step 2 合并在 noise 场景一次差分覆盖）。

**验证命令**:
```bash
bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh noise
```

**硬阈值**: 同 Step 2（noise 场景注入的三类噪声共同断言 D1 == D0，任一类漏排除即 FAIL）

---

### Step 4: attribution_harness 停计 + 双重计数消除
**来源**: `[FROM_PRD]` — PRD:22「attribution_harness 子指标（tasks.ability_id IS NULL）在字段接线前不计入 m2 求和，同一任务不再被双重计数」

**可观测行为**: 注入 1 条无 smoke_tag、无 journey_id、无 ability_id 的 harness_initiative task 后重算，m2 debt 恰 +1（旧口径会 +2：tasks 子查询 +1、attribution_harness 子查询 +1）。

**验证命令**:
```bash
bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh harness-once
```

**硬阈值**: 场景 exit 0（内部断言 D_after == D0 + 1，+2 即双重计数未消除 = FAIL）

---

### Step 5: 排除不误伤 — 真实归属缺失仍被捕捉
**来源**: `[FROM_PRD]` — PRD:30「排除条件必须精确匹配自产前缀/冒烟标记，不得误伤真实业务 task/issue（真实归属缺失仍必须被捕捉）」

**可观测行为**: 注入 1 条无标记、无 journey_id 的普通业务 task → debt 恰 +1；注入 1 条 title 不以自产前缀开头、journey_id NULL 的真实 issue → debt 恰 +1。

**验证命令**:
```bash
bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh real-miss
bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh issue-real-miss
```

**硬阈值**: 两场景各 exit 0（各自内部断言 D_after == D0 + 1，+0 即误伤/排除过宽 = FAIL）

---

### Step 6: 常量同源守护 — 排除谓词与写入侧不许单边漂移
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防止未来改 raiseBreachAlerts 文案/capture-triage 模板时 m2 排除谓词静默失效（m7 的 LEDGER_SELF_ATOM_PREFIX 同源测试已验证此风险真实存在，PRD:20「复用共享常量模式」隐含此要求，此步将其显性化为可机检断言）

**可观测行为**: `LEDGER_SELF_ISSUE_PREFIX` 常量导出且逐字等于 `[ledger-hygiene]`；raiseBreachAlerts 写入的 issue title 与当日去重查询均以该常量为前缀。

**验证命令**:
```bash
cd "$(git rev-parse --show-toplevel)/packages/brain" && npx vitest run ../../sprints/08070516-relay-2c482ed6/tests/ledger-hygiene-m2-noise.test.js
```

**硬阈值**: vitest 全绿 exit 0

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — ledger-hygiene m2 口径修正端到端验收（真 cecelia 库 + 只读复现脚本差分）
# 对应 PRD:81-94 验收点 1-5；测试数据带唯一 tag，trap 清理（验收点 6 的数据清理部分）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
[ -d packages/brain/node_modules ] || npm --prefix packages/brain ci --prefer-offline >/dev/null 2>&1

m2_debt() {
  node packages/brain/scripts/smoke-ledger-hygiene.mjs | awk -F'|' '/归属完整率/{gsub(/ /,"",$4); print $4; exit}'
}

E2E_TAG=""
cleanup() {
  if [ -n "$E2E_TAG" ]; then
    psql "$DB" -c "DELETE FROM tasks WHERE payload->>'e2e_tag' = '$E2E_TAG'" >/dev/null 2>&1 || true
    psql "$DB" -c "DELETE FROM issues WHERE body = 'e2e-tag:$E2E_TAG'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

attempt() {
  E2E_TAG="m2-e2e-$$-$RANDOM"
  local D0 D1 D2 D3

  # 1. 基线（PRD 验收点 1）
  D0=$(m2_debt)
  [[ "$D0" =~ ^[0-9]+$ ]] || { echo "FAIL: 基线 m2 debt 非数字: $D0"; return 2; }

  # 2. 注入三类噪声（PRD 验收点 2；均无 journey 归属；status=completed 防被 tick 调度）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('headed-smoke-test', 'harness_initiative', 'completed', jsonb_build_object('smoke_tag', '$E2E_TAG', 'e2e_tag', '$E2E_TAG'))" \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('[紧急] issue: [ledger-hygiene] 归属完整率 欠账上升 e2e 注入', 'dev', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))" \
    -c "INSERT INTO issues (title, priority, status, sub_area, body, journey_id) VALUES ('[ledger-hygiene] 归属完整率 e2e 注入噪声', 'P2', 'In progress', 'brain', 'e2e-tag:$E2E_TAG', NULL)"

  # 3. 重算：三类噪声全部被排除 → debt 不变（PRD 验收点 3；smoke task 同时覆盖验收点 5 —
  #    旧口径它会在 attribution_harness 子查询再 +1，D1 == D0 即证明该子项已停计且不双重计数）
  D1=$(m2_debt)
  [ "$D1" -eq "$D0" ] || { echo "DRIFT: 噪声注入后 debt $D0 -> $D1 (应不变)"; return 1; }

  # 4. 注入真实归属缺失 task → 恰 +1（PRD 验收点 4：排除不误伤）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('e2e 真实业务任务-归属缺失', 'dev', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))"
  D2=$(m2_debt)
  [ "$D2" -eq $((D0 + 1)) ] || { echo "DRIFT: 真实缺失注入后 debt $D0 -> $D2 (应恰 +1)"; return 1; }

  # 5. attribution_harness 停计 + 双重计数消除（PRD 验收点 5）：
  #    无 smoke_tag、无 ability_id、无 journey_id 的 harness 任务只计 1 次（旧口径 +2）
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -c "INSERT INTO tasks (title, task_type, status, payload) VALUES ('e2e harness 真实归属缺失', 'harness_initiative', 'completed', jsonb_build_object('e2e_tag', '$E2E_TAG'))"
  D3=$(m2_debt)
  [ "$D3" -eq $((D0 + 2)) ] || { echo "DRIFT: harness 缺失注入后 debt $D0 -> $D3 (应累计恰 +2，+3 即双重计数未消除)"; return 1; }

  echo "PASS D0=$D0 D1=$D1 D2=$D2 D3=$D3"
  return 0
}

# 生产库存在并发写入（brain_auto 建 task 等）可能恰落在测量间隙造成差分漂移：
# 允许整场景重试一次（每次新 tag + 先清理）；重试仍失败 = FAIL，不兜底放行
for run in 1 2; do
  RC=0
  attempt || RC=$?
  if [ "$RC" -eq 0 ]; then
    echo "✅ Golden Path m2 口径验证通过"
    exit 0
  fi
  [ "$RC" -eq 2 ] && exit 1
  cleanup
  echo "attempt $run 差分漂移，重试一次排除并发干扰"
done
echo "FAIL: 两次尝试均未通过 m2 口径差分验收"
exit 1
```

**PASS 标准**: 脚本 exit 0（D1==D0 且 D2==D0+1 且 D3==D0+2）
**FAIL 标准**: exit 非 0（任一差分断言失败、基线不可读、或重试后仍漂移）
**回归测试进 CI（PRD 验收点 6 的另一半）**: 由 contract-dod.md 的 [ARTIFACT]「m2 回归测试永留 CI」/「既有 ledger-hygiene.test.js 同步更新」+ [BEHAVIOR]「m2 回归测试红→绿进 CI」覆盖（测试文件落 packages/brain/src/__tests__/ 永留 brain CI）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| m2 tasks 子查询排除谓词 | `tests/ledger-hygiene-m2-noise.test.js` | 含 smoke_tag 与守卫自产 | → 1 failure（现 SQL 无排除谓词） |
| m2 issues 子查询排除谓词 | `tests/ledger-hygiene-m2-noise.test.js` | 自产前缀排除谓词 | → 1 failure（现 SQL 无排除谓词） |
| attribution_harness 停计 | `tests/ledger-hygiene-m2-noise.test.js` | 不再计入 attribution_harness | → 1 failure（现口径 debt 含 h 子项） |
| 常量同源 | `tests/ledger-hygiene-m2-noise.test.js` | 写入 title 同源 | → 1 failure（LEDGER_SELF_ISSUE_PREFIX 未导出） |
| m2 shape 守护 | `tests/ledger-hygiene-m2-noise.test.js` | shape 保持 | → 绿（既有行为回归守护） |
| 棘轮骤降不误报 | `tests/ledger-hygiene-m2-noise.test.js` | 骤降不触发击穿 | → 绿（既有 evaluateRatchet 语义守护，PRD:29） |
| 真库差分场景 | `tests/m2-noise-scenarios.sh` | noise / real-miss / issue-real-miss / harness-once | → 全场景 FAIL（排除未实现，噪声注入即涨账） |

**contract-gate**: cecelia repo，packages/brain/src/lib/contract-gate.js 存在则照常过闸；本合同断言均为「真跑脚本收 exit code + 内部差分断言」与 vitest，无裸 curl / 无 `|| true` 吞错 / 计数断言均为同 tag 差分（自带时效性，历史数据无法冒充差分基线）。
