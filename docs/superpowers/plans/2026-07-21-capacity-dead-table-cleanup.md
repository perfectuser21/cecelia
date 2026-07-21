# capacity.js 死码估算表清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 capacity.js 中从未生效的按 task_type 内存估算链路(死代码),防止再次误导资源决策。

**Architecture:** 纯减法重构,零行为变更——`getMaxStreams()` 的 4 个调用点全部不传 taskType,恒走 400MB 默认分支,删除后返回值不变。执行时内存保护(relay 容器 cgroup 1G 硬顶 + OOM 自动升 4G)独立于本表,不受影响。

**Tech Stack:** Node.js ESM / Vitest / Brain DevGate(facts-check + version-sync + dod-mapping)

---

### Task 1: TDD 删除死码链路

**Files:**
- Modify: `packages/brain/src/capacity.js:17-79`
- Test: `packages/brain/src/__tests__/capacity.test.js`

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/__tests__/capacity.test.js` 顶部 import 区追加一行:

```javascript
import * as capacityAll from '../capacity.js';
```

在文件末尾追加:

```javascript
describe('死码清理回归（decision 4186b574）', () => {
  it('不再导出 estimateMemPerTask（按类型估算链路已删除）', () => {
    expect(capacityAll.estimateMemPerTask).toBeUndefined();
  });

  it('getMaxStreams 不再接受 taskType 参数（arity 为 0）', () => {
    expect(capacityAll.getMaxStreams.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd packages/brain && npx vitest run src/__tests__/capacity.test.js`
Expected: 新增 2 条断言 FAIL(estimateMemPerTask 当前是导出函数非 undefined;getMaxStreams.length 当前为 1),其余原有断言 PASS。

- [ ] **Step 3: commit-1(仅测试)**

```bash
git add packages/brain/src/__tests__/capacity.test.js
git commit -m "test(brain): capacity 死码清理回归断言（红） [74535447]"
```

- [ ] **Step 4: 删码**

`packages/brain/src/capacity.js` 三处修改:

修改一——删整张表(第 17-44 行),将:

```javascript
const MEM_PER_TASK_MB_DEFAULT = 400;    // 默认小任务（propose / review / eval / fix / talk）
const MEM_PER_TASK_MB_BY_TYPE = {
  // content pipeline（2048MB tier）
  content_research: 2048,
  ...（整个对象字面量到 `};` 为止,含 briefing: 512 行）
};
```

替换为:

```javascript
const MEM_PER_TASK_MB_DEFAULT = 400; // 每并行流内存估算（排班粗算用）
// 按 task_type 细分的估算表已删除（2026-07-21 decision 4186b574）：
// 旧表是 LangGraph「每 phase 一个 Brain task」时代的遗物（harness_generator 等键
// 在现架构 30 天 task_type 分布中零出现），且所有调用方从未传过 taskType，
// 该表从未生效。现架构（harness_initiative 单 session relay）的内存由容器
// cgroup 硬顶执行时兜底（默认 1G，OOM 自动升 4G——刀A7），排班估算统一用默认值。
```

修改二——删 `estimateMemPerTask` 整个函数及其 JSDoc(原 50-60 行,从 `/**\n * 根据 task_type 估算单任务内存消耗` 到函数收尾 `}`),不留替代。

修改三——`getMaxStreams` 去参数,将:

```javascript
 * @param {string} [taskType] — 可选，按具体 task_type 估算并行数（默认按 400MB 估 dev/harness 小任务）
 */
export function getMaxStreams(taskType) {
  const cpuCount = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const memPerTask = estimateMemPerTask(taskType);

  const byCpu = Math.floor(cpuCount * TARGET_UTILIZATION / CPU_PER_TASK);
  const byMem = Math.floor(totalMemMB * TARGET_UTILIZATION / memPerTask);
```

替换为:

```javascript
 */
export function getMaxStreams() {
  const cpuCount = os.cpus().length;
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);

  const byCpu = Math.floor(cpuCount * TARGET_UTILIZATION / CPU_PER_TASK);
  const byMem = Math.floor(totalMemMB * TARGET_UTILIZATION / MEM_PER_TASK_MB_DEFAULT);
```

- [ ] **Step 5: 跑测试确认绿**

Run: `cd packages/brain && npx vitest run src/__tests__/capacity.test.js src/__tests__/decomp-capacity-gate.test.js src/__tests__/dual-capacity.test.js src/routes/__tests__/capacity-budget.test.js src/__tests__/nightly-orchestrator.test.js`
Expected: 全 PASS(新增 2 条转绿,原有断言不受影响)。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/capacity.js
git commit -m "refactor(brain): 删除 capacity.js 按类型内存估算死表 [74535447]"
```

### Task 2: DEFINITION.md 对齐 + 版本 bump + DevGate

**Files:**
- Modify: `DEFINITION.md:9`(Brain 版本行)、`DEFINITION.md:782-790`(7.1 伪代码)
- Modify: `packages/brain/package.json` / `packages/brain/package-lock.json` / `.brain-versions`

- [ ] **Step 1: DEFINITION.md 7.1 伪代码对齐代码事实**

三处(修既有失配,非本次引入):
- `MEM_PER_TASK = 500MB` → `MEM_PER_TASK = 400MB`
- `// Layer 1: 物理上限（MAX_PHYSICAL_CAP=10 兜底）` → `// Layer 1: 物理上限（MAX_PHYSICAL_CAP=20 兜底）`
- `PHYSICAL_CAPACITY = min(floor(min(USABLE_MEM / 500, USABLE_CPU / 0.5)), MAX_PHYSICAL_CAP=10)` → `PHYSICAL_CAPACITY = min(floor(min(USABLE_MEM / 400, USABLE_CPU / 0.5)), MAX_PHYSICAL_CAP=20)`

- [ ] **Step 2: 版本 bump 三处同步(当前 1.267.29 → 1.267.30)**

```bash
cd packages/brain && npm version patch --no-git-tag-version && npm install --package-lock-only && cd ../..
echo "1.267.30" >> .brain-versions
```

再把 `DEFINITION.md` 第 9 行 `**Brain 版本**: 1.267.29` 改为 `**Brain 版本**: 1.267.30`。

- [ ] **Step 3: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 三个全 PASS(facts-check 校验版本行,version-sync 校验三处一致)。

- [ ] **Step 4: commit-3**

```bash
git add DEFINITION.md packages/brain/package.json packages/brain/package-lock.json .brain-versions
git commit -m "chore(brain): bump 1.267.30 + DEFINITION 7.1 伪代码对齐代码事实 [74535447]"
```
