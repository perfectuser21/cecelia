# Sprint Contract Draft (Round 1) — claude-headed-smoke：headed relay 链冒烟（Brain 纯函数 smoke stamp）

**journey_type**: autonomous
**target_environment**: local_api
**规模**: S（冒烟切片：一个纯函数 + 单测，零生产接线）

---

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 交付纯函数，无端点、无 DB、无 UI。以下为函数级契约（PRD 字面 + `[AI_ADDED]` 确定性澄清）：

### 函数契约: `formatSmokeStamp(taskId, date)` — `packages/brain/src/utils/relay-smoke.js`

- **导出形式**: `export function formatSmokeStamp`（命名导出，跟随 `utils/format-duration.js` 现有约定）
- **入参**:
  - `taskId` (string, 必填): 任务 UUID 字符串。空字符串或非 string → 抛 `TypeError`（PRD 边界情况第 1 条）
  - `date` (Date, 必填): 合法 Date 对象。非 Date 或 Invalid Date → 抛 `TypeError`（PRD 边界情况第 2 条）
- **返回**: string，格式 `smoke:<taskId 前 8 位>:<YYYYMMDD>`；taskId 不足 8 位时使用完整 taskId（PRD 边界情况第 3 条）
- **日期语义** `[AI_ADDED]`: YYYYMMDD 按 **UTC** 取（getUTCFullYear/getUTCMonth+1/getUTCDate，月/日零填充 2 位）。理由：PRD 示例 `formatSmokeStamp(taskId, new Date('2026-07-22'))` 中 `new Date('2026-07-22')` 是 UTC 午夜——只有 UTC 语义能让该示例在任意时区机器（含西半球 CI runner）上恒等于 `20260722`，否则同输入跨机器不同输出，违反 PRD「同输入必得同输出」
- **纯函数约束**: 无 I/O、无全局可变状态、不 import 任何其他模块；同输入必得同输出（PRD Golden Path 第 3 步）
- **禁用**: 默认导出（`export default`）；返回对象/数组等非 string 形态

---

## 已知约束（来自回归测试）

- [format-duration.test.js] → 现有 utils 纯函数测试约定：vitest + `describe/it/expect`、中文用例名、测试文件与源文件同目录共存（`src/utils/*.test.js`），brain vitest include `src/**/*.test.js` 自动纳入 CI
- [累积FR] （本 line 暂无历史——PRD 累积 FR 段为空）
- context-manifest: unavailable（`GET /api/brain/line/bb8cc561.../context-manifest` 返回 Cannot GET，端点不存在于当前 Brain；已按 skill 要求记录，不静默跳过）
- [复活考古] `git log --diff-filter=D -- packages/brain/src/utils/relay-smoke*` 无输出：该文件无删除历史，属全新文件，无旧实现可考古

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 提供确定性纯函数 `formatSmokeStamp(taskId, date)` → `smoke:<taskId前8位>:<YYYYMMDD>`，用于 headed relay 链冒烟自证 |
| **NFR（做得多好）** | 非功能需求 | 纯同步函数，无性能阈值（PRD NFR 段 N/A）；唯一可观测 NFR：单测进入 brain-ci 常跑并通过（非本地一次性） |
| **Invariant（永不违反）** | 不变量 | ① 同输入必得同输出（跨进程/跨时区确定性，UTC 锁定）② 零生产接线：不被 packages/brain/src 任何现有模块 import ③ 非法输入抛 TypeError，不静默返回 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表（N/A） |
| **保质期（何时过期）** | 何时失效 | 冒烟函数长期留在 repo（单测常驻 brain-ci 作 relay 链回归锚点）；若未来清理，走正常退役流程（铁律[退役实证]） |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | brain-ci 常跑单测红 → PR/nightly CI 红 → ci-patrol 巡检可见。无运行时驻留，无需运行时告警 |
| **失败语义（挂了怎么办）** | 故障时行为 | 非法输入 → 同步抛 TypeError（拦截，不放行不降级）；无重试概念（纯函数无副作用，天然幂等） |
| **效果确认（已发≠已生效）** | 对外动作回执 | N/A — 无对外动作（零接线、无 I/O）。唯一"生效"= 单测在 brain-ci 绿，由 CI 状态回执 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

（本任务无接缝判定点，N/A——纯函数不推断任何外部真实状态）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| taskId 为空/非字符串 | 抛 TypeError，调用方可见 | 是（纯函数无副作用） | 无降级：显式抛错，禁止静默返回占位串 |
| date 非 Date / Invalid Date | 抛 TypeError，调用方可见 | 是（纯函数无副作用） | 同上 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 非对外暴露 agent；函数不被任何生产调用点 import，输入仅来自单测/评审脚本。

---

## Golden Path

[调用冒烟纯函数] → [确定性格式化] → [可断言的冒烟戳字符串]

### Step 1: 调用方 import 并调用 formatSmokeStamp
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 1（第 22-23 行）

**可观测行为**: `node -e` / vitest 从 `packages/brain/src/utils/relay-smoke.js` import `formatSmokeStamp` 成功，无副作用、无对其他模块的依赖

**验证命令**:
```bash
# 模块可导入且导出为函数（参数经 argv 传入，避免历史/缓存冒充——纯函数无历史态可冒充）
node -e "import(process.argv[1]).then(m=>{if(typeof m.formatSmokeStamp!==process.argv[2])process.exit(1);console.log(process.argv[3]);})" ./packages/brain/src/utils/relay-smoke.js function OK
# 期望：stdout=OK，exit 0
```

**硬阈值**: exit 0 且 stdout 为 `OK`

---

### Step 2: 确定性格式化输出冒烟戳
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」具体步骤 2-3（第 24-25 行）+ E2E 占位验收点 1（第 127-128 行）

**可观测行为**: 传入 `('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'))` 返回恰为 `smoke:097e589d:20260722`；同输入两次调用输出一致

**验证命令**:
```bash
node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const a=m.formatSmokeStamp(process.argv[2],d);const b=m.formatSmokeStamp(process.argv[2],d);if(a!==process.argv[4]||a!==b)process.exit(1);console.log(a);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z smoke:097e589d:20260722
# 期望：stdout=smoke:097e589d:20260722，exit 0
```

**硬阈值**: 输出字面等于 `smoke:097e589d:20260722`，两次调用相等，exit 0

---

### Step 3: 边界与错误路径可断言（TypeError，不静默）
**来源**: `[FROM_PRD]` — PRD「边界情况」全部 3 条（第 30-33 行）

**可观测行为**: 空/非字符串 taskId、非 Date/Invalid Date 均抛 TypeError；taskId 不足 8 位用完整 taskId 不报错

**验证命令**:
```bash
# 空 taskId + Invalid Date + 非 Date → 均须 TypeError；短 taskId → smoke:abc:20260722
node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[2]);const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(String(),d));must(()=>m.formatSmokeStamp(12345678,d));must(()=>m.formatSmokeStamp(process.argv[3],new Date(NaN)));must(()=>m.formatSmokeStamp(process.argv[3],123));if(m.formatSmokeStamp(process.argv[4],d)!==process.argv[5])process.exit(1);console.log(process.argv[6]);})" ./packages/brain/src/utils/relay-smoke.js 2026-07-22T00:00:00Z 097e589d-ec53-4102-b8d1-9aa582b88ebd abc smoke:abc:20260722 OK
# 期望：stdout=OK，exit 0
```

**硬阈值**: 4 类非法输入全部 TypeError（错抛其他类型或不抛 = FAIL），短 taskId 输出 `smoke:abc:20260722`，exit 0

---

### Step 4: 单测进入 brain-ci 常跑且全绿
**来源**: `[FROM_PRD]` — PRD「范围限定/在范围内」第 2 条（第 39 行）+ NFR 段「单元测试必须进入 brain-ci 并通过（非本地一次性验证）」（第 60 行）+ E2E 占位验收点 2（第 129 行）

**可观测行为**: `packages/brain/src/utils/relay-smoke.test.js`（CI 常跑副本，落在 brain vitest include `src/**/*.test.js` 覆盖路径内）vitest 实跑全绿

**验证命令**:
```bash
bash -lc "cd packages/brain && npx vitest run src/utils/relay-smoke.test.js --reporter=basic"
# 期望：exit 0，全部用例 passed
```

**硬阈值**: vitest exit 0，0 failed；测试文件必须位于 `packages/brain/src/utils/`（brain vitest include 路径，sprints/** 不在 brain CI include 内，放 sprint 目录不算进 CI）

---

### Step 5: 零生产接线负向验证
**来源**: `[AI_ADDED]` — 理由：PRD「范围限定」明确"零生产接线，不被任何现有模块 import"（第 38 行）是本冒烟的安全底线，但属负向属性，若不写成可机检断言，generator 误接线（或顺手 import 进 server.js）不会被任何正向测试抓到；铁律[接线验证] 也要求用 source-code inspection 验接线状态

**可观测行为**: `packages/brain/src` 下除 `utils/relay-smoke.js` / `utils/relay-smoke.test.js` 自身外，无任何文件引用 relay-smoke

**验证命令**:
```bash
W=$(grep -rl "relay-smoke" packages/brain/src --include="*.js" | grep -v "utils/relay-smoke" || true)
[ -z "$W" ] || { echo "FAIL: 发现生产接线 $W"; exit 1; }
# 期望：无输出，exit 0
```

**硬阈值**: 引用文件集合恰为 {relay-smoke.js, relay-smoke.test.js}，多一个即 FAIL

---

## 真实调用方请求 shape

N/A — 无设备/agent/webhook 等真实调用方：函数零生产接线，唯一调用方是单测与评审脚本（`node -e` 直调），无认证、无请求载荷。（真实链路规则 A 不适用）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 全部断言真跑 node/vitest 于真实 repo 代码，无 force_*/stub/假数据；无第三方 API 依赖（真实链路规则 B 无适用对象）。

## 禁 mock 边清单

（本单为零接线纯函数 + 单测，不触及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A）。合同 tests/ 无任何 vi.mock/stub。

## 接缝清单（接缝断言 vs 逻辑断言）

**无接缝** — 本 sprint 全部断言为**逻辑断言**（环境无关纯函数：解析/格式化/抛错），无真机/生产 env/真实调用方接触点。故 CI 绿 = 真 done，无 `logic-done-pending` 项。唯一环境相关点「测试进入 brain-ci」由 Step 4 真跑 vitest + 文件落位于 brain vitest include 路径共同验证。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 说明：本 sprint 为零接线纯函数（PRD Golden Path 即 node 直调，无 Brain API/DB 面），故 local_api 脚本以 node 直调真实 repo 模块 + vitest 实跑 CI 常跑测试为 oracle，不引入与 PRD 无关的 curl/psql 步骤（PRD E2E 占位第 124-131 行即此语义）。所有失败路径显式 FAIL + exit 非零，无兜底放行。

```bash
#!/bin/bash
set -euo pipefail

# final-e2e — local_api：headed relay 冒烟纯函数全 Golden Path
cd "$(git rev-parse --show-toplevel)"

# Step 1+2: 直调真实模块，断言确定性冒烟戳（含两次调用一致）
OUT=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const a=m.formatSmokeStamp(process.argv[2],d);const b=m.formatSmokeStamp(process.argv[2],d);if(a!==b)process.exit(1);console.log(a);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z)
[ "$OUT" = "smoke:097e589d:20260722" ] || { echo "FAIL: 冒烟戳不符 got=$OUT"; exit 1; }
echo "PASS step1+2: $OUT"

# Step 3: 边界与错误路径（4 类非法输入 TypeError + 短 taskId 用全量）
OUT3=$(node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[2]);const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(String(),d));must(()=>m.formatSmokeStamp(12345678,d));must(()=>m.formatSmokeStamp(process.argv[3],new Date(NaN)));must(()=>m.formatSmokeStamp(process.argv[3],123));console.log(m.formatSmokeStamp(process.argv[4],d));})" ./packages/brain/src/utils/relay-smoke.js 2026-07-22T00:00:00Z 097e589d-ec53-4102-b8d1-9aa582b88ebd abc)
[ "$OUT3" = "smoke:abc:20260722" ] || { echo "FAIL: 边界路径 got=$OUT3"; exit 1; }
echo "PASS step3: TypeError x4 + short-taskId"

# Step 4: CI 常跑单测实跑全绿（文件必须在 brain vitest include 路径 src/utils/ 下）
[ -f packages/brain/src/utils/relay-smoke.test.js ] || { echo "FAIL: CI 常跑测试副本不存在"; exit 1; }
bash -lc "cd packages/brain && npx vitest run src/utils/relay-smoke.test.js --reporter=basic" || { echo "FAIL: brain 单测未通过"; exit 1; }
echo "PASS step4: brain-ci 常跑单测全绿"

# Step 5: 零生产接线负向验证（source-code inspection）
W=$(grep -rl "relay-smoke" packages/brain/src --include="*.js" | grep -v "utils/relay-smoke" || true)
[ -z "$W" ] || { echo "FAIL: 发现生产接线 $W"; exit 1; }
echo "PASS step5: 零生产接线"

echo "✅ Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/relay-smoke.test.ts` | 标准输入返回 smoke:097e589d:20260722；同输入两次调用输出一致；日期格式化按 UTC 取 YYYYMMDD 并零填充；taskId 不足 8 位时使用完整 taskId；空 taskId 抛 TypeError；非字符串 taskId 抛 TypeError；Invalid Date 抛 TypeError；非 Date 参数抛 TypeError；同进程多轮调用状态不重置输出确定；await 异步包装调用返回相同结果 | → 1 failed suite（模块不存在，import 失败，已实跑确认） |

---

## 合同硬条款（generator 义务）

1. **CONTRACT IS LAW**：只实现 `packages/brain/src/utils/relay-smoke.js` 一个文件 + 测试；合同外一字不加，禁止接入任何生产调用点
2. **TDD 两 commit**：commit 1 = 合同 tests 原样复制进 `${SPRINT_DIR}/tests/` 保持不变 + CI 常跑副本 `packages/brain/src/utils/relay-smoke.test.js`（import 改 `./relay-smoke.js`，用例名与语义与合同 tests 逐条一致）先 Red；commit 2 = 实现 Green
3. **Red commit 只 `git add` 精确测试路径**（铁律[Red提交]），禁止 `git add .`
4. **禁改 `.github/workflows/*.yml`**（铁律[CI禁区]）；禁自行 merge PR（铁律[禁自合]）
5. **UTC 日期语义**：实现必须用 getUTC* 系列取日期分量并零填充（见函数契约「日期语义」）；用本地时区 API（getFullYear 等）= 违约
6. contract-gate: applicable（cecelia repo，packages/brain/src/lib/contract-gate.js 存在）
