# Sprint Contract Draft (Round 1) — 判定器金标集 v0 + eval 通过率棘轮进 CI

**锚定父路声明**：独立小路（无父路）—— 本 sprint 是 F1 scope 下新增的判定器质量闸，不推进既有 Golden Path 步骤，只为判定器装上"只升不降"的 CI 通过率棘轮 + 4 条防退化用例。

**map_scope**：F1（判定器 / 开发闭环质量层）。`[MAP_NOT_CONFIGURED]`：task.payload 未提供 map_scope/map_repo，Unified Map radius 未启用，回归约束以本文「已知约束」+ ratchet-registry 现状为准，不回退领域硬编码。

**contract-gate**：cecelia 仓，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，本合同断言按「Contract Gate 合规惯用法」书写。

**gp-anchor**：skipped (product-map.json not found) —— 本仓无 `product-map/generated/product-map.json`，GP-Anchor 段整体跳过，不阻塞。

**DevGate**：N/A —— 本 sprint **不触碰** `packages/brain/src` 判定器代码（PRD 范围：judge 只读被调用、不改判定算法、不新增视觉 provider）。改动面为 `tests/gp/f1/`、`scripts/ratchet-*`、`.github/workflows/`，均非 Brain 器官，无需 facts-check / version-sync / dod-mapping。

---

## Response Schema（推导来源: PRD 明确 — 无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 交付纯 node eval 基建（金标集 fixtures + eval 计分模块 + 棘轮 guard + CI job），不新增/改动任何 Brain API 端点，无 request/response 契约。Reviewer 第 6 维按「无 HTTP」满分口径，验证 oracle 完备性以下方 [BEHAVIOR] 真跑 node 断言把关。

---

## Golden Path

[PR 改动判定器相关代码触发 CI] → [判定器在金标集 v0 上跑分 + 4 条纯代码用例] → [通过率 ≥ 阈值且全绿则 CI 绿；通过率 < 阈值 / 降阈 / 任一用例失败则 CI 红]

### Step 1: PR 触发 CI eval → 加载金标集 v0
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「入口」+ 范围「金标集 v0 数据集（五类标注 + ground-truth manifest）落库到 F1 scope」。

**可观测行为**: `tests/gp/f1/fixtures/golden-set-v0/manifest.json` 存在，含 5 条标注（user-list=true；desktop/calculator/search-history/lenovo-suggest=false），每条含 `id`/`screenshot`/`label` 三字段；对应 5 张截图文件存在于 `screenshots/`。

**验证命令**:
```bash
node -e "const m=require('./tests/gp/f1/fixtures/golden-set-v0/manifest.json'); if(m.length!==5) process.exit(1); const t=m.filter(e=>e.label==='true').length, f=m.filter(e=>e.label==='false').length; if(t!==1||f!==4) process.exit(1); for(const e of m){ if(!e.id||!e.screenshot||!e.label) process.exit(1);} console.log('OK', t, f)"
```
**硬阈值**: manifest 恰 5 条、1 true / 4 false、每条三字段齐全。

---

### Step 2: 判定器跑分 → 与 ground-truth 比对算出通过率
**来源**: `[FROM_PRD]` — Golden Path 第 2 条「judge 对金标集每条截图产出 verdict，与 ground-truth 标签比对，算出通过率」。

**可观测行为**: `evalGoldenSet({manifest, judge})`（`tests/gp/f1/eval/harness-visual-eval.mjs`）对每条产 verdict 并与 label 比对，返回 `{total, correct, passRate, failures[]}`；通过率可算出。判定器（视觉模型）为**外层边界**，以 CI 内确定性参考判定（`reference-verdicts.json`）承载，见「未覆盖真实链路清单」。

**验证命令**:
```bash
npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "通过率可算出" --reporter=basic 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
```
**硬阈值**: 通过率 ∈ [0,1] 可算出，参考判定下 passRate = 1.0 ≥ 阈值。

---

### Step 3: 棘轮比对 → 只升不降，降阈被拦截
**来源**: `[FROM_PRD]` — Golden Path 第 3 条 + NFR「阈值单调性：eval 通过率阈值棘轮只升不降，降阈提交被 CI 拦截」。`[AI_ADDED]`：复用既有 `scripts/ratchet-registry.json`(`direction: only_up` / `watermark`) + `scripts/ratchet-guard.mjs`（已在 ci.yml 装配），理由：不重造棘轮机制，把"金标集通过率"接进统一台账守卫；水位单调（降阈拦截）由 `assertMonotonic` + git base↔HEAD 比对承载。

**可观测行为**:
- `scripts/ratchet-registry.json` 新增 `golden_eval_pass_rate`（`direction: only_up`，watermark = v0 参考通过率×100）；`ratchet-guard.mjs` `measure()` 新增该 case（源 = evalGoldenSet 通过率×100）→ 通过率 < 水位即 CI FAIL。
- `assertMonotonic(prev, next)`：`next < prev`（降阈提交）抛错；`run-golden-eval.mjs` 在 CI 用 git base ref 水位 vs HEAD 水位调用它，降阈 PR 被拦。

**验证命令**:
```bash
npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "降阈提交被棘轮拦截" --reporter=basic 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
node -e "const r=require('./scripts/ratchet-registry.json'); const g=r.find(x=>x.name==='golden_eval_pass_rate'); if(!g||g.direction!=='only_up'||typeof g.watermark!=='number') process.exit(1); console.log('OK', g.watermark)"
```
**硬阈值**: `assertMonotonic` 降值抛错；registry 含 only_up 条目且 watermark 为数值。

---

### Step 4: 4 条纯代码用例并行（防退化）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条「①序列固化 ②缓存零视觉 ③视觉 null fail-closed ④契约完备 lint」+ NFR 四条。

**可观测行为**（对应 4 条 [BEHAVIOR]，见 contract-dod.md）:
- ① 序列固化：`EVAL_STEPS` 冻结为固定 6 步序列，不漂移。
- ② 缓存零视觉：`cachedJudge` 对同输入二次判定不再触发视觉调用（`visionCallCount` 不增）。
- ③ null fail-closed：`failClosedJudge` 对 null verdict 判 `FAIL`，`evalGoldenSet` 中 null 永不计正确。
- ④ 契约完备 lint：`lintSkillContract` 缺 pre/post/side_effects 任一段 → `ok:false`。

**验证命令**:
```bash
npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "序列固化" -t "缓存" -t "fail-closed" -t "契约缺" --reporter=basic 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
```
**硬阈值**: 4 条用例全过（exit 0）。

---

### Step 5: 出口 —— 通过率 ≥ 阈值 且 4 条用例全绿 → CI 绿；否则红
**来源**: `[FROM_PRD]` — Golden Path 第 5 条「出口」。`[AI_ADDED]`：新增 `.github/workflows/golden-eval-ratchet.yml`（ubuntu/pull_request）跑 `tests/gp/f1/` 永久回归 + `run-golden-eval.mjs`，理由：让棘轮与 4 条用例成为 PR 阻塞闸（PRD「CI eval job」）。

**可观测行为**: workflow 文件存在且调用 eval runner 与 tests/gp/f1 用例；空金标集/缺标签/阈值文件损坏 → runner fail-closed 退非零（不空跑判绿）。

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('.github/workflows/golden-eval-ratchet.yml','utf8'); if(!/run-golden-eval|tests\/gp\/f1/.test(c)||!/pull_request/.test(c)) process.exit(1); console.log('OK')"
npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts -t "空金标集" --reporter=basic 2>&1 | grep -qE "Tests +[1-9][0-9]* passed"
```
**硬阈值**: workflow 引用 runner + tests/gp/f1 + pull_request 触发；空集必抛错。

---

## 已知约束

- `[回归测试]` 既有 `tests/gp/f1/step3-judge-*.test.js`（判定器机械闸/覆盖/延迟等）为本域回归，本 sprint 只**新增**金标集与闸，不改 judge 逻辑，既有 judge 用例必须保持绿。
- `[回归测试]` `packages/brain/src/harness-judge.js` 现有单测（`__tests__/harness-judge*.test.js`）不得回归；本 sprint 不 import/改动该文件。
- `[ratchet 现状]` `scripts/ratchet-registry.json` 现有 5 项（orphans/permanent_tests/bare_fr/seven_ring_hard_flaws/smoke_pool）；新增 `golden_eval_pass_rate` 必须**追加**，不得改动/删除既有项，且 `ratchet-guard.mjs` 现有 measure() case 全保留。
- `[累积FR]` context-manifest: unavailable —— 本 sprint runtime_resources.postgres=false，Brain 未起，`/api/brain/line/<journey_id>/context-manifest` 不可达；PRD「累积 FR」段本 line 暂无已验收历史，无回退风险。

---

## 历史约束三源（EVA v2）

1. **铁律 → INV 覆盖**（详见 contract-dod.md「Invariant 覆盖」段）：
   - [DIRTY-rebase] → **N/A**：本 sprint 不触及 PR 冲突路由 / generator-fix，纯 eval 测试基建。
   - [凭据不混用] → **N/A**：本 sprint 无跨账号凭据 / 他人资源操作。
   - 另将 PRD 4 条 NFR 铁律映射为 INV 条目（fail-closed / 缓存零视觉 / 阈值单调 / 契约完备），见 DoD。
2. **累积 FR**：context-manifest unavailable（见「已知约束」），本 line 无已验收历史。
3. **回归测试约束**：见「已知约束」的 step3-judge-* / harness-judge 单测。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | 金标集 v0 落库 + eval 算通过率 + 只升不降棘轮 + 4 条纯代码用例，全部进 CI 阻塞闸 |
| **NFR（做得多好）** | 性能/可靠性 | 全部纯代码确定性，eval + 4 用例单次运行 < 10s；无网络/无 DB/无视觉调用（CI 内以参考判定驱动）|
| **Invariant（永不违反）** | 不变量 | ①视觉/判定 null → 必 FAIL（不 fail-open）②缓存命中路径视觉调用计数 == 0 ③通过率阈值只升不降 ④技能契约必含 pre+post+side_effects |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 金标集 v0 为基线数据集，无 TTL；阈值水位随 judge 改进单调上调，不退役；v1 扩样在本 sprint 范围外 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | eval job 是 PR required check，job 消失/长期 skip → PR 无法合并即暴露；ratchet-guard 已在 ci.yml 装配，措辞不改则常驻 |
| **失败语义（挂了怎么办）** | 故障行为 | 见下方失败语义声明（全部 fail-closed）|
| **效果确认（已发≠已生效）** | 回执确认 | eval 结果（passRate / 当前 watermark / failures[]）落 CI 日志 + `run-golden-eval.mjs` 产物 JSON，退出码驱动绿红 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 截图是否为「用户列表页」(true/false) | A. 人工标注入 ground-truth manifest; B. 让视觉判定器现场判 | A. 人工标注（v0 金标集即 ground-truth 权威）| v0 阶段以人工标注为基准真值，用来度量判定器；不让被测者自证 | 标注错误 → 阈值基准偏移 → 直接面客判错页面类型（升拍板点，见 notes）|
| ⚠️ 视觉调用超时/限流返回 null 该判什么 | A. fail-closed 判 FAIL; B. fail-open 保留乐观 verdict | A. fail-closed 判 FAIL | PRD NFR 硬约束「禁止 fail-open 假绿」| 若误判 fail-open → 判定质量退化被漏过（假绿），面客错误 |
| 通过率是否达标 | A. passRate ≥ watermark 判 PASS; B. > 判 PASS | A. ≥（边界 PASS 不上调）| PRD 边界情况「恰好等于阈值 → PASS」| 用 > 会把恰达标 PR 误判红 |

> notes: `judgment-pending-user: 金标集 ground-truth 五类标注基准`（09-05 A/B 标注由 PRD 给定，若 Owner 对某类标签有异议需在 PrepPRD/对齐会拍板）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 金标集为空 / 标签缺失 | eval 抛错，job 退非零（FAIL）| 是（纯读，无副作用）| 无降级，必须补数据集 |
| 阈值基线文件缺失/损坏 | `loadThreshold` 抛错 → fail-closed FAIL | 是 | 无降级，禁止默认放行 |
| 视觉/判定返回 null | 该 verdict 判 FAIL（fail-closed），永不计正确 | 是 | 无 fail-open 兜底 |
| 提交下调阈值水位 | `assertMonotonic` 抛错 → CI 拦截 | 是 | 无，降阈禁止合并 |

### 输入对抗面

N/A —— 本 sprint 无对外暴露 agent / 无外部可写入接口，输入均为仓库内受控 fixtures 与 CI 触发。

---

## 禁 mock 边清单

本单**被改的边**（必须真调，禁止 vi.mock/stub 顶替）：

- 代码 ↔ `evalGoldenSet` 计分逻辑（本单新增，冻结测试真调，喂真 manifest 真 judge stub 走完整计分）
- 代码 ↔ `cachedJudge` 缓存逻辑（本单新增，测试真调两次同输入，真数 `visionCallCount`）
- 代码 ↔ `checkRatchet` / `assertMonotonic` 棘轮单调逻辑（本单新增，真调断言降值抛错）
- 代码 ↔ `failClosedJudge` fail-closed 逻辑（本单新增，真调断言 null→FAIL）
- 代码 ↔ `lintSkillContract` 契约完备逻辑（本单新增，真调断言缺段→ok:false）

**允许 mock 的外层边界**：判定器视觉模型调用（judge 的实际视觉推理）—— 本 sprint 不新增视觉 provider、judge 只读被调用，测试以注入的 stub/参考判定承载视觉边界，登记进「未覆盖真实链路清单」。本单不涉及调度/状态机/跨模块生命周期钩子/DB 写路径，故无 DB/相邻 Brain 模块真调要求（postgres=false，纯 node 逻辑）。

---

## 未覆盖真实链路清单

- **真实视觉判定器对金标集现场跑分**｜为什么 mock：PRD 明确「不新增视觉模型 provider、judge 只读被调用、不改判定算法」，且 CI 无视觉 API key、视觉推理非确定性不适合做棘轮阻塞闸｜真验证补位计划：本 sprint 交付确定性参考判定（`reference-verdicts.json`）驱动棘轮机制与 4 条防退化用例；接真实视觉判定器现场跑分留待后续 sprint（当视觉 provider 落地后，`ratchet-guard.measure()` 与 runner 切换为调真实 judge），责任人：判定器质量层后续 owner，环境：CI + 视觉 provider。

---

## E2E 验收（final-e2e 跑 — target_environment = local_api，退化为 node eval runner）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无 DB（runtime_resources.postgres=false）、无 HTTP server：交付物是纯 node eval 基建。local_api 模板退化为「node 测试 runner + eval 命令」（与 PRD E2E 占位一致）。sprints/** 测试从仓库根 `npx vitest run` 由根 vitest include 覆盖，合法。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 金标集 v0 数据集完整性（5 条 / 1 true 4 false / 三字段齐）
node -e "const m=require('./tests/gp/f1/fixtures/golden-set-v0/manifest.json'); if(m.length!==5) { console.error('FAIL: 金标集非 5 条'); process.exit(1);} const t=m.filter(e=>e.label==='true').length, f=m.filter(e=>e.label==='false').length; if(t!==1||f!==4){ console.error('FAIL: 标签分布错', t, f); process.exit(1);} for(const e of m){ if(!e.id||!e.screenshot||!e.label){ console.error('FAIL: 字段缺失', e.id); process.exit(1);} } console.log('OK 金标集 v0:', t, 'true', f, 'false')"

# 2. 冻结合同用例全绿（eval 计分 + 棘轮 + 4 条纯代码用例 + 空集 fail-closed）
npx vitest run sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts --reporter=basic 2>&1 | tee /tmp/golden-eval-e2e.log
grep -qE "Test Files +1 passed" /tmp/golden-eval-e2e.log || { echo "FAIL: 冻结合同用例未全绿"; exit 1; }
grep -qE "Tests +7 passed" /tmp/golden-eval-e2e.log || { echo "FAIL: 冻结用例数不足 7"; exit 1; }

# 3. tests/gp/f1 永久回归用例（generator port 的 4 条纯代码用例 + eval 用例）
npx vitest run tests/gp/f1/ -t "金标集|棘轮|fail-closed|契约完备|序列固化|缓存零视觉" --reporter=basic 2>&1 | tee -a /tmp/golden-eval-e2e.log
grep -qE "Tests +[1-9][0-9]* passed" /tmp/golden-eval-e2e.log || { echo "FAIL: tests/gp/f1 永久回归未过"; exit 1; }

# 4. eval runner 真跑：算出通过率并校验 ≥ 入库阈值（阈值文件损坏应 fail-closed）
node tests/gp/f1/eval/run-golden-eval.mjs --out /tmp/eval-report.json
node -e "const r=require('/tmp/eval-report.json'); if(typeof r.passRate!=='number'||typeof r.watermark!=='number'){ console.error('FAIL: 报告字段缺失', JSON.stringify(r)); process.exit(1);} if(!(Math.round(r.passRate*100) >= r.watermark)){ console.error('FAIL: 通过率', r.passRate, '< 水位', r.watermark); process.exit(1);} console.log('OK passRate', r.passRate, '>= watermark/100', r.watermark)"

# 5. 棘轮 registry 装配（golden_eval_pass_rate only_up）+ 降阈拦截语义（assertMonotonic）
node -e "const r=require('./scripts/ratchet-registry.json'); const g=r.find(x=>x.name==='golden_eval_pass_rate'); if(!g||g.direction!=='only_up'||typeof g.watermark!=='number'){ console.error('FAIL: registry 未装配 golden_eval_pass_rate only_up'); process.exit(1);} if(r.length<6){ console.error('FAIL: 既有 registry 项被删'); process.exit(1);} console.log('OK ratchet registry watermark', g.watermark)"

# 6. CI workflow 存在且引用 runner + tests/gp/f1 + pull_request 触发
node -e "const c=require('fs').readFileSync('.github/workflows/golden-eval-ratchet.yml','utf8'); if(!/run-golden-eval|tests\/gp\/f1/.test(c)||!/pull_request/.test(c)){ console.error('FAIL: workflow 未正确装配 eval job'); process.exit(1);} console.log('OK golden-eval workflow')"

echo "✅ Golden Path 验证通过（金标集 v0 + eval 棘轮 + 4 条纯代码用例 + CI job）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `manifest.json` 某条 `label` 写成非法值（如 `"maybe"` / 大写 `"TRUE"` / 数字 `1`）→ eval 应报错或计不正确，不得静默当 false 处理判绿。
- 错输入: `threshold.json` / watermark 写成负数、字符串、超过 100 → runner 应 fail-closed 报错，不得默认放行。
- 重复提交: 连续两次跑 `run-golden-eval.mjs`，结果与退出码应完全一致（确定性，无随机）。
- 中途中断: eval 跑到一半删除某张截图文件 → 应报缺文件 FAIL，不得跳过该条压低样本数判绿。
- 边界值: passRate 恰等 watermark → PASS 不上调；passRate = watermark - 1(×100) → FAIL；空 manifest / 全 null verdict → FAIL。
- 单调性绕过: 直接改 `ratchet-registry.json` 把 watermark 从 100 改 80 提交 → assertMonotonic / git base 比对应拦截（降阈 FAIL）。
发现分级: P0/P1（假绿：null 判 PASS / 空集判绿 / 降阈放行 / 缓存仍触发视觉调用）→ 阻塞 merge；P2/P3（日志措辞、报告字段冗余）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 判定器金标集 v0 + eval 棘轮 + 4 条纯代码用例（冻结合同测试）| `sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts` | 通过率可算出且 ≥ 入库阈值 / 降阈提交被棘轮拦截 / 缓存命中二次判定视觉调用计数为 0 / 视觉返回 null 必 fail-closed 判 FAIL / 契约缺 pre/post/side_effects 任一段触发 lint FAIL / 判定步骤序列固化不漂移 / 金标集为空 | import `harness-visual-eval.mjs` 失败 → 1 failed（Failed to load url，实测已确认 RED）|
| 永久 CI 回归（generator port，与既有 step3-judge-* 同域）| `tests/gp/f1/step5-golden-eval-ratchet.test.js` | 通过率可算出且 ≥ 入库阈值 / 降阈提交被棘轮拦截 / 缓存命中二次判定视觉调用计数为 0 / 视觉返回 null 必 fail-closed 判 FAIL / 契约缺 pre/post/side_effects 任一段触发 lint FAIL / 判定步骤序列固化不漂移 | 同上（模块缺失）→ N failures |

> Test File 死规则合规：本 sprint 冻结测试写完整真实路径 `sprints/09052347-kernel-a54539fd/tests/golden-eval-gate.test.ts`（已落盘并进 commit）；`tests/gp/f1/step5-golden-eval-ratchet.test.js` 为 repo 既有域**补充行**（generator port 的永久回归，满足 PRD「4 条纯代码用例落 tests/gp/f1/」+ bug-fix 死规矩）。
> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串（如 it 名 `B-01 eval 金标集 v0 通过率可算出且 ≥ 入库阈值` ⊇ 覆盖名 `通过率可算出且 ≥ 入库阈值`）。
