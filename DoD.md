# Workspace跨仓CI固定来源验收

- [x] [BEHAVIOR] workspacecisourcebundle：真实固定Git来源提取两准确caller/reader、同BrainSHA的callee/job源码与hash，严格既有F3身份；source集合不混repo/revision，未知来源及协议缺口拒认、始终不可执行。
  Test: manual:node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs

# PRD / DoD：nightly 固定配置验证消费关系

任务：4e2318be-42d3-482b-9c38-4b9290727b05；父任务：dffd5885-46f7-4cf1-b55b-8729497b9928。

nightly 配置由真实测试读取和 YAML parse，却无法在来源门禁表达这一验证消费关系。本刀只增加 verification_config：输入仅 ci.yml 与 nightly-regression.yml，owner 与 consumer 只能是精确 nightly-runtime.test.mjs。固定 Git SHA 冻结 reader、配置与 CI 的摘要；公开 ESLint AST 核真实导入绑定、root 及读取表达式，实际 CI 必须永久 node --test 并由 ci-passed 汇总。

reader 的角色身份不授予业务归属。必须已有真实 F3 frozen consumer_evidence 图认领，否则继续 UNKNOWN；不借 loader 或任意 JS。其余既有角色继续拒绝 test/spec 父模块。初始机制 PR 不携带新关系自授权，只沿用正式 current assertion 的真实测试引用与原生 imports。

只改 CI collector 与永久回归；没有 Brain runtime、版本静态修改或依赖新增。版本继承主线，保持现行发布策略。

- [x] [BEHAVIOR] nightlyconfigproof 固定 Git 真实 reader/CI 消费链获得独立辅助证据，缺图认领仍 UNKNOWN；摘要、范围、模块/变量 shadow、注释/字符串、死分支、任意 YAML/SQL、跨仓库与伪 CI 调用全部拒绝，执行入口重算同 SHA。
  Test: manual:bash -c "cd packages/brain && npx vitest run scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] nightlyconfigcompat 普通辅助角色、release 精确消费与原有治理语义保持；事实、版本同步及 DoD 映射一致。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/implementation-ci-gate.test.js src/lib/__tests__/implementation-ci-governance.test.js src/__tests__/auto-version-apply.test.js --maxWorkers=1 --minWorkers=1 && cd ../.. && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs DoD.md"
