contract_branch: cp-harness-propose-r2-405c1100
sprint_dir: sprints/06112010-contract-gate-r2

# Contract DoD — Sprint: Contract Gate（evaluator 前置确定性预检）

**范围**: 纯 Node 确定性 gate（regex/解析，零 LLM）+ 数据化规则表 + 环境能力清单 + CLI 入口 + `evaluateContractNode` spawn 前接线 + artifact-gate `git fetch` refspec 修复 + 作弊/干净/边界 fixtures（永久回归）+ 单测。不含语义判断（仍归 LLM evaluator）、规则 UI、历史合同回扫。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 确定性 gate 单一实现存在，导出 runContractGate + 数据化规则表 + 环境能力清单
- [x] [ARTIFACT] CLI 入口存在且从 contract-gate.js 单一来源 import（不复制规则逻辑）
- [x] [ARTIFACT] cheat fixture 含全部 6 类作弊模式（CLI 据此抓 ≥6）
- [x] [ARTIFACT] clean / env-missing / db-no-window / exempt / empty fixtures 全部存在
- [x] [ARTIFACT] gate 接线进 evaluateContractNode（spawn 前调用 gate）
- [x] [ARTIFACT] artifact-gate fetch 用显式 refspec（refs/remotes/origin/<branch>）修 fail-open

## BEHAVIOR 条目

- [x] [BEHAVIOR] 作弊样本 fixture → 非零退出且命中 ≥6 条（规则名+行号+摘录）
- [x] [BEHAVIOR] 作弊样本 → 6 类 ruleId 全部出现
- [x] [BEHAVIOR] 干净样本 fixture → 退出码 0 + 通过清单
- [x] [BEHAVIOR] 工具 preflight → 引用 docker/ffprobe 时 env_missing + 工具名
- [x] [BEHAVIOR] 领域规则 → DB 写入无时间窗命中 domain/db-no-time-window
- [x] [BEHAVIOR] 误报逃生口 → gate-allow 豁免单条规则且输出留痕，唯一命中被豁免后 exit 0
- [x] [BEHAVIOR] 边界 + fail-closed → 空合同非零退出；不存在目录非零退出（禁 fail-open）
- [x] [BEHAVIOR] 接线 → evaluateContractNode 命中即返回 FAIL 且不 spawn 容器；通过才 spawn
- [x] [BEHAVIOR] artifact-gate 修复 → fetch 用显式 refspec <branch>:refs/remotes/origin/<branch>
