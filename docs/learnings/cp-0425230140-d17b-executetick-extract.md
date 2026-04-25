# Learning: Brain v2 D1.7b — executeTick 抽到 tick-runner.js

**日期**：2026-04-25
**分支**：cp-0425230140-d17b-executetick-extract
**Phase**：Brain v2 Phase D1.7b（接 D1.7a tick-state 之后）

## 概述

把 `packages/brain/src/tick.js` 的 `executeTick` 函数体（L662-L2287，1626 行）整体搬到新文件 `tick-runner.js`。tick.js 通过 `import { executeTick } from './tick-runner.js'` re-export，老 caller 全部不动。

tick.js 从 2427 行缩到 803 行，瘦身 67%。

## 根本原因（为什么要拆）

D1.7+ 系列拆分目标：把 tick.js 拆成"调度入口（tick.js）+ 主循环（tick-runner.js）+ 共享状态（tick-state.js）+ 可插拔 plugins（D1.7c）"。

executeTick 是 brain 的自驱核心循环，里面调度 30+ scheduled job。当前函数体 1626 行，无法独立测试、无法局部替换、无法做 plugin 注册。先搬家是后续 D1.7c 拆 plugin 的前置条件——plugin 是按"插槽"挂在 executeTick 里的，必须先把"插槽容器"独立出来。

## 关键设计：避免循环 import 触发 vite TDZ

第一版尝试做循环 import：

```
// tick.js
import { executeTick } from './tick-runner.js';
// tick-runner.js
import { tickLog, MINIMAL_MODE, ... } from './tick.js';
```

理论上 ES module 循环 import + 函数体内的 call-time 引用是安全的（live bindings）。**实际上在 vite/vitest 下触发 ReferenceError**：vite 把 export 转译成 getter，circular import 时 getter 在 TDZ 阶段被访问，致 `Module.get [as _dispatchViaWorkflowRuntime]` 类报错——一片 mock-tick 测试假阴性（93 fail / 7100 pass）。

**根因**：vite 的 transformer 在做 ESM-to-internal-format 转换时对循环依赖的处理与 Node native ESM 不一致。Node 下 `node -e "import('./tick.js')"` 完全 OK，vite/vitest 下炸。

**修复**：tick-runner.js **本地重新定义** tickLog / isStale / logTickDecision / incrementActionsToday + 21 个常量（MINIMAL_MODE / TICK_INTERVAL_MINUTES / 各种 INTERVAL_MS），与 tick.js 的同名定义等价（process.env 派生 + 字面量，读出来同值）。tick-runner.js → tick.js 这条边被切断，没了 cycle。

**代价**：常量重复定义。修改时需双改。后续 D1.7c 拆 plugin 时考虑统一到 tick-state.js。

## 关键约束（从 D1.7a 继承 + 本次新增）

1. **tick.js re-export 保兼容**：19 个 `vi.mock('../tick.js')` 测试不需要改 mock 路径，老 caller 透明
2. **不动 executeTick 函数体的语义**：纯搬家，0 行业务逻辑改动
3. **不动 30+ scheduled job 调用**：D1.7c 才拆 plugin
4. **不要做循环 import**：vite TDZ 坑（本次教训）

## 下次预防

- [ ] D1.7c 拆 plugin 时，把 tick-runner.js 与 tick.js 的常量重复消除——统一搬到 tick-state.js（注：tick-state.js 当前只有可变状态，常量可以单独建一个 tick-config.js）
- [ ] 任何在 brain 包内做 ES module 循环 import 时，**先用 vitest 跑 5 个相关 mock-tick 测试验证**，不要相信"理论上 ES module 循环安全"——vite/vitest 对 circular 处理有细节坑
- [ ] vitest 报 `Module.get [as XXX]` 类 ReferenceError 时，第一反应想到 circular import + vite TDZ，不要先怀疑 mock 不全或 import 路径错

## D1.6 hotfix 教训复用

PR 前 grep 全 caller：

```bash
grep -rn "from './tick.js'" packages/brain/src/ --include="*.js" | grep -v node_modules
grep -rn "vi\\.mock" packages/brain/src/__tests__/ | grep tick
```

确认本 PR：
- 仅 tick.js self-ref + 1 处 tick-runner.js 注释 mention
- 28 个测试 vi.mock('../tick.js')，全部由 re-export 兼容（不需改 mock 路径）

## 数据点

- tick.js: 2427 → 803 行（-67%）
- tick-runner.js: 0 → 1843 行（new）
- tick-state.js: 68 行（D1.7a，未改）
- 总行数变化：+219 行（重复定义 + DoD/PRD/Learning 注释开销）
