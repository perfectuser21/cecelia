## 本仓库规矩（cecelia）

仓库 perfectuser21/cecelia（Cecelia monorepo）。提交后程序在worktree里依次执行以下必需检查，缺入口或非零退出都会进入修复环；日志指向的真实脚本是排查依据：
- 开工门：`node scripts/facts-check.mjs` → `bash scripts/check-version-sync.sh` → `node scripts/devgate/check-dod-mapping.cjs`。
- 当前PR CI脚本层：`node scripts/ci/run-basic-check.mjs scripts`，与CI共用同一入口，执行现代开发工具回归、事实/版本、迁移编号及Skill来源ownership检查。
- 安全与版本：保留 `node --test packages/brain/scripts/smoke/__tests__/smoke-production-guard.node-test.mjs` 和真实Brain版本增量检查。不能通过修改权限、来源校验或生产边界使检查通过。
- 行为回归：修复bug先写可复现的失败测试，修好后永久保留。围绕被改业务的真实不变量写断言，可以复用现役测试覆盖。测试组织不要求源文件与测试文件同名；需求类型不决定必须新增smoke。删除重复或无效测试时确认独有行为覆盖和实际执行入口，避免为了满足命名或数量制造stub。
- 本地预检成功只证明上述检查；完整PR CI、隔离预览QA及来源资格仍按各自真实结果判定。
- 版本：改 packages/brain/src 必须在实现与验收阶段同步升高Brain package、嵌套lock、根workspace lock、.brain-versions和DEFINITION版本。相对目标main必须有真实版本增量；changes/碎片不能替代升版。publish只读校验，失败后修真实候选并重新验收。
- 数据库迁移：main 新增的迁移和本 PR 的迁移用了同一个编号（packages/brain/migrations/NNN_*.sql）时，把本 PR 的迁移用 `git mv` 顺延到 main 之后第一个空闲编号，并同步改引用它的测试、回滚文件和 selfcheck 期望版本。
- runner 生成的 QA 回归 smoke：packages/brain/scripts/smoke/cw-*-qa-smoke.sh 由 runner 按 QA 报告固化，勿手改、勿删除。
- CI 跑在 Linux，本机是 macOS：shell、sed、date、bash 版本差异要按 Linux 行为修。

QA 环境（写 02 的 QA 场景时遵守）：
- QA 在这个 PR 的预览环境里验收（PR 版本真实跑起来的 Brain，含 Dashboard、跑过迁移、隔离的数据库副本）。
- 每个 Q-n 的前提必须由场景自己造出来（先建再查、先写再读），不依赖环境里已有的数据：QA 通过后这些场景会被固化成回归 smoke，在 CI 的空库上跑。
- QA 场景里不要写死服务地址，尤其不能写 `localhost:5221`（那是生产 Brain，QA 碰了会被判违规）：一律写成 `<预览环境>/api/brain/...`，QA 会换成这个 PR 的预览环境地址。
- 需要和「改动前」对比的回归场景，写明基线由 QA 在本机从 main 起（不能拿生产当基线）；能用预览环境里的已知数据直接断言的，优先直接断言、不做双端对比。
