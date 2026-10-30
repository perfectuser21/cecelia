# DoD：Cecelia 最小可靠 CI

- [x] [BEHAVIOR] 范围选择采用真实 Git 差分，完整组件执行；未知/无效/空范围不静默放行。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs
- [x] [BEHAVIOR] 测试异常、信号、空集合、取消和跳过均被真实入口与最终汇总阻断。
  Test: manual:node --test scripts/ci/__tests__/run-basic-check.test.mjs scripts/ci/__tests__/basic-results.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-npm-test.test.mjs
- [x] [BEHAVIOR] 漏洞扫描缺少有效报告或工具异常必须失败，原安全级别和已登记例外保留。
  Test: manual:node --test scripts/ci/__tests__/basic-dependency-audit.test.mjs
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
- [ ] [BEHAVIOR] GitHub分支保护及规则集均只认新检查，旧PR不能用旧绿灯继承资格，保护强度其余项保留并读回。
  Test: manual:bash -c 'gh api repos/perfectuser21/cecelia/branches/main/protection'
- [ ] [BEHAVIOR] PR经正常保护合并，main对应SHA的实际源码CI通过，任务账写入事实、证据和actor。
  Test: manual:bash -c 'gh run list --repo perfectuser21/cecelia --workflow ci.yml --event push --limit 5'
