# build 原意图与验证范围传递

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

真实文档任务 b681fe25 明确禁止新增测试，intent/spec 均保留只改 README 的范围，但 build 未传原意图路径，模板无条件要求编写并提交代码与测试，导致新增镜像测试。后续 verify 正确拒绝，旧任务保持失败，不算无人成功。

本修复只把既有 01-intent.md 路径传给 build 执行会话，并要求先读任务范围再读规格。验证与提交均受原任务边界约束；文档限定或禁止测试文件时，用允许的临时材料/内联命令作真实可失败验证，不创建仓库测试。缺输入如实停止，不新增程序错误协议。不修改 verify、范围解析、运行状态或旧任务。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/scripts/coding-workflow/__tests__/build.test.mjs` | `真实 build 子进程收到可读取的原始 intent 绝对路径，任务禁止项不在渲染中丢失` |
| ws1 | `packages/brain/scripts/coding-workflow/__tests__/build.test.mjs` | `build-ok：completed，outputs 带 03-build.md 与新提交 SHA，03 覆盖全部 S-n` |

使用真实活动子进程与真实 Git 夹具检验渲染路径、文件可读与原文完全一致。旧实现缺 INTENT_PATH 真失败；既有合法代码+测试提交路径仍通过。夹具不模拟模型理解，文案优先级由独立审查核验，模型实际遵守要由修复正式加载后的新 A2、B 自然运行验收；不把本地回归计为无人成功。
