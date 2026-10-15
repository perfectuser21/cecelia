# 联合来源中无自有变更的 scope

根任务：427d7e49-27c5-4612-b115-9214f03d47f9。GP-Anchor: none(infra)

## 问题与范围
固定 self KR/factory 双来源校验在某 scope 无自有变更时提前拒绝。允许完整来源证明该 scope 的所有变更均归另一个 scope，仍保留其真实图、定义、原适用断言和独立回执。联合文件孤儿、坏快照及任何未解释 UNKNOWN 继续拒绝。

不缩减 expected scopes，不调整地图或文件归属，不改旧失败证据，不改变单 scope 空差异拒绝。仅支持 self 的固定有序 KR/factory pair，PR 与 main 用途保持区分；原双方有主证据序列化保持逐字不变。新分支必须有原生 affected usages 和已登记断言，不能把缺回归解释成无影响。

## 验收
- 真实 PG + Git + 子进程证明正反 no_owned_changes、PR/main 与退出失败。
- 完整原始 reports 入最终证据，联合关系从原始输入重新推导；即使重算摘要也不能接受篡改。
- 真实文档探针中的 11 份无归属 sprint 仍拒绝；后续由真实来源登记单独修复。
- 旧可信工具审本次源码来源；本次支持合入后才供下一棒候选使用。

## Test Contract
| ID | 测试 | 验证 |
|---|---|---|
| T1 | no_owned_changes 保留双scope原始证据和三个真实回归 %s %i %i | 两scope始终存在，空scope断言失败则整体FAIL |
| T2 | no_owned_changes 不消解联合孤儿文件和真实UNKNOWN | 无主文件仍拒绝 |
| T3 | no_owned_changes 拒绝scope、snapshot、用途、原始证据与断言篡改 | 摘要重算不替代来源重建 |
| T4 | no_owned_changes 要求完整原始逐文件证据和两个verified快照封套 | 错误路径、用途、状态、缺逐文件行拒绝 |

测试位于 packages/brain/src/__tests__/integration/implementation-multi-scope.test.js。
