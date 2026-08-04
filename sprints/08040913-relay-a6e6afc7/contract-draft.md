# Sprint Contract Draft (Round 1)

Sprint: ledger-hygiene m7「自主循环零产出」探针可信化（消除自指计数与滑动窗秒级竞态）
journey_type: autonomous
target_environment: local_api

---

## Response Schema（推导来源: N/A — 任务无 HTTP 响应；以下为内部结构约定）

本 sprint 不新增/不改动任何 HTTP 端点（PRD 范围限定 + Invariant「端点鉴权：本 sprint 不新增端点」），
故无 HTTP Response Schema，Reviewer 第 6 维按 N/A 处理。但 m7 指标对象是下游（renderHygieneMarkdown
日报、evaluateRatchet 棘轮）的消费接口，其结构为合同硬约定：

### 内部结构: `computeMetrics(pool, now?)` 返回值中的 `m7`

**激活态（strat 或 capture 至少一项激活）**:
```json
{
  "key": "m7",
  "name": "自主循环零产出",
  "value": { "stratDebt": 0, "captureDebt": 0, "organic": 1, "self": 1 },
  "debt": 0,
  "enabled": true,
  "absolute": true
}
```
- `value.stratDebt` (number, 必填): 来源——现有代码 SSOT（ledger-hygiene.js:208，字面保留，strategist 逻辑不改）
- `value.captureDebt` (number, 必填): 来源——现有代码 SSOT（字面保留）；语义收紧为「capture 激活且 organic===0 时为 1」
- `value.organic` (number|null, 必填): 来源——PRD L23 字面「organic / self 分解计数」[NEW_PATTERN 字段名，PRD 字面]；capture 未激活时为 null
- `value.self` (number|null, 必填): 来源——PRD L23 字面；capture 未激活时为 null
- `value` keys 恒定（激活态）: 排序后 == `["captureDebt","organic","self","stratDebt"]`
- `debt` = stratDebt + captureDebt；`absolute: true` 保持现状

**双未激活态**: 保持现状字面 `{ key:'m7', name:'自主循环零产出', value: null, debt: 0, enabled: false }`

**禁用字段名**: `organic_count` / `self_count` / `organicCnt` / `selfCnt` / `captureCnt` / `organicAtoms`（来自既有 value 字段 camelCase 风格的同义替换词，禁止漂移）

**Error**: 无 HTTP error path；错误路径 = SQL 失败走既有 `safeMetric` 降级（enabled=false + console.warn），capture_atoms 表不存在走既有未激活降级——两者行为字面不变（PRD 边界情况 L31 + NFR 可观测 L56）。

### 新增导出（[AI_ADDED]，理由见 Golden Path Step 5）

```js
export function getM7CaptureWindow(now = new Date()) // → { startUtc: Date, endUtc: Date }
export const LEDGER_SELF_ATOM_PREFIX = 'issue: [ledger-hygiene]'
export async function computeMetrics(pool, now = new Date()) // 第二参新增，单参调用向后兼容
```
- `getM7CaptureWindow(now)`：北京（Asia/Shanghai）**昨日自然日** [00:00:00, 24:00:00) 对应的 UTC 时刻对；**仅依赖 now 的北京日历日**，同一北京日内任意时刻调用结果完全一致
- m7 capture 计数 SQL：窗口界以 `$1`/`$2` 参数传入（`startUtc.toISOString()` / `endUtc.toISOString()`），**禁止 NOW() 滑动窗**；单条查询以列别名 `organic` / `self` 返回分解计数（`content LIKE 'issue: [ledger-hygiene]%'` 计 self，否则计 organic）
- `LEDGER_SELF_ATOM_PREFIX` 必须同时用于 m7 分类 SQL 构造，且与 `raiseBreachAlerts` 写出的 atom content 前缀同源（防将来单边改动使分类失效）

---

## 已知约束（来自回归测试）

来源文件：`packages/brain/src/__tests__/ledger-hygiene.test.js`、`ledger-hygiene-m7.test.js`（本 sprint 改动后必须全部保持绿，m1-m6 与 strategist 无回退）：

- [ledger-hygiene.test.js] → 窗口 gate：UTC 21:10-21:15 内 true，窗口前/后/其他小时 false
- [ledger-hygiene.test.js] → m1-m6 各指标计算口径（FR沉淀率/归属完整率/回执核销/知识保质期/判定点活性/evaluator门禁覆盖率）不变
- [ledger-hygiene.test.js] → 单指标 SQL 失败 → 该指标 enabled=false，其他指标不受影响
- [ledger-hygiene.test.js] → absolute 指标 debt=1、无 prev → 首跑即击穿；debt 持平仍击穿且 streak 递增；debt=0 清零
- [ledger-hygiene.test.js] → 欠账上升 → 击穿开 P2 issue；连续 3 天 → P1 + Bark；当日已有同指标 issue → 跳过（每指标每日最多一条）
- [ledger-hygiene.test.js] → 非窗口期不执行；20h 内已有记录 skip；issue 写入失败不阻断落库
- [ledger-hygiene-m7.test.js] → strategist 从未产出 → m7 enabled=false；strategist 近 24h 逻辑不变（本 sprint 不改 strategist）
- [ledger-hygiene-m7.test.js] → capture_atoms 表不存在（throw）→ 降级为未激活，m7 仍可用
- [ledger-hygiene-m7.test.js] → 两项都零产出 → debt=2；m7 首次 debt=1（absolute）→ 击穿；enabled=false 不参与棘轮
- [ledger-hygiene-m7.test.js] → m7 value 是 object 时日报以 JSON 显示；enabled=false 显示「未启用」
- [累积FR] context-manifest: unavailable（本任务 journey_id=none，`/api/brain/line/none/context-manifest` 404；PRD L77 本 line 暂无历史）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | m7 capture 子探针改为：以北京昨日自然日窗口统计 capture_atoms，按 `issue: [ledger-hygiene]` 前缀分解 organic/self，仅 organic=0 才 captureDebt=1；value 展示分解计数 |
| **NFR（做得多好）** | 非功能需求 | PRD 未指定超时/频控（待定）；m7 计算失败必须走既有 safeMetric 降级并 console.warn（不回退，PRD L56） |
| **Invariant（永不违反）** | 不变量 | ①真零产出不得被自产 atom 假绿（organic=0 必击穿）②有机产出 ≥1 不得误报（debt=0）③strategist 子探针行为字面不变 ④未激活/表缺失降级行为字面不变 ⑤同一北京日内运行时刻漂移不改变 m7 结果 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效谁退役 | 分类前缀与 raiseBreachAlerts 写入格式耦合：以共享常量 LEDGER_SELF_ATOM_PREFIX 同源 + 单测「raiseBreachAlerts 写出的 atom content 以自产前缀开头」永留 CI，写入格式改动即测试红，无静默过期 |
| **死亡告警（停了谁知道）** | 停摆可见性 | m7 计算失败 → safeMetric 标 enabled=false，日报表格显示「未启用」+ Brain log warn（既有通路，不新增）；守卫整体停摆由日报缺失可见（现状） |
| **失败语义（挂了怎么办）** | 放行还是拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执方式 | 击穿 → issue + capture push 既有通路不变（既有测试覆盖「proven-to-fire」）；分解展示生效 = 日报 m7 行 JSON 含 organic/self（单测断言 renderHygieneMarkdown 输出） |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例:微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ capture atom 是否守卫自产 | A. content 前缀 `issue: [ledger-hygiene]` LIKE 匹配; B. capture_atoms 新增来源列迁移 | A. 内容前缀匹配 | PRD ASSUMPTION L41 已拍；raiseBreachAlerts 写入格式代码核实（ledger-hygiene.js:311/334）；生产 DB 实证 08-04 两条自产 atom 均为该前缀；B 需 schema 迁移超 PRD 范围 | 自产误判为有机 → 真零产出被假绿静默掩盖；非守卫 atom 恰以该前缀开头 → 误计 self 使有机偏低 → 多报击穿（fail-safe 方向，宁误报不假绿） |
| m7 capture 统计的「一天」 | A. NOW()-24h 滑动窗; B. 北京自然日（昨日 00:00-24:00） | B. 北京自然日 | PRD L22 字面 + ASSUMPTION L42（与守卫北京 05:10 口径一致）；A 即 08-03 事故根因（秒级漂移） | 沿用 A → 调度秒级漂移使前日 atom 落窗外 → count=0 误击穿（08-03 实证） |

> ⚠️ 判定点均已由 PRD ASSUMPTION（L41/L42）拍板，无 judgment-pending-user 项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| m7 SQL 失败/DB 局部异常 | safeMetric 捕获，m7 enabled=false，不阻断 m1-m6 与落库（放行） | 是（守卫 20h 去重，重跑无副作用） | 日报显示「未启用」+ console.warn |
| capture_atoms 表不存在 | capture 分支降级未激活（captureDebt=0，organic/self=null），不 throw | 是 | strategist 分支独立继续 |
| 击穿 issue 写入失败 | 既有行为：warn 不阻断落库（不改动） | 是（当日同指标 issue 去重） | 既有通路 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A——本 sprint 为内部定时守卫指标计算，无外部用户/agent 可写入接口。唯一间接输入是
capture_atoms.content（系统内部各处 push 写入，含 LLM 产物）；其仅作 LIKE 前缀匹配的被动分类输入，
最坏情形（非守卫 atom 恰以自产前缀开头）已在判定点登记表登记，方向为 fail-safe（宁误报不假绿）。

---

## Golden Path
[每日北京 05:10 守卫运行] → [m7 capture 子探针确定性自然日窗口统计有机产出（排除自产）] → [报告 organic/self 分解 + 棘轮反映真实状态] → [降级路径不回退]

### Step 1: 守卫每日北京 05:10 窗口运行 m7
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 1 条（L21）「ledger-hygiene 每日北京 05:10 窗口运行，计算 m7」

**可观测行为**: 窗口 gate（UTC 21:10-21:15）、20h 去重、maybeRunLedgerHygiene 主入口行为均不变；m1-m6 与 strategist 子探针零回退（PRD 范围限定 L37 + 边界情况 L32）。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js src/__tests__/ledger-hygiene-m7.test.js src/__tests__/scheduler-jobs.test.js --reporter=verbose
```

**硬阈值**: exit 0，全部既有测试绿（0 failed）。

---

### Step 2: m7 capture 子探针以确定性自然日窗口统计
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 2 条（L22）「统计窗口改为确定性自然日窗口（北京时间昨日 00:00–24:00），秒级/分钟级漂移不改变统计结果」+ 边界情况 L29「昨日 23:59:59 计入，今日 00:00:00 不计入」

**可观测行为**: 窗口界 = 北京昨日 [00:00:00, 24:00:00)；边界 atom 按半开区间归属；同一北京日内运行时刻偏移 ±60 秒，m7 结果逐字段不变。

**验证命令**:
```bash
node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs boundary
node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs drift
```

**硬阈值**: 两场景均 exit 0；boundary 场景种 4 枚边界 atom（昨日 23:59:59 / 今日 00:00:00 / 昨日 00:00:00 / 前日 23:59:59）仅计 2 枚 organic；drift 场景 T、T+60s、T-60s 三次 m7 JSON 逐字节全等，且 getM7CaptureWindow 界值与 runner 独立推导的北京昨日窗口一致。

---

### Step 3: 报告与棘轮反映真实的自主循环产出状态
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 3 条（L23）「value 展示 organic / self 分解计数；有机产出为 0 时才 debt+1 击穿；有机产出 ≥1 时 debt=0，不误报」+ 边界情况 L30「窗口内全部 atom 均为守卫自产 → 正常击穿」

**可观测行为**: 昨日窗口内 1 有机 + 1 自产 → organic=1/self=1/captureDebt=0（不误报）；仅自产 → organic=0/captureDebt=1（真零产出仍击穿，absolute 棘轮通路不变，击穿标题与 issue/capture push 通路不变）。

**验证命令**:
```bash
node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs organic-self
node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs only-self
```

**硬阈值**: organic-self 场景 value keys 排序 == ["captureDebt","organic","self","stratDebt"] 且 organic==1、self==1、captureDebt==0、debt==0；only-self 场景 organic==0、self==1、captureDebt==1、debt==1、absolute==true；均 exit 0。

---

### Step 4: 降级路径保持现状
**来源**: `[FROM_PRD]` — PRD 边界情况 L31「capture_atoms 表为空/不存在 → 探针保持既有『未激活』降级行为不变」

**可观测行为**: capture_atoms 表不存在且 strategist 无记录 → m7 返回既有未激活占位（enabled=false, debt=0），不 throw。

**验证命令**:
```bash
node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs no-table
```

**硬阈值**: exit 0；m7.enabled==false 且 m7.debt==0。

---

### Step 5: 判定时刻注入接口与前缀同源常量
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：①秒级漂移确定性必须可机检——不注入判定时刻 now 就只能 sleep 真实时钟（慢且可造假），`computeMetrics(pool, now?)` + `getM7CaptureWindow(now)` 导出使 ±60s 漂移断言成为纯确定性测试；②窗口界以参数化 $1/$2 传入 SQL 使「禁 NOW() 滑动窗」可被单测机械断言；③自产前缀提取为共享常量 `LEDGER_SELF_ATOM_PREFIX` 并断言 raiseBreachAlerts 写出内容以其开头，防未来单边改 issue atom 格式使分类静默失效（保质期防护）。

**可观测行为**: 三个新导出存在且语义如 Response Schema 段所约；`computeMetrics(pool)` 单参调用向后兼容。

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/ledger-hygiene-m7-organic.test.js --reporter=verbose
```

**硬阈值**: exit 0，12/12 测试绿（含「运行时刻偏移 ±60 秒窗口不变」「复现 08-03 击穿：前一日 atom 差 6 秒不再落窗外」「raiseBreachAlerts 写出的 atom content 以自产前缀开头」）。

---

## 真实调用方请求 shape

N/A——本 sprint 无「设备/agent 调服务端」链路：m7 探针由 Brain 内部 tick 调度（scheduler → maybeRunLedgerHygiene），无外部调用方、无认证 shape。消费方为同进程的 renderHygieneMarkdown / evaluateRatchet，其接口即上方「内部结构」段（合同硬约定）。

## 未覆盖真实链路清单

- **mock 使用登记**：合同单测 `tests/ledger-hygiene-m7-organic.test.js` 使用 mock pool（对齐既有 ledger-hygiene 测试风格），仅覆盖窗口纯函数、参数装配与 value 结构｜原因：单测不依赖 DB 保持 brain-unit 快跑｜真验证补位：**同一合同内**已补齐——`tests/ledger-hygiene-m7-organic.integration.test.js`（真 Postgres，进 brain-integration CI 永跑）+ `tests/m7-e2e-runner.mjs` 五场景（evaluator 本机真 Postgres 真跑实现），SQL 窗口/分类语义全部真库验证，无遗留未覆盖点。
- 第三方 API：N/A（本 sprint 零第三方依赖，规则 B 不适用——唯一外部依赖是本机 Postgres，已真连）。

## 禁 mock 边清单

- 代码 ↔ DB 表 capture_atoms（本单改 m7 capture 计数 SQL 的窗口与分类语义——08-03 事故根因正是 SQL 窗口语义，mock pool 结构性验不到；`tests/ledger-hygiene-m7-organic.integration.test.js` 与 `tests/m7-e2e-runner.mjs` 全部真 Postgres 执行该边，且 integration 测试必须登记进 `vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 由 brain-integration job 真 PG 跑）
- 模块内 raiseBreachAlerts ↔ capture-inbox.pushCaptureAtom（自产前缀同源保障测试必须真调 pushCaptureAtom 走到 `INSERT INTO captures` 语句层断言 content 前缀，不许 vi.mock capture-inbox.js）
- 说明：调度器（scheduler-jobs）、棘轮状态机（evaluateRatchet）本单不改动逻辑，仅以既有回归测试守护不回退，不在本单禁 mock 边内。

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/08040913-relay-a6e6afc7"

# 1. 五个真 Postgres 场景 oracle：真实 computeMetrics + 一次性独立 schema（种子/断言/清理见 runner 源码）
#    防造假：断言对象是 packages/brain/src/ledger-hygiene.js 的真实执行结果；期望窗口由 runner 独立推导
for sc in organic-self only-self boundary drift no-table; do
  node "$SPRINT_DIR/tests/m7-e2e-runner.mjs" "$sc" || { echo "FAIL: 场景 $sc"; exit 1; }
done

# 2. 回归测试已按合同原样落位（CONTRACT IS LAW：generator 从合同 tests/ 逐字节复制，commit 1 后不可改）
diff "$SPRINT_DIR/tests/ledger-hygiene-m7-organic.test.js" packages/brain/src/__tests__/ledger-hygiene-m7-organic.test.js || { echo "FAIL: 单测未按合同原样落位"; exit 1; }
diff "$SPRINT_DIR/tests/ledger-hygiene-m7-organic.integration.test.js" packages/brain/src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js || { echo "FAIL: 集成测试未按合同原样落位"; exit 1; }

# 3. 集成测试已登记进 POSTGRES_INTEGRATION_TESTS（brain-integration 真 PG 永跑，brain-unit 排除）
node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('ledger-hygiene-m7-organic.integration.test.js'))process.exit(1)" || { echo "FAIL: 集成测试未登记进 POSTGRES_INTEGRATION_TESTS"; exit 1; }

# 4. 新回归 + 既有 ledger-hygiene / scheduler-jobs 套件全绿（m1-m6 与 strategist 零回退，PRD 验收点 5）
cd packages/brain
npx vitest run src/__tests__/ledger-hygiene-m7-organic.test.js src/__tests__/ledger-hygiene-m7.test.js src/__tests__/ledger-hygiene.test.js src/__tests__/scheduler-jobs.test.js --reporter=verbose 2>&1 | tail -30
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "FAIL: 单测/回归套件未全绿"; exit 1; }

# 5. 集成测试真 Postgres 全绿（禁 mock 边执法：代码 ↔ capture_atoms）
npx vitest run --config vitest.integration.config.js src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js --reporter=verbose 2>&1 | tail -20
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "FAIL: 真库集成测试未全绿"; exit 1; }
cd ../..

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。
**FAIL 标准**: 任一场景断言失败 / 测试文件未按合同落位 / 集成测试未登记 / 任一测试套件非绿。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 确定性窗口纯函数 | `tests/ledger-hygiene-m7-organic.test.js` | 返回北京昨日自然日窗口的 UTC 界；运行时刻偏移 ±60 秒窗口不变；前一日 atom 差 6 秒不再落窗外；昨日 23:59:59 在窗内，今日 00:00:00 在窗外 | → 4 failures（getM7CaptureWindow 未导出） |
| m7 有机统计口径 | `tests/ledger-hygiene-m7-organic.test.js` | 以参数化窗口界查询且排除自产前缀；organic 与 self 分解计入 m7.value 且 keys 恒定；仅守卫自产 atom 时 organic=0 仍击穿；不传 now 参数向后兼容；capture_atoms 表不存在时保持未激活降级 | → 5 failures（现实现无分解/无参数化窗口） |
| 前缀同源保障 | `tests/ledger-hygiene-m7-organic.test.js` | LEDGER_SELF_ATOM_PREFIX 与既有 atom 写入格式一致；raiseBreachAlerts 写出的 atom content 以自产前缀开头 | → 2 failures（常量未导出） |
| 日报分解展示 | `tests/ledger-hygiene-m7-organic.test.js` | 日报渲染展示 organic/self 分解 | 既有渲染 JSON 化 value 天然覆盖（回归守卫，当前绿） |
| 真库 SQL 语义 | `tests/ledger-hygiene-m7-organic.integration.test.js` | 真库：organic 与 self 分解且自产不计入有机；真库：仅自产 atom 时 organic=0 仍击穿；真库：窗口边界昨日 23:59:59 计入且今日 00:00:00 不计入；真库：运行时刻偏移 ±60 秒 m7 结果不变 | → 4 failures（value.organic undefined） |

已实测 Red 证据（proposer 本机，2026-08-04）：`npx vitest run` 单测文件 **11 failed | 1 passed**（唯一绿为日报渲染回归守卫，符合预期）；`node tests/m7-e2e-runner.mjs organic-self` exit 1（`FAIL: ledger-hygiene.js 未导出 computeMetrics/getM7CaptureWindow`）。

---

## 接缝清单（碰真实世界的点 + 真目标验证方式）

1. **代码 ↔ 真 Postgres 的时区窗口 SQL 语义**：真目标 = 本机/CI 真 Postgres。验证 = m7-e2e-runner 五场景（evaluator 真跑）+ integration 测试进 brain-integration（真 PG service 容器永跑）。已在本合同内真验，无 logic-done-pending。
2. **分类前缀 ↔ raiseBreachAlerts 生产写入格式**：真目标 = 生产 DB 实际 atom 内容。验证 = 生产 DB 已实证（08-04 两条自产 atom 前缀逐字符吻合）+ 同源常量单测永留 CI。已真验。
3. **调度时刻漂移 ↔ 窗口确定性**：真目标 = 真实调度器逐日漂移。验证 = 确定性窗口设计使漂移与结果解耦，drift 场景 ±60s 真库重算全等。已真验（设计消除 + 真库断言）。

本合同无 logic-done-pending 项。

contract-gate: 本 repo 为 cecelia monorepo，代码层 Contract Gate（packages/brain/src/lib/contract-gate.js）照常适用。
