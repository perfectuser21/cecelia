# DoD：Cecelia 最小可靠 CI

- [x] [BEHAVIOR] 意图识别与判级的同环境副本归并，原有58项独有回归语义及默认组件入口保留。
  Test: manual:bash -c 'cd apps/api && npx --no-install vitest run tests/intent-recognizer.test.ts'
- [x] [BEHAVIOR] 账龄测试调用真实实现，保留F6回归并覆盖计数、重试参数、间隔和错误；三份空骨架退出执行，代表性错误变体可被拦住。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/capture-aging.test.js'
- [x] [BEHAVIOR] Dashboard全景测试导入真实组件，验证轮询、可见数据和边界，删除内联实现与副本，错误组件变体必须失败。
  Test: manual:bash -c 'cd apps/dashboard && npx --no-install vitest run src/pages/live-monitor/OpsPanoramaCard.test.tsx'
- [x] [BEHAVIOR] 已消失实现对应的旧常量、watcher与图线程停用合同退役；当前orchestrator拒绝和禁止旧运行时复活的真实回归仍通过。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/harness-orchestrator-lockdown.test.js src/__tests__/dispatcher-dev-no-langgraph.test.js'


- [x] [BEHAVIOR] 能力向量、分拣和Radius原骨架执行真实CLI/任务写入/回退行为，错误变体实际失败，重复triage副本归并。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/generate-capability-embeddings.test.js src/routes/__tests__/capture-triage-routes.test.ts ../../tests/regression/radius-rerun-gate/'
- [x] [BEHAVIOR] 现役system API的45项合同通过私有scratch schema和随机HTTP端口实际执行，缺DB不能静默通过。
  Test: manual:node scripts/ci/run-basic-check.mjs api-integration
- [x] [BEHAVIOR] 字面量自比较被真实清单守卫拒绝，源码/runner变更选中API PG且所有检查归总；缺命令/空集合仍失败。
  Test: manual:node --test scripts/ci/__tests__/basic-test-assertions.test.mjs scripts/ci/__tests__/basic-scope.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/run-basic-check.test.mjs
- [x] [BEHAVIOR] 通知缓存、实际预算路由、诊断结算、GTD请求与进度边界不再测试复制实现，代表性真实源码内存变体能报错。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/notifier-memleak.test.js src/__tests__/dual-capacity.test.js src/__tests__/executor-diagnostics.test.js src/__tests__/progress-ledger.test.js'
- [x] [BEHAVIOR] 旧alertness规格归并到现役行为并同步注册表，OOM退出码写回由真实HTTP路由永久回归。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/alertness/ src/alertness/__tests__/ src/__tests__/oom-aware-retry.test.js src/routes/__tests__/relay-exit-code.test.js'
- [x] [BEHAVIOR] 意识副作用必须位于启用分支，空if/注释/else不能骗过守卫；非LLM扫描按现行政策运行。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/tick-consciousness-guard.test.js'
- [x] [BEHAVIOR] provenance夹具只复用不可变初始快照，每例私有Git且并发push互不污染，原断言与真实登记链保留。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run scripts/coding-workflow/__tests__/record-provenance.test.mjs scripts/coding-workflow/__tests__/directory-snapshot.test.mjs'


- [x] [BEHAVIOR] 两份watchdog crisis过期平台fixture已修复并接回默认CI，API巡查skip改为隔离真实子进程；预算/RSS边界/启动保护与派发参数错误变体实际失败。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/watchdog-crisis-kill.test.js src/__tests__/watchdog-crisis-min-rss.test.js'
- [x] [BEHAVIOR] 27份被误排除的隔离测试恢复默认执行；额度耗尽保留真实隔离保护，内容孤儿恢复直接调用executor，副本和已退役initiative旧规格归并到现役安全守卫。
  Test: manual:bash -c 'cd packages/brain && npx --no-install vitest run src/__tests__/quota-exhausted.test.js src/__tests__/content-pipeline-orphan.test.ts src/__tests__/initiative-closer.test.js'
- [x] [BEHAVIOR] 剩余69份未被自动配置接收的测试逐项登记；真实配置和工作流接线决定接收集合，新增遗漏、重复、已恢复、不存在和手动配置冒充自动均失败。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-test-debt.test.mjs

- [x] [BEHAVIOR] 范围选择采用真实 Git 差分，完整组件执行；未知/无效/空范围不静默放行。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs
- [x] [BEHAVIOR] 发布快照、跨仓、技能与巡查的四份原生来源机制入口迁入必需来源检查，包含基线选择与只读就绪回归；失败先阻止后续准入。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/implementation-main-snapshot.test.mjs scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs scripts/ci/__tests__/implementation-skill-source.test.mjs scripts/ci/__tests__/device-patrol-governance.test.mjs
- [ ] [BEHAVIOR] CodeQL正式扫描解除本PR新增的两条告警；配置文件名不触发指数回溯，测试Shell路径仅经参数传递，保留参数、退出码与清理回归。
  Test: manual:bash -c 'gh pr checks cp-10302220-ci-minimum --repo perfectuser21/cecelia --json name,state,link'
- [x] [BEHAVIOR] 测试异常、信号、空集合、取消和跳过均被真实入口与最终汇总阻断。
  Test: manual:node --test scripts/ci/__tests__/run-basic-check.test.mjs scripts/ci/__tests__/basic-results.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-npm-test.test.mjs
- [x] [BEHAVIOR] 漏洞扫描缺少有效报告或工具异常必须失败，原安全级别和已登记例外保留。
  Test: manual:node --test scripts/ci/__tests__/basic-dependency-audit.test.mjs
- [x] [BEHAVIOR] 真实审计拦截的 follow-redirects 1.16.1 升级到兼容修复版1.16.2，保留漏洞拦截与既有例外边界。
  Test: manual:bash -c 'bash scripts/ci/dep-audit-runtime-high.sh && bash scripts/ci/dep-audit-critical.sh'
- [x] [BEHAVIOR] 既有 Ops、部署、Runner 和预览行为回归有真实执行入口；关键类别为空失败，实际完整集合通过。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [x] [BEHAVIOR] 只读部署诊断不能写共享部署状态或结算retention；真实部署成功、失败出口保持原结算。
  Test: manual:bash scripts/__tests__/brain-deploy-sha-readonly.test.sh
- [x] [BEHAVIOR] 本地准备检查实际执行对应lint/typecheck/build与CI自检，缺入口、工具、差分基线或命令异常阻断；合法pending映射可通过，互斥锁保留，完整组件测试仍由GitHub验收。
  Test: manual:bash -c 'cd packages/engine && npx --no-install vitest run tests/scripts/quickcheck-preflight.test.ts tests/devgate/quickcheck-dod-guard.test.ts tests/scripts/quickcheck-mutex.test.ts'
- [x] [BEHAVIOR] 外置正文合同有固定来源恢复/校验/实跑入口及真实输入触发，原生混合断言留在默认CI；历史来源fixture不授予当前候选资格。
  Test: manual:node --test scripts/ci/__tests__/basic-skill-source-coverage.test.mjs
- [x] [BEHAVIOR] 正式迁移前拒绝生产/远端/不一致连接；新 scratch 的543条迁移后实际服务任务生命周期、防抢领、KV读写与SQL落库验收通过；SIGINT/SIGTERM中断关闭本人Brain并清理交接目录。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [x] [BEHAVIOR] 现役 API、Dashboard、Quality、MCP、Engine及Shell和Brain正式镜像已分别执行真实验证；六片Brain发现的旧接线断言逐项迁移。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] [BEHAVIOR] 深度回归实际完成完整PG集合、Walking与Map Manifest；固定历史来源机制不认领当前候选，旧连接默认与共享任务污染已消除。
  Test: manual:bash -c 'gh run list --workflow nightly-regression.yml --branch cp-10302220-ci-minimum --repo perfectuser21/cecelia --limit 3 --json headSha,status,conclusion,url'
- [ ] [BEHAVIOR] 固定候选SHA在GitHub实际运行全部选定检查并给出「源码保底通过」。
  Test: manual:bash -c 'gh pr checks cp-10302220-ci-minimum --repo perfectuser21/cecelia --required'
- [ ] [BEHAVIOR] main真实源码CI成功后发布可复验的CI专用三来源原ZIP，当前PR实际消费该基线；真实登记断言、UNKNOWN和生产用途隔离均保留。
  Test: manual:bash -c 'gh run list --repo perfectuser21/cecelia --workflow ci-admission-baseline.yml --branch main --limit 5 --json headSha,status,conclusion,url'
- [ ] [BEHAVIOR] GitHub分支保护及规则集要求源码、固定Skill、Skill所有权及来源准入四项；旧Harness/Smoke/ci-passed不再授予资格，其余保护保留并读回。
  Test: manual:bash -c 'gh api repos/perfectuser21/cecelia/branches/main/protection'
- [ ] [BEHAVIOR] PR经正常保护合并，main对应SHA的实际源码CI通过，任务账写入事实、证据和actor。
  Test: manual:bash -c 'gh run list --repo perfectuser21/cecelia --workflow ci.yml --event push --limit 5'
