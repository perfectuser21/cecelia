# build 原意图与控制器记录来源闭环

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)。

## 问题与范围

文档任务 b681fe25 明确禁止新增测试，intent/spec 均保留只改 README 的范围，但 build 未传原意图路径，模板无条件要求编写并提交代码与测试，导致新增镜像测试。verify 正确拒绝，旧任务保持失败。只读来源预检另证实：原生 publish 会提交 11 份正常 Markdown 流水线记录，却没有相应来源登记；QA 与 Commander 后续独立提交也有同一缺口。

build 现在传入并先读 01-intent.md，验证与提交服从原任务及规格边界；禁止仓库测试时用允许的临时材料或内联命令作真实可失败验证。控制器在 publish、QA、Commander 三个真实提交点，只登记当前任务、当前阶段白名单中的普通非可执行 Markdown，来源索引和记录同一提交。QA 先完成整组校验及原有空索引检查，再登记及暂存。

本棒在第一棒正式合入并实际加载后，以正式主线重基，激活 `EXISTING_OPS_BUILD_SELECTOR_SCHEMA=1`。消费者证明仍读取固定 Git 修订；旧修订没有此标记时不扩展绑定，不重写旧快照。正式来源验收必须使用实际基线官方双 scope artifact 和新的精确 HEAD。

## 不变量与失败行为

- 控制器核实 Cecelia origin、任务 UUID、实际分支、sprint 路径与 intent 身份；只写精确 documentation 关系，旧关系原始字节保留，冲突拒绝，重复调用幂等，原子替换。
- `.implementation-source-relations.json` 属控制器元数据。build 若提交该文件，以 `build_touched_controlled_metadata` fatal 拒绝；QA/CI-fix/Commander 的模型提交同样受 protected-path 守卫限制。不能把模型已提交的旧 owner 改动洗成可信基线。
- docs-only 分类逐层核对 base→HEAD、HEAD→index、index→worktree；仅精确重算的当前任务新增关系可免索引 JSON 这一项，其它源码、非 Markdown、执行位和链接仍走原门禁。
- 非 Markdown 附件不删、不伪装 documentation；本次不提供通用 JSON/图片/脚本来源协议，保留现场并明确拒绝不支持的记录。
- 不改 verify、QA 批准规则、合并权限、历史失败、运行服务或任务状态。先通过正式来源门禁，再由新 A2、B 自然运行判断实际闭环，当前仍 0/2。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 |
|---|---|---|
| ws1 | `packages/brain/scripts/coding-workflow/__tests__/build.test.mjs` | `真实 build 子进程收到可读取的原始 intent 绝对路径，任务禁止项不在渲染中丢失` |
| ws1 | `packages/brain/scripts/coding-workflow/__tests__/build.test.mjs` | `build 模型不能先提交控制器来源索引再让publish登记洗白` |
| ws1 | `packages/brain/scripts/coding-workflow/__tests__/publish.test.mjs` | `Cecelia 发布将当前任务 Markdown 与精确来源关系同提交，重复发布不重复登记` |
| ws1 | `packages/brain/scripts/coding-workflow/runner/__tests__/qa-records.test.mjs` | `Cecelia QA 在索引空检查后把本轮报告与来源登记一起stage` |
| ws1 | `packages/brain/scripts/coding-workflow/runner/__tests__/run-once-commander.test.mjs` | `Cecelia commander 独立07提交同时登记来源，真实裸仓回读无孤立记录` |
| ws1 | `packages/brain/scripts/coding-workflow/runner/__tests__/record-sources.test.mjs` | `多次控制器提交的前部插入可重算；模型已提交的旧owner篡改不能被HEAD洗白` |

真实活动子进程、临时 Git/裸仓与本地 HTTP 夹具验证同提交、重启幂等、错误路径和原有分类门禁；不调用模型服务。固定测试明确选择其真实 Claude CLI 夹具，生产运行 provider 不变。原 a9d0/d20f 的失败断言及后续守卫红态保留。本地回归或候选来源预检不等于正式 CI、模型遵守范围或无人闭环成功。
