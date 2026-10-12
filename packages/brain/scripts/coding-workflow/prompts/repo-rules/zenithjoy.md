## 本仓库规矩（zenithjoy-workspace）

仓库 perfectuser21/zenithjoy-workspace（ZenithJoy 业务 monorepo，npm workspaces apps/*，另有 services/、scripts/）。合入 main 会自动部署生产（手机控制器到 mmv / xian-m4，apps/api 上 HK staging），所以本仓 PR 由人工合并。CI 的规矩（门禁脚本在 .github/workflows/scripts/ 与 .github/workflows/ci-*.yml，看不懂日志就读它们）：
- 测试登记（L2 Orphan Test Check）：新增的 *.test.ts / *.test.tsx / *.test.js / *.spec.ts / *.spec.tsx / *.spec.js 必须登记进根目录 test-registry.yaml（一条写 id / path / type / ci / status / product），否则 CI 必红。*.test.mjs（node --test）不受登记约束，纯 Node 脚本的测试优先用 .test.mjs。
- lint-test-pairing：新增或修改的 apps/*/src/**/*.ts（非测试）必须配套测试（同目录的同名 .test.ts、同目录 __tests__/ 下的同名 .test.ts、apps/api/tests/ 下对应相对路径的同名 .test.ts，或同名 .spec.ts）。
- lint-tdd-commit-order / lint-test-quality / lint-no-fake-test：测试提交在实现提交之前（或同一提交）；测试要有真实断言，不能全是弱断言、不能全是 skip、不能是假测试。
- 版本号：改 services/agent/src/ 必须同时 bump services/agent/package.json 的 version；改 services/agent/wechat-rpa/ 必须同时 bump services/agent/build-modules/line04/manifest.json 的 version。本仓没有 changes/ 版本碎片，其余版本由 auto-version 按提交标题前缀（feat/fix）自动 bump，不要手改。
- product-map：改了 product-map 的 yaml 或活动契约，要跑 `npm run product-map:generate` 并提交生成物；`node scripts/product-map/wf-plan.mjs --check`、`node scripts/product-map/gen-step-dod.mjs --check` 要过；registry 改动跑 `node scripts/sync-registry.cjs` 自检。
- smoke：新增 smoke 脚本（.github/workflows/scripts/smoke/ 等）必须同时加进 .github/workflows/scripts/smoke-baseline.txt（lint-smoke-baseline）；smoke-baseline.txt 删行要在 PR 正文写 `BASELINE-REMOVE:` 理由。本仓暂不由 runner 固化 QA 回归 smoke。
- 生产在 hk-vps（100.86.118.99，API :5200），设备在 mmv / xian-m4 / 真机手机上：开发、测试、修复一律不连生产、不碰真机、不发真实内容。
- CI 跑在 Linux（部分门在 windows-latest / 自托管机），本机是 macOS：shell、sed、date、bash 版本差异要按 Linux 行为修。

QA 环境（写 02 的 QA 场景时遵守）：
- 本仓第一阶段没有 PR 预览环境。QA 在这个 PR 的 worktree（本机检出的 PR 版本）里黑盒验收：运行 CLI / 脚本 / 起本地 node 进程，用测试替身（假服务、假依赖、临时目录、沙箱数据）造环境，看用户能看到的输出、退出码、生成的文件。
- 每个 Q-n 的前提由场景自己造出来（临时目录、假依赖、桩服务），不依赖本机已有数据，不连 hk-vps / 生产数据库 / 第三方平台 / 真机。
- 只放行非 UI、非真机任务。需求要靠页面（Dashboard / Electron / 浏览器 UI）或真机（安卓手机、ADB、RPA 点按、真实发布）才能验收的，local 黑盒验不了：不要硬写替代测法，在 02 正文单独写一行 `QA_UNSUPPORTED: <为什么本仓 local QA 验不了：要验的 UI 页面 / 真机动作>`，程序会把任务上交主理人（等 windows_cloud 验收车道开通）。
- QA 场景不要写预览环境地址；要和「改动前」对比的，写明基线由 QA 在本机从 main 另检出一份跑。
