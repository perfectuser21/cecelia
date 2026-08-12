# 设计：Kernel 批准合同资产的不可变传输与恢复

案卷：Unified Work Router task `b0443bf7-001f-4ae3-9b3b-4c7178bbcd49`，run `f96a5a61-54cc-4426-8bb8-c749749d3dd0`，approved SHA `6faaa9f55e9789ffd29fd2760a9b5994df272e86`。

## 问题与不变量

GAN 已在精确 approved SHA 产出并批准 PRD、合同、DoD、task-plan 与七个测试文件。Kernel 只把前三类文本写入 `initiative_contracts`，Dispatcher 又把 TaskBundle 的 `artifacts` 固定为空数组；冻结在 base SHA 的 Generator 因而看不到批准态测试，并正确以 `FROZEN_CONTRACT_TEST_ARTIFACTS_MISSING` 拒绝执行。

修复必须保持四条不变量：

1. approved SHA 是批准资产的唯一来源，不能信任 Provider 自报的文件内容或当前工作树。
2. Generator 继续冻结在 base SHA，不 fetch、不 merge、不自行重建批准态测试。
3. 合同资产一经批准不可变；执行前后均校验路径、摘要和长度。
4. 资产缺失或损坏在 Provider 启动前精确失败，不能归类为泛化语义拒绝或无限重试。

## 冻结模型

新增 `initiative_contract_artifacts`：

- `contract_id uuid` 外键指向 `initiative_contracts(id)`；
- `path text`，与 `contract_id` 组成主键；
- `content text`；
- `sha256 text`；
- `byte_length integer`；
- `source_revision text`；
- `created_at timestamptz`。

批准动作从权威 repo 的精确 approved SHA 读取以下 allowlist：PRD、`contract-draft.md`、`contract-dod.md`、`task-plan.md`（存在时）和 `tests/**`。路径必须是相对 POSIX 路径，禁止空段、`.`、`..`、绝对路径、反斜杠和 NUL。测试目录必须至少包含一个普通文件。全部资产总字节数不得超过 256 KiB；超限或读取失败均不创建 approved contract。

`initiative_contracts` 与资产行在同一数据库事务内落库。历史 approved contract 没有资产行时不得从当前 Git 状态补猜；只允许在仍能证明原 approved SHA 的恢复流程中重新冻结。

## TaskBundle 与 Runner

TaskBundle `inputs.contract_artifacts` 是按 path 排序的数组，每项携带 `path`、`content`、`sha256`、`byte_length`、`source_revision`。Bundle 只从已持久化的批准资产读取，不再现场读 proposer 分支。

Runner 在 Provider 启动前执行：

1. 校验 schema、路径约束、SHA-256、UTF-8 字节长度和总量上限；
2. 将每项写入冻结 workspace 的对应相对路径；
3. 写入后重新读取并校验摘要；
4. 任一步失败即返回稳定错误码，不创建 Provider session。

Runner 不覆盖批准资产之外的文件，也不允许同一路径重复出现。资产被写入 workspace 后，Generator 使用既有 skill 从标准 sprint 路径读取合同与测试。

## 失败语义与重试

新增稳定分类：

- `FROZEN_CONTRACT_ARTIFACTS_MISSING`：批准合同没有完整资产；
- `FROZEN_CONTRACT_ARTIFACT_INVALID`：路径、摘要、长度或重复项无效；
- `FROZEN_CONTRACT_ARTIFACT_MATERIALIZATION_FAILED`：Runner 写入或回读失败。

前三类都属于确定性 assembly fault：不消耗 Provider 尝试，不进入 human review，不重复相同状态；run 以精确 failure reason 收尾并产生可恢复 successor 所需 lineage。Impact Contract 的 schema/parse 类错误同样改为确定性错误；只有网络、进程存活和明确的暂态数据库错误进入有界重试。

## 恢复与规范化

Brain 启动时立即执行一次既有 relay watchdog 扫描，再进入周期循环。扫描继续使用现有 lease/CAS/staleness 守卫，保证多实例启动不会重复拉起同一 run。

Impact Contract 在首次持久化前先走 schema parse，再对解析后的 canonical object 计算 hash。`head_revision: null` 等 schema 外或空值字段不再制造 v1→v2 伪变化。

已失败的原 run 保持不可变。修复部署并完成真实生产 smoke 后，创建 successor task/run，显式记录 predecessor task/run、原 approved SHA、approved branch 与已通过的 Impact Contract；successor 重新冻结同一 SHA 的资产并从 generate 阶段继续。

## 验收

- unit：Git 精确 SHA 读取、路径拒绝、确定性排序、摘要与 256 KiB 上限；
- PostgreSQL integration：合同与资产原子落库，TaskBundle 只读冻结行；
- runner：七个测试在 Provider 启动前出现于 workspace，篡改/遍历/重复路径 fail closed；
- derive/classifier：三类资产错误零 Provider 尝试且不会进入 human review；确定性 Impact 错误有界收尾；
- startup：进程启动立即恢复一个符合 staleness 条件的 run，并由 CAS 证明只恢复一次；
- canonicalization：空 `head_revision` 不产生新 contract version；
- production：successor 使用 approved SHA `6faaa9f...`，TaskBundle 中七个测试摘要与该 SHA 一致，Generator 进入实际编码并产出 PR。

## 非目标

- 不放宽 Generator 的 frozen baseline；
- 不把 Git 分支作为执行期动态依赖；
- 不修改原失败 run 的历史记录；
- 不把批准资产改存 memory、payload 或 Provider session；
- 不把 CI 当作动作期资产校验的主闸门。
