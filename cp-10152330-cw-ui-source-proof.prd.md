# 固定 Git 的工作区测试来源补证

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

## 问题与最窄修复

正式 b580 快照本身完整，但旧可信工具重建遗漏 workspace-test 到 API TSX 组件的真实消费链；PR #6477 与其自然 main 门禁均以 IMPACT_MULTISCOPE_AUXILIARY_OWNER_UNKNOWN 拒绝三个 owner 的七条关系。后续 README 任务也会继承该缺口。

在真实 scanRepo 成功后的固定修订重建阶段，新增 self 仓库的有限消费者证明。必须已有冻结 F3 活动的 ci.yml verified binding 且 repo/revision/digest 一致，才补 ci.yml→API package→配置→测试→组件方向的来源边。所有输入来自 git show 精确 commit 的普通文件；不读取候选工作树、不运行候选代码。边记录修订、输入 hash、选择器及证明版本。

CI changes 输出、workspace-test 条件与 ci-passed 失败出口联合核验；npm 行为字段、实际 Vitest lock 解析与安装生命周期入口必须符合已审合同。config/setup/三测试固定已审 b580 原文 hash，类型导入、语义注释、using 等均不能被规范化抹掉。AST 额外核真实 runtime import、active render、有函数体且非 declare 的 default export。组件正文可正常变化。

## 不变量与限制

- 不改冻结 snapshot/definitions/owner 声明、原七条关系、联合门禁及三条注册断言；未知消费链不补边，原门禁继续拒绝。
- 固定封套不等于通用 TSX 解释器：测试/config/setup 即使只改格式或注释也 fail-closed，CI/npm 执行语义变化也需重新审查可信工具，可能再次需要 bootstrap。
- root/API lock 仅锁实际 Vitest 记录及本工作区解析入口，不宣称审计全部第三方依赖供应链。
- 图边表示真实消费者依赖，不表示 docs-only PR 实际运行 workspace-test，也不表示业务验收通过。
- 本棒仅给 PRD/Learning/release 三个新路径追加精确来源关系，owner 是实际接入文件；去掉新增行必须逐字恢复原 manifest。
- 旧可信 b580 工具的 FAIL 是 bootstrap 事实。候选新工具本地 PASS 不追认旧 CI；发布/合并需 root 最后取得明确例外批准，本候选不得自行 autoMerge。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/scripts/ci/__tests__/workspace-test-source.test.mjs` | `固定Git的真实workspace-test调用链让三个owner反向到原ci.yml锚，不更改冻结定义` |
| ws1 | `packages/brain/scripts/ci/__tests__/workspace-test-source.test.mjs` | `仅读固定commit，脏工作树替换测试不改变历史证明` |
| ws1 | `packages/brain/scripts/ci/__tests__/workspace-test-source.test.mjs` | `仅函数声明没有运行时default出口不能补边` |

原可信工具真实 scratch 双 scope 失败先于生产实现；永久真实 Git fixtures 覆盖选择器、类型擦除、语义指令、npm 入口、身份与真实出口。新工具需重放固定 b580 双侧及候选全差异，并执行原三注册回归；最终官方 CI 与自然样本仍分别验收。
