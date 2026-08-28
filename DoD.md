contract_branch: cp-harness-propose-r2-7fc54fec-r5100560e-a36
sprint_dir: sprints/08290045-kernel-r80-provider-exit-fidelity

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 结构化上报保真透传，根除 provider_exit 语义埋没 [r80]

**范围**: runner/entrypoint 结构化终态保真透传（不降级 provider_exit）+ kernel CONTRACT_* 病族边界与 failed_targets 过滤 + RED 复刻 r69/r77。**不在范围**：合同重开后主链路由缺陷（WORKSPACE_RESOLUTION_FAILED）、provider 真崩溃黑名单语义。
**大小**: M

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | 执行体产出结构化终态时，回执链路保真透传真因（success 结果 / CONTRACT_* 码），kernel 走合同故障重开 GAN、不进 failed_targets、不按 infra 重试 |
| **NFR（做得多好）** | 性能/可靠性 | 分类为纯函数可重放（相同回执输入恒得相同分类，无时钟/随机/DB） |
| **Invariant（永不违反）** | 不变量 | 无结构化产出的真 provider 崩溃/超时**必**判 provider_exit/provider_timeout（负向语义不变）；有结构化终态时**禁**写 provider_exit |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | CONTRACT_* 家族码集合以现有 golden-path-contract-schema.js / derive.js token 为准；新增码值需同步 derive token（本 sprint 不新增） |
| **死亡告警（停了谁知道）** | 谁多久知道 | 分类回退失灵 → RED 回归测试（本合同两文件）在 CI 失败即告警；生产侧真因埋没复发由后续 run 案卷暴露 |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | detect_structured_terminal 无法解析结构化终态（畸形/空/不可读）→ 回退 provider_exit（fail-safe，当基础设施崩溃可重试），不放行成功、不静默 |
| **效果确认（已发≠已生效）** | 回执方式 | 回执 error.code 字段即效果确认：结构化 BLOCKED → 真因码可见；真崩溃 → provider_exit 可见。两态均由测试断言 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 执行体是否产出了「结构化终态」（可保真透传）vs 真崩溃（应 provider_exit） | A. 仅看 CLI 退出码；B. 解析 stdout 结构化终态（.structured_output/.result 里 status=blocked+error.code 或 status=completed / commander-directive/v1） | B. 解析结构化终态（复用 entrypoint.sh:2851-2878 已有提取） | 退出码单信号是病根——非零退出码同时可携真结构化终态（r69/r77 实证）；必须看结构化产出本身 | 误判为 provider_exit → 真因埋没 → 合同故障当基础设施重试并拉黑 target → run 死等（三次实证）|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息 |

> ⚠️ 判定点误判后果严重（真因埋没直接致 run 死），属「升拍板点」级别；但判定信号来自 PRD ASSUMPTION 明确锚定（复用现有 structured_output 提取，不新建），PrepPRD 已隐含拍板，无 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| detect_structured_terminal 读不到/解析不了结构化终态 | 回退 provider_exit（当真崩溃处理） | 是（纯函数，同输入同输出） | fail-safe：宁可当基础设施可重试，不误当成功放行 |
| 真 provider 崩溃（无结构化产出） | provider_exit / status=failed，进 failed_targets 黑名单 | 是（infra 重试同角色，identity 不变） | 按 INV-1 重派原始服务端派发动作 |

### 输入对抗面（对外暴露 agent）

N/A —— 本单是 runner→kernel 内部回执分类链路，stdout 为 runner 归一的内部产物，非对外暴露 agent 的可写入接口。

## Invariant 铁律映射（Step 1.3 — 逐条）

- [generator_infrastructure_retry_identity] → 覆盖：B-04 负向（provider_exit target 仍拉黑）+ B-05（provider_exit/timeout 仍归 infra，重试语义不变）；本 sprint 只把 CONTRACT_* 移出 infra 病族，不改真崩溃的 infra 重试身份。
- [Kernel existing PR evaluator validation clock adoption] → N/A：本 sprint 不触及 validation clock。
- [planner_role_branch] → N/A：本 sprint 不触及 planner workspace/分支。
- [Fleet Generator Brain URL authority] → N/A：本 sprint 不触及 BRAIN_URL 注入链。
- [status 枚举 grep 复查] → N/A：本 sprint **不新增** status 枚举值，复用现有 blocked/completed/failed 三态（无新枚举需全仓 grep 复查）；测试覆盖三态（B-01 blocked、B-02 completed、B-05 failed）。

## ARTIFACT 条目

- [x] [ARTIFACT] entrypoint.sh 定义 detect_structured_terminal() 结构化终态识别函数
  Test: node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8');if(!/^detect_structured_terminal\(\) \{/m.test(c))process.exit(1)"
- [x] [ARTIFACT] ground-truth.js 导出 isInfrastructureErrorCode 与 isContractFaultCode 纯函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/ground-truth.js','utf8');if(!c.includes('export function isInfrastructureErrorCode')||!c.includes('export function isContractFaultCode'))process.exit(1)"
- [x] [ARTIFACT] dispatcher.js __test__ 含 filterBlacklistableTargets 且 failed_targets 构造消费之
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/dispatcher.js','utf8');if(!c.includes('filterBlacklistableTargets'))process.exit(1)"
- [x] [ARTIFACT] attempt-store listFailedExecutionTargets 返回行携 error_code（供上层过滤）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/attempt-store.js','utf8');const m=c.match(/listFailedExecutionTargets[\s\S]*?ORDER BY hop/);if(!m||!/error_code/.test(m[0]))process.exit(1)"
- [x] [ARTIFACT] 版本 bump 四处同步（brain package.json version 递增 + DEFINITION 同步链）
  Test: bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh'
- [x] [ARTIFACT] 冻结合同测试落盘且真 import 被改模块（无 vi.mock）
  Test: node -e "const c=require('fs').readFileSync('sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js','utf8');if(c.includes('vi.mock')||!c.includes(\"orchestrator/ground-truth.js\")||!c.includes(\"orchestrator/dispatcher.js\"))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous / local_api 纯函数可重放）

- [x] [BEHAVIOR] [L2] B-01: runner 结构化 BLOCKED + CONTRACT_* 保真透传（r69，不 provider_exit）
  动作: 真 bash 跑 entrypoint.sh 原文提取的 normalize_provider_failure，喂结构化 BLOCKED(error.code=CONTRACT_SELF_CONTRADICTION) 且 CLI exit 1
  预期观察: 回执 error.code 保真为 CONTRACT_SELF_CONTRADICTION、status=blocked，禁写 provider_exit
  等待预算: 0s
  留证: vitest 输出末 5 行 + 回执 JSON（receipt.error.code / receipt.status）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "CLI 退出码非零" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-02: runner 结构化 success 结果 JSON 被识别（r77，不当失败包装）
  动作: 真 bash 跑 detect_structured_terminal，喂 status=completed 结果 JSON 与 commander-directive/v1、结构化 BLOCKED、真崩溃各一
  预期观察: success → __structured_success__、结构化 BLOCKED → 真因码、真崩溃 → 空（落回 provider_exit）
  等待预算: 0s
  留证: vitest 输出末 5 行（A1-A6 全过）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "detect_structured_terminal" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-03: kernel 病族边界——CONTRACT_* 家族不入基础设施病族
  动作: 真 import ground-truth.js 的 isInfrastructureErrorCode/isContractFaultCode，对 provider_exit/timeout 与 CONTRACT_* 家族（含词序/多词漂移）分类
  预期观察: provider_exit/timeout∈病族(true)；CONTRACT_* 家族∉病族(false)；无关码不误判合同故障
  等待预算: 0s
  留证: vitest 输出末 5 行（病族边界 A1-A5 全过）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "病族边界" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-04: kernel 派发——CONTRACT_* 不进 failed_targets 黑名单
  动作: 真 import dispatcher.js __test__.filterBlacklistableTargets，过滤含 CONTRACT_* 与 provider_exit/timeout 的混合 target 列表
  预期观察: CONTRACT_* 故障 target 被滤；provider_exit/timeout 真崩溃 target 保留(负向拉黑不变)；入参不被 mutate
  等待预算: 0s
  留证: vitest 输出末 5 行（failed_targets B1-B5 全过）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08290045-kernel-r80-provider-exit-fidelity/tests/provider-exit-fidelity.test.js -t "failed_targets" --reporter=basic'

- [x] [BEHAVIOR] [L2] B-05: 负向——无结构化真崩溃仍 provider_exit / 超时仍 provider_timeout（语义不变）
  动作: 真 bash 跑 normalize_provider_failure，喂 raw 崩溃文本 exit 1 与 exit 124；detect 对 status=failed 结构化失败回传空
  预期观察: raw 崩溃 → provider_exit/failed；exit 124 → provider_timeout/failed；结构化 failed 不误当可透传终态
  等待预算: 0s
  留证: vitest 输出末 5 行（负向语义不变 3 条全过）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run tests/gp/f1/step3-provider-exit-fidelity-r80.test.js -t "负向语义不变" --reporter=basic'
