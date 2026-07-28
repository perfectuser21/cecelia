# Kernel Behavior Equivalence Drills Design

日期：2026-07-28
状态：已批准
基线：`884524ac0eaf5e87a7598ac0422e10fa90f78c1a`

## 目标

为根 `regression-contract.yaml` 中的 11 条 Kernel P0/P1 behavior 提供
provider-neutral 的 drill 协议、99-cell 确定性计划、短期执行授权验证、
真实 effect receipt 校验、collector hash chain 和 trusted resolver。

本阶段不执行真实 drill，不生成 receipt，不把测试、mock、dry-run、静态文件存在或
普通字符串提升为 proof。暂无受信 effect signer 的 cell 保持 gap。

## 唯一清单与 99-cell 编译

根 `regression-contract.yaml.behavior_equivalence.behaviors` 继续是 behavior
唯一 SSOT。每条 behavior 增加一个 canonical `drill` descriptor：

- `seam_id`：真实 unified guard/effect seam 的稳定身份；
- `seam_ref`：下一阶段 signer adapter 必须接入的文件、服务或路由；
- `adapter_id`：受信 adapter registry 中的身份；
- `isolation`：默认环境、ephemeral resource 类型和允许的 ref/resource prefix；
- `effect_signer_status`：`available | missing`；
- `effect_key_purpose`：必须为 `effect_receipt`；
- `scenarios.normal|violation|recovery`：期望 outcome、denial code 或 recovery lineage；
- `blocked_by`：signer 缺失时固定为 `seam_receipt_signer_missing`。

编译器将 11 descriptors 与固定 Provider `claude/codex/grok`、Scenario
`normal/violation/recovery` 做笛卡尔积，生成恰好 99 个稳定 `cell_id`。重复、
遗漏、未知 Provider/Scenario、缺 scenario、重复 `cell_id` 或 behavior 数量漂移
都 fail closed。

不提交第二份 99 行 behavior 清单。`--plan` 是从根 SSOT 产生的完整、可审计
99-cell 视图。

## Trust registry

`behavior_equivalence.drill_trust_registry` 只保存公钥和状态，不保存任何私钥：

- schema/algorithm 固定为 Ed25519；
- `key_id`、`purpose`、`service_id`；
- `public_key_pem`；
- `not_before`、`not_after`；
- `revoked_at` 和 rotation lineage；
- grant/receipt/bundle 最大 freshness；
- replay nonce policy。

Key purpose 分为：

1. `execution_grant`：server-only authority signer；
2. `effect_receipt`：真实 guard/effect seam 服务身份；
3. `collector_bundle`：collector 聚合封包身份。

collector 的 bundle signature 只证明聚合包未被修改，不能替 seam 证明 effect。
根 registry 初始不放假 key。缺 key 或 signer 的 cell 可以通过静态 `--check`，
但不能执行，也不能成为 proven。

## Execution grant

`kernel-equivalence-execution-grant/v1` 是短期、单 cell 授权，必须绑定：

- grant id、key id、signature、issued/expires；
- behavior/provider/scenario/cell id；
- run id、attempt id；
- exact artifact SHA；
- Brain version、Engine version；
- environment；
- ephemeral resource id/ref/prefix；
- allowed adapter/seam；
- authority scopes；
- single-use replay nonce。

runner 在任何 adapter 调用前验证签名、key purpose、rotation/revocation、
freshness、全部 axes、版本和资源边界，并原子消费 nonce。nonce 消费失败留下脱敏
denial audit 并 fail closed。

默认 environment 只能是 isolated/ephemeral。`main`、受保护 ref 和 production
在 Phase 5 CLI 中保持禁用；未来需独立高风险 authority scope 和单独实现评审。

## Effect receipt

`kernel-equivalence-effect-receipt/v1` 必须由实际 seam 的受信
`effect_receipt` key/服务身份签名，绑定：

- receipt id、key/service id、signature；
- behavior/provider/scenario/cell；
- run/attempt/grant/nonce；
- exact artifact SHA、Brain/Engine version；
- seam/adapter；
- ephemeral resource；
- issued/expires；
- `execution_mode=live_effect`；
- observed outcome/effect code；
- effect 前后 identity/hash；
- predecessor receipt id/hash。

violation receipt 必须观察到真实 denial。recovery receipt 必须引用同一 cell 对应
violation receipt 的 id 和 hash，且 artifact、run、resource 与 seam 一致；孤立的
“recovered” 字符串无效。

单测可以使用临时 Ed25519 key 测试 verifier，但这些 key 和 receipt 不能进入根
合同、报告或 proof store。

## Runner 和 collector

CLI：

```text
node scripts/ci/run-kernel-equivalence-drill.mjs --plan
node scripts/ci/run-kernel-equivalence-drill.mjs --check
node scripts/ci/run-kernel-equivalence-drill.mjs \
  --execute --cell <cell_id> --grant <signed-grant.json> \
  --state-dir <absolute-safe-dir> --receipt-dir <absolute-safe-dir>
```

- `--plan`：纯读取，输出 99 cells、blocker 和 signer adapter 分组；
- `--check`：纯读取，验证 descriptor、trust registry、raw bundles 和 proof refs；
- `--execute`：一次只执行一个 cell，必须显式 grant。

adapter 接口分为 `prepare → invokeActualSeam → observe → cleanup`。只有
`invokeActualSeam` 返回的 seam-signed raw receipt 才能进入 collector。普通返回值、
命令退出码、测试日志、mock、dry-run 或 runner/collector 自签对象都不能成为 proof。

adapter timeout、unsigned receipt、invalid signature、axis mismatch、cleanup 未确认
均留下不含秘密的 denial audit，并保持 gap。

collector：

1. 用 registry 验证每个 seam receipt；
2. 对 canonical receipt 计算 SHA-256；
3. 检查 predecessor/recovery lineage；
4. 追加 bundle hash chain；
5. 调用独立 collector service 封包签名。

collector 私钥不进入 runner、环境变量或仓库。没有 collector service 时执行保持
blocked；`--plan/--check` 仍可使用。

## Validator 与 trusted resolver

现有 `validateBehaviorEquivalence()` 增加 raw receipt resolver。resolver 只负责按
受限 reference 读取 raw bundle；validator 自己完成：

- grant、effect receipt 和 collector bundle 签名校验；
- key purpose/rotation/expiry/revocation；
- bundle/hash/recovery chain；
- behavior/provider/scenario/run/attempt；
- exact artifact SHA、Brain/Engine version；
- seam/adapter/resource/outcome；
- evidence reference 和 receipt identity。

`effect_receipt_id` 或 `evidence_refs` 的非空字符串不再足够。`proven` 的 9 个 cell
必须都解析为完整受信 bundle。正式 `test_command` 只接受 Phase 5 live-effect runner；
Vitest、unit、mock、dry-run、静态 grep、docs、file-presence 和 smoke-only 继续拒绝。

## Denial audit

所有 fail-closed 路径输出结构化、无秘密 audit：

- grant/nonce/key/freshness failure；
- manifest/axis/resource mismatch；
- signer/adapter missing；
- adapter timeout；
- seam signature invalid；
- hash/recovery chain broken；
- collector unavailable/invalid；
- cleanup unconfirmed。

audit 不是 effect receipt，也不能升绿。

## 当前 signer 盘点与后续拆分

现有 credential envelope signature、mutation receipt hash chain、merge receipt store
和 release/result rows 都不满足“seam 对 observed effect 独立签名”的新合同，因此
本阶段不把它们登记为 available signer。

输出按 seam 分组的下一轮最小 signer adapter 清单：

1. branch protection/workspace admission；
2. credential broker/delivery cleanup；
3. GitHub mutation broker；
4. merge authority/effect executor；
5. evaluator/judge writeback；
6. human review authority；
7. release/staging/promotion；
8. Kernel liveness/orphan recovery；
9. DevGate quality checkpoint；
10. controller/attempt ownership；
11. report/learning closure。

每个后续 adapter 必须分别实现 normal、violation、recovery 的真实 isolated drill，
由所属安全域独立评审和签名。

## 测试

TDD 必须覆盖：

- 11 × 3 × 3 恰好 99 cells、无重复或遗漏；
- manifest drift、unsafe resource、main/prod 默认拒绝；
- missing signer 可 plan/check，但 execute fail closed；
- grant signature、purpose、expiry、rotation、revocation、axis 和 nonce replay；
- adapter timeout/unsigned/invalid signature/axis mismatch denial audit；
- effect/collector 两层 Ed25519 签名；
- canonical hash chain；
- recovery 强制引用 violation id/hash；
- raw resolver 路径边界；
- 手填 receipt id、普通字符串和旧 unit-test command 不能 proven；
- 正式 live-effect runner command + 完整受信 9-cell bundle 才可 proven；
- `--plan`、`--check` 不写文件或执行 adapter；
- 无私钥、无假 key、无假 receipt 进入根合同或报告。

## 版本与回退

修改 Brain validator 后版本更新为 `1.268.7`，回退目标 `1.268.6`。
本阶段不新增数据库 migration，不修改生产 seam 控制流，不执行真实 provider、
GitHub、staging 或 production effect。
