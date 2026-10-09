## 步级断言第四种形状「探针」：step_probes 注册表 + probe:<key>（2026-09-26）

task ddf3fe8d ｜ 链 bf5088a3 棒2 ｜ 决策 702949b6

### 根本原因

- **断言形状是硬编码白名单**：`gp-assertion-command.js classify()` 只认 vitest/pytest/smoke 三种 shell 形状，`journey-cell-assertion.js` 只认 test 路径/manual/eval/decision；业务侧「SQL 数一下 / HTTP 探一下 + 期望值」没有形状可落，获客 journey 7 个 stage 格子 assertion_ref 全空，永远翻不了色。
- **canonical 命令被 6 处消费方当"可执行"的唯一判据**：contract-schema / map-client / assertion-receipts / gap-store / harness-gates / preflight 全部经 `canonicalAssertionCommandText/Argv`。新形状若让 classify 返回却不在 canonical 层显式拒绝，会被这些闸门当成 shell 命令拼进合同。所以 probe 在 classify 层是一等形状，在 canonical 层是显式 `ASSERTION_PROBE_NOT_RUNNABLE`。
- **radius 的 unsafe 判定是"classify 说 runnable 但 canonical 抛错 = unsafe"**：probe 若不在 classify 前按前缀排除，整个 Impact Gate 会因一个探针格子判 `unsafe_assertion_ref` 冻结。
- **一格多探针**：delivery 阶段一格挂 4 条，`probe:<key>` 单 key 形状装不下；采用 `probe:<k1>,<k2>` 逗号连接（YAML 顺序），key 语法禁逗号所以无歧义。
- **`vi.resetModules()` 后中间件是另一份模块实例**：`toBe(internalAuthOrLoopback)` 必然失败，按 `.name` 比对。

### 下次预防

- [ ] 新增断言形状必须同时改三层：classify（认形状）→ canonical 命令层（非 shell 形状显式拒绝，不能靠"默认 fail"）→ radius/receipt 消费方（明确该形状进不进 must-run 清单）。
- [ ] 任何"仓库文件是 SSOT、库存投影"的表，一律存 canonical 哈希 + 提供 drift-check 端点；同步脚本默认幂等（哈希一致不写、不 bump revision）。
- [ ] 同步脚本找不到锚点（格子/step）必须报错退出，禁止"找不到就跳过"。
- [ ] 路由测试用 `vi.resetModules()` 时，中间件断言按函数名比对，不按引用。
