# Sprint PRD — tick.js 中 TICK_LOOP_INTERVAL_MS 注释说明单位

## OKR 对齐

- **对应 KR**：代码可读性 / 文档化 KR（细节级文档补强）
- **当前进度**：未知（小颗粒任务，不显著推动 KR 百分比）
- **本次推进预期**：~0%（属于持续维护性补强，不计入 KR 数字进度）

## 背景

`packages/brain/src/tick.js` 在 import 块中 re-export 了 `TICK_LOOP_INTERVAL_MS` 常量（来自 `tick-loop.js`），但本文件内对该常量没有任何关于单位的说明。读 tick.js 的人需要跳到 tick-loop.js 才能确认单位是毫秒（ms）而不是秒或分钟。这种隐式约定在代码维护时（尤其是新人或外部 agent 首次接触 Brain tick 子系统时）容易引发误读和单位换算 bug。

本 Sprint 在 tick.js 中 `TICK_LOOP_INTERVAL_MS` 出现处补一行注释，明确说明单位是毫秒，让 tick.js 读者无需跳源就能正确理解常量含义。

## Golden Path（核心场景）

开发者打开 `packages/brain/src/tick.js` 阅读 → 看到 `TICK_LOOP_INTERVAL_MS` 出现处旁有一行中文注释明确说明"单位：毫秒（ms）" → 立刻理解该常量数值的单位含义，无需跳到 `tick-loop.js`。

具体：
1. **触发条件**：开发者/agent 在 IDE 或 GitHub 上查看 `packages/brain/src/tick.js`。
2. **系统处理**（这里指代码静态形态）：tick.js 中 `TICK_LOOP_INTERVAL_MS` 的 import 或 re-export 行附近存在一行注释，文字明确包含"毫秒"或"ms"字样。
3. **可观测结果**：在 tick.js 文件中 grep `TICK_LOOP_INTERVAL_MS` 周围 ±2 行可以看到包含"毫秒"或"ms"的中文/英文注释。

## 边界情况

- **多次出现**：tick.js 中 `TICK_LOOP_INTERVAL_MS` 出现 2 次（import 块 ~line 58 + export 块 ~line 160）。只需在最显眼的位置（import 块）加一行注释即可，无需重复在 export 块再加。
- **常量定义不在 tick.js**：实际定义在 `tick-loop.js`，本任务不修改 `tick-loop.js`，只在 tick.js 这个 re-export 文件里补注释（验收标准明确指向 tick.js）。
- **不修改逻辑**：任务范围严格限定为"加一行注释"，不允许改任何运行时行为、import 顺序、变量名等。

## 范围限定

**在范围内**：
- 在 `packages/brain/src/tick.js` 中 `TICK_LOOP_INTERVAL_MS` 出现处（建议 import 块附近）添加一行说明单位的注释。
- 注释必须明确包含"毫秒"或"ms"字样。

**不在范围内**：
- 不修改 `packages/brain/src/tick-loop.js`（即使常量真正定义在那里）。
- 不给其他常量（`TICK_INTERVAL_MINUTES`、`TICK_TIMEOUT_MS`）加注释（虽然它们也有相同问题）。
- 不重命名常量（如改成 `TICK_LOOP_INTERVAL`）。
- 不调整任何运行时逻辑、import 顺序、export 形式。
- 不动测试。

## 假设

- [ASSUMPTION: 注释语言用中文为主（与项目既有注释风格一致），但同时保留 "ms" 字样以便英文读者识别。]
- [ASSUMPTION: 在 import 块（line ~58）附近添加注释比在 export 块（line ~160）更优，因为读者通常从文件顶部读起，import 块是常量首次出现位置。]
- [ASSUMPTION: 不需要 JSDoc 风格 `/** */`，单行 `//` 注释即可，与该文件现有注释风格一致。]

## 预期受影响文件

- `packages/brain/src/tick.js`：在 `TICK_LOOP_INTERVAL_MS` 出现处（约 line 58 import 块内）追加一行注释说明单位。新增 1 行，不删除/修改任何现有行的语义。

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 内部代码注释补强，无 UI、无 hooks、无远端 agent 协议变更，属于 Brain 自治子系统的内部可读性维护。
