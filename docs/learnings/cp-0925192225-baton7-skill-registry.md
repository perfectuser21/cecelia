## getSkillForTaskType 改查 skill_registry（2026-09-25）

task 9917a588 ｜ 链 bf5088a3 棒7 ｜ 决策 105a5868

### 根本原因

- **账本只展示不参与执行**：`executor.getSkillForTaskType` 只读硬编码 `EXECUTOR_SKILL_MAP`，`skill_registry` 与 `ops_skills` 只被展示与对账读取——改账本不改执行，账实必然分叉。
- **同步签名挡住了直接查库**：`getSkillForTaskType` 是同步函数，被多处测试与调用方直接使用；把它改 async 会波及全链。解法是保持同步、读进程内快照，由本来就 async 的 `preparePrompt` 在解析前刷新快照。
- **快照要为派发热路径负责**：TTL、并发共享在途查询、查询超时、失败保留旧快照并退避，缺一个就会在账本故障时拖垮派发。
- **只有走默认 prompt 的类型受账本驱动**：`initiative_plan`/`prd_review` 等有专属 prepare 函数的类型自带硬编码 skill 字符串，本刀不覆盖，需要后续把它们的 skill 也改成读解析结果。

### 下次预防

- [ ] 任何"账本 vs 代码常量"的双写点，先问执行时读哪边；只读常量的账本就是展示品，必须改成账本优先、常量兜底并对漂移告警。
- [ ] 热路径读库一律走"进程内 TTL 快照 + 超时 + 失败开放"，禁止逐任务查库，并写 TTL 内只查一次的测试。
- [ ] 给共享账本加列做回填时，测试要把迁移 SQL 里的回填清单与代码常量逐项比对，防止起点就漂移。
- [ ] 让一份既有告警测试（"无 AMBER 不误报"）通过时，应让其 mock 返回"账本与常量一致"的数据，而不是放宽断言；空账本本身就该报 AMBER。
- [ ] `task-type-registry.guard` 按行号登记 `_TASK_ROUTES`，改 `executor.js` 上半部分行数会让它红，需同步更新豁免行号。
