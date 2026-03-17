## vitest 分组并行优化（2026-03-17）

### 根本原因

vitest `fileParallelism: false` 是全局开关，没有提供按文件路径分组的原生方式来差异化并行控制。
解决方案是使用 vitest 3.x 的 `projects` 配置（workspace mode），每个 project 独立控制 `poolOptions.forks.singleFork`：

- parallel project：不设 singleFork，默认并行（18 个无 shell 依赖文件）
- serial project：`singleFork: true`，强制串行（39 个有 git/shell 竞争文件）

关键发现：
1. `fileParallelism` 在 vitest 类型系统中是 `NonProjectOptions`，**不能**在 project 级别设置——需要改用 `poolOptions.forks.singleFork`
2. project 内的配置（`globals`、`environment`）不会自动继承根配置，需要在每个 project 中显式重声明，否则会出现 `beforeEach is not defined` 错误
3. `devgate/l2b-check.test.ts` 在扫描时被误判为 CLEAN（grep 只匹配 `child_process` 关键词），但实际无 shell 命令，并行运行结果正常

### 下次预防

- [ ] 修改 vitest 配置前，先通过 `grep -l "execSync\|exec(\|spawn\|child_process"` 精确扫描依赖，不要遗漏 vitest 配置继承问题
- [ ] 在 vitest `projects` 模式下，每个 project 必须显式声明 `globals: true` 和 `environment: 'node'`，根级别配置不会自动继承
- [ ] 使用 vitest projects 时，per-project 的并行控制应通过 `poolOptions.forks.singleFork`（而非 `fileParallelism`，后者不可在 project 级别设置）
- [ ] 分析测试文件 shell 依赖时，排除 main 分支上已存在的测试失败（`pr-gate-phase1.test.ts`），不要因为已知 bug 浪费调查时间
