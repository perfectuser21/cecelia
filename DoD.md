# PRD / DoD：固定辅助来源证据 Stage A

任务：3d715274-b5e0-4447-a6ea-3f5ff282a7de；父任务：dffd5885-46f7-4cf1-b55b-8729497b9928。

显式辅助声明验证或说明已经通过真实依赖图认领的代码模块。CI 从固定 Git SHA 冻结仓库、声明、父代码与辅助文件摘要，查询父模块真实消费者，独立核验证据。辅助关系不写入运行依赖图，不改变业务任务归属；声明不能授予未认领模块业务身份。

Stage A 仅改 CI 收集与验收脚本、真实 Git 回归。初始 PR 不携带辅助声明、不自授权；通过正式 current assertion 的真实测试引用与实际 imports 引导。Brain 源码与版本文件没有变化，保持现行版本政策。Stage B 另行补运行时报告校验，必须使用已经合入的受信工具和正规版本碎片。

必要发布配套：真实版本机器人消费 changes 碎片时，同步移除精确实际删除路径且角色为 release 的关系；其他关系原始字节保留。声明非法时在版本写入和片删除前拒绝，不放宽固定源文件存在校验。

- [x] [BEHAVIOR] auxiliaryrelease 实际机器人消费单个/多个碎片后精确移除 release 关系，保留说明、验证及未消费关系字节；非法声明、重复 JSON 键与软链接在任何片删除前拒绝，同路径其他角色缺失仍严格拒绝。
  Test: manual:bash -c "cd packages/brain && npx vitest run scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs src/__tests__/auto-version-apply.test.js --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] auxiliaryfixedsource 固定 Git 来源收集和实际验收入口核对双方摘要、仓库、SHA、方向与已认领父模块；辅助覆盖独立标识并保留原生空结果，不制造运行时 import 或业务消费者。
  Test: manual:bash -c "npx vitest run packages/brain/scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] auxiliaryfailclosed 未声明、父未认领、越界、软链接、错摘要、错 SHA、非法角色、跨仓库、反向配置、重复冲突、截断与其他原有 UNKNOWN 不能放行；真实 PR 无效上下文留下 gap 案卷。
  Test: manual:bash -c "npx vitest run packages/brain/scripts/ci/__tests__/implementation-auxiliary-evidence.test.mjs --maxWorkers=1 --minWorkers=1"

- [x] [BEHAVIOR] auxiliarycompat 已有固定实现验收与治理回归仍保持，事实、版本同步及 DoD 映射不漂移。
  Test: manual:bash -c "cd packages/brain && npx vitest run src/lib/__tests__/implementation-ci-gate.test.js src/lib/__tests__/implementation-ci-governance.test.js --maxWorkers=1 --minWorkers=1"
