# Kernel P0/P1 Behavior Equivalence Contract Design

日期：2026-07-28
状态：已批准
范围：Phase 4 最终 11 要素等价证明收账

## 决策

复用根 `regression-contract.yaml` 作为唯一回归 SSOT，在其中增加
`behavior_equivalence` section。不得新建 `behavior_ledger` 表、第二套生命周期、
第二份回归清单或自行写承诺地图数据库。

现有载体职责保持不变：

- `journeys / journey_steps`：Kernel Harness S0-S12 Golden Path；
- `journey_step_links`：11 要素格子及 gray/red/pending/green/na 投影；
- `eleven-elements-ledger.js`：现有 11 要素健康计算；
- `regression-contract.yaml`：行为合同、可执行 assertion 与证明清单；
- decision/event/result/receipt：运行期 exact-SHA/version 效果证据。

## 合同形状

`behavior_equivalence` 固定声明：

1. S0-S12 step catalog；
2. 11 个 canonical dimension；
3. 旧 Claude Code P0/P1 behavior inventory；
4. 每条 behavior 的 legacy evidence、unified Kernel construct、适用 steps/dimensions；
5. Claude/Codex/Grok × normal/violation/recovery proof matrix；
6. freshness、effect receipt、supersession 与失败语义；
7. `proven | gap | intentional_replacement` 状态。

合同中的引用必须指向已有文件、根 regression assertion、测试命令或运行期 receipt
identity。自由文本不能代替证明。

## 验证和投影

新增纯 validator/projector：

- 输入为已解析的根 regression contract；
- 不查询或写入数据库，不执行生产副作用；
- schema、交叉引用、S0-S12、11 维、priority 和 supersession fail-closed；
- `proven` 只有在 exact commit/version、验证时间、freshness deadline、effect receipt
  以及三 Provider 三场景可执行证据全部有效时成立；
- 文档、静态 grep、`test -f`、只检查关键词或未证明违规路径会真实失败的命令，不得将
  P0/P1 标为 proven；
- 声明 `proven` 但缺证据时，`effective_status` 必须自动变为 `gap`，同时产生
  fail-closed validation finding；既不能伪绿，也不能因抛错而从最终报告消失；
- 合同本来声明 `gap` 时保留 gap，并要求 owner、reason、closure plan；
- `intentional_replacement` 要求旧行为、替代行为、理由和替代证明。

projector 只输出建议的既有 `journey_step_links` cell 状态：

- proven → green；
- gap → red；
- 证据齐但临近过期/未执行 → pending；
- intentional replacement 且证明有效 → green；
- 明确不适用且有理由 → na。

它不直接 PATCH 或 INSERT。

## Evidence envelope

每个 provider/scenario proof 规范化为可机器读取的 envelope，至少包含：

- behavior/priority/contract version；
- journey step 与 11 维；
- legacy behavior/evidence；
- Kernel enforcer；
- provider、scenario、test command；
- expected/observed result；
- exact artifact SHA/version；
- verified/expires timestamp；
- effect receipt identity；
- source assertion/event/result references。

缺值必须显式 `null` 或成为 gap，禁止推测。

## 报告

确定性报告生成器输出 JSON 与 Markdown：

- 总数和 proven/gap/intentional replacement 分布；
- P0/P1 分布；
- S0-S12 × 11 维覆盖；
- Provider × normal/violation/recovery 矩阵；
- freshness/stale/supersession；
- proven-to-fire 命令；
- 所有 gap、owner、reason、closure plan。

报告不得把文档存在、静态 grep 通过或命令未执行解释为等价证明。

## 测试

测试必须覆盖：

1. 完整 proven contract 通过；
2. 缺 Provider/场景、receipt、SHA、freshness、步骤或维度失败；
3. docs/grep/smoke-only 伪绿失败；
4. gap 被诚实保留；
5. intentional replacement 缺理由/证明失败；
6. stale proof 不投影 green；
7. supersession 环和悬空引用失败；
8. 报告保留 gap 与三维矩阵；
9. root contract 中所有 assertion_ref 可解析；
10. 自动检查禁止出现同义 `behavior_ledger` migration/table。

## 非目标

- 不修改 ReleaseRun 或 post-diff risk 实现；
- 不执行生产部署、GitHub mutation 或数据库写入；
- 不声称当前所有 P0/P1 已 proven；
- 不用本次静态合同替代后续真实三 Provider proven-to-fire。
