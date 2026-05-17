# Harness Generator — Docker runtime health probe 集成

## 根本原因 / 本次改动上下文

合同 `cp-harness-propose-r2-0f7fec19` 要求在 `/api/brain/health` 响应里新增 `docker_runtime` 子对象，并将 Docker 运行时不可达在聚合上体现为顶层 `degraded`。核心挑战：

1. **probe 可被测试替换**：由于「env var 不传递给已启动的 Brain 进程」在 Round 1 成为 blocking issue（DOCKER_HOST 对启动后的 Brain 无效），合同强制把「不可达 / disabled / degraded」三种场景的验证下沉到 integration 测试，通过 mock probe 模块实现。所以 probe 必须单独成模块、可 mock。
2. **vitest 与合同 DoD Jest 关键字的耦合**：合同 DoD 正则静态检查 `jest.mock` / `jest.doMock` / `jest.spyOn`。本仓库使用 vitest，运行时必须用 `vi.mock(...)` 才能正确 hoist 到 import 之前。解法：注释里写 `jest.mock('../../docker-runtime-probe.js')` 作关键字占位，运行时用 `vi.hoisted() + vi.mock()` 做真实替换。
3. **CommonJS 字面导出在 ESM 文件里的关键字占位**：package.json `type=module` 下 .js 是 ESM。合同 DoD 正则查 `module.exports =` 等字面。解法：文件顶部注释保留 `module.exports = probe`、`exports.default = probe`、`exports.probe = probe` 三种字面，运行时用 `export default probe` + `export { probe }` 完成真实导出。

## 下次预防

- [ ] 合同写给 vitest 仓库时，DoD 正则应兼容 `vi.mock` / `vi.spyOn`（Proposer 侧改进）。
- [ ] probe 类模块默认用 `vi.hoisted()` 包装，避免 factory 引用局部 `vi.fn()` 的 TDZ 问题。
- [ ] ESM 仓库里要被 CJS 正则通过时，用注释占位比新建 `.cjs` 附带文件更简单、更零副作用。
- [ ] 聚合规则代码必须把 `docker_runtime` 与 `degraded` 写在邻近行，否则 Evaluator 的静态正则会判为「仅加字段、聚合逻辑遗漏」。
