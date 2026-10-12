## 本仓库规矩（cecelia）

仓库 perfectuser21/cecelia（Cecelia monorepo）。CI 的规矩（提交后程序会在本地先跑一遍这些门禁，没过会要求修；一次写对最省事；门禁脚本在 .github/workflows/scripts/ 下，看不懂日志就读脚本）：
- lint-test-pairing：新增或修改的 packages/brain/src/**/*.js 必须有配套测试（同目录、__tests__/ 或 __tests__/integration/），测试要真引用被测模块、有真实断言。
- lint-feature-has-smoke：需求标题不是以「修复」开头的，这个 PR 会以 feat 合入：只要改了 packages/brain/src 的非测试文件，就要新增 packages/brain/scripts/smoke/<名字>.sh（至少 5 行真实代码，真的用 curl/psql/node 等验证改动），并登记进 packages/quality/smoke-allowlist.txt（如该文件存在）。
- lint-tdd-commit-order：按提交顺序，改 src 的提交之前必须已有带真实测试的提交（同一个提交里同时有测试和实现也算）。顺序不对时不要改写历史，改为在新提交里补齐测试使后续提交满足规则。
- lint-test-quality / lint-no-fake-test / lint-no-mock-only-test：新增测试要有真实断言（不能全是 toBeDefined 之类的弱断言）、不能全是 skip、不能靠大量 mock 撑着。
- branch-naming / pr-size-check：改动规模相对 main 新增不超过 3000 行；分支名和改动规模问题无法靠改代码解决时，在最终回复里说明原因即可，不要做无关改动。
- 版本：不碰版本五件套；改 packages/brain/src 的 PR 由 publish 自动带 changes/<分支>.md 版本碎片，不要自己写。
- 数据库迁移：main 新增的迁移和本 PR 的迁移用了同一个编号（packages/brain/migrations/NNN_*.sql）时，把本 PR 的迁移用 `git mv` 顺延到 main 之后第一个空闲编号，并同步改引用它的测试、回滚文件和 selfcheck 期望版本。
- runner 生成的 QA 回归 smoke：packages/brain/scripts/smoke/cw-*-qa-smoke.sh 由 runner 按 QA 报告固化，勿手改、勿删除。
- CI 跑在 Linux，本机是 macOS：shell、sed、date、bash 版本差异要按 Linux 行为修。

QA 环境（写 02 的 QA 场景时遵守）：
- QA 在这个 PR 的预览环境里验收（PR 版本真实跑起来的 Brain，含 Dashboard、跑过迁移、隔离的数据库副本）。
- 每个 Q-n 的前提必须由场景自己造出来（先建再查、先写再读），不依赖环境里已有的数据：QA 通过后这些场景会被固化成回归 smoke，在 CI 的空库上跑。
- QA 场景里不要写死服务地址，尤其不能写 `localhost:5221`（那是生产 Brain，QA 碰了会被判违规）：一律写成 `<预览环境>/api/brain/...`，QA 会换成这个 PR 的预览环境地址。
- 需要和「改动前」对比的回归场景，写明基线由 QA 在本机从 main 起（不能拿生产当基线）；能用预览环境里的已知数据直接断言的，优先直接断言、不做双端对比。
