---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel durable resume：跨 run 去重与恢复

**范围**: Kernel Harness 后端恢复正确性 hotfix；只改 `packages/brain/src/` 内 run bootstrap、contract-store、ground-truth、reconcile/derive/counters、attempt resume 相关实现与对应测试/版本账本。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同草案含 Golden Path、禁 mock 边清单、E2E 验收脚本。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251915-kernel-f09c9e31/contract-draft.md','utf8');for(const s of ['## Golden Path','## 禁 mock 边清单','## E2E 验收'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Sprint 红测文件存在且测试名可被 Test Contract 字面匹配。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts','utf8');for(const s of ['后续 run 继承 latest approved contract','ground truth 从历史 approved contract 恢复当前 run','跨 run 同结构化 failure signature'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Brain 源码变更同步版本账本。
  Test: node -e "const fs=require('fs');for(const p of ['DEFINITION.md','.brain-versions','packages/brain/VERSION']){if(!fs.existsSync(p))process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual 命令）

- [ ] [BEHAVIOR] [L2] 后续 run 继承 latest approved contract id/version/branch，且 derive 不再派 proposer/reviewer
  动作: 在真实 PostgreSQL 测试事务中创建同一 task 的历史 approved contract 与后续 kernel run。
  预期观察: within 20s 新 run 的 `contract_id` 指向最新 approved contract，derive action 进入 generator 主线。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "后续 run 继承 latest approved contract" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] ground truth 从历史 approved contract 恢复当前 run，已确认合同里程碑不降级
  动作: 构造当前 run `contract_id IS NULL` 但同 initiative/task 已有 approved contract 的 Brain restart 窗口。
  预期观察: within 20s `collectGroundTruth` 返回 `contract.approved=true`，且合同 id/version/branch 来自最新 approved row。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "ground truth 从历史 approved contract 恢复当前 run" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] expired lease 有 provider session 时恢复原 attempt，不创建新 attempt
  动作: 在真实 PostgreSQL 测试事务中插入过期 running attempt 与 provider_session_id，然后触发恢复路径。
  预期观察: within 20s 原 attempt 被 reclaim/resume；同一 run 的 `harness_attempts` 行数不增加。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "expired lease 有 provider session 时恢复原 attempt" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 无 provider session 时先结构化终结 orphan attempt，再从 DB/GitHub 真相推导
  动作: 插入无 provider_session_id 的过期 orphan running attempt 并触发恢复。
  预期观察: within 20s 原 attempt 写入终态与 error_code；下一 decision 不直接新建 attempt。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "无 provider session 时先结构化终结 orphan attempt" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 跨 run 同结构化 failure signature 重现时不再派 generator
  动作: 构造同一 task 的旧 run 已记录 product failure signature，新 run 同一 failure_set 再现。
  预期观察: within 20s derive action 为 `wait:human_review` 或 `mark_failed`，不是 `spawn:generator` 或 `spawn:generator-fix`。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts -t "跨 run 同结构化 failure signature" --reporter=verbose'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] Brain restart 回归池全量通过，既有合同测试未被削弱
  动作: 运行 sprint 红测与现有 orchestrator 合同回归池。
  预期观察: within 120s 所有相关 vitest exit 0。
  验证命令: Test: manual:bash -c 'DB_NAME="${DB_NAME:-cecelia_test}" NODE_ENV=test bash -c "npx vitest run sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts --reporter=verbose && cd packages/brain && npx vitest run src/orchestrator/__tests__/contract-store.test.js src/orchestrator/__tests__/attempt-store.test.js src/orchestrator/__tests__/ground-truth.test.js src/orchestrator/__tests__/derive.test.js src/orchestrator/__tests__/counters.test.js src/orchestrator/__tests__/loop.test.js src/__tests__/harness-kernel-resume-secret.test.js --reporter=verbose"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] INV-01 不新增第二账本，branch 只在 initiative_contracts.branch
  动作: 扫描本 PR diff 与源码。
  预期观察: within 10s 不出现新增 `contract_branch` 存储或新 ledger 表。
  验证命令: Test: manual:bash -c 'node -e "const fs=require(\"fs\");const files=[\"packages/brain/src/orchestrator/contract-store.js\",\"packages/brain/src/orchestrator/ground-truth.js\",\"packages/brain/src/harness-skill-relay.js\"];const s=files.filter(fs.existsSync).map(f=>fs.readFileSync(f,\"utf8\")).join(\"\\n\");if(s.includes(\"contract_branch\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-02 禁 mock 被改 DB 边，sprint 红测使用真实 PostgreSQL temp schema
  动作: 运行 sprint 红测。
  预期观察: within 20s 测试通过真实 `pg.Pool(DB_DEFAULTS)` 建 temp tables；无 `vi.mock` mock `contract-store/ground-truth/attempt-store/derive/counters` 被改边。
  验证命令: Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"sprints/07251915-kernel-f09c9e31/tests/kernel-durable-resume.test.ts\",\"utf8\");if(!c.includes(\"new Pool(DB_DEFAULTS)\"))process.exit(1);if(/vi\\.mock\\([^\\n]*(contract-store|ground-truth|attempt-store|derive|counters)/.test(c))process.exit(1);console.log(\"OK\")"'
  期望: OK

## 铁律映射（PRD 58 条）

- INV-01 区域1: N/A - 本 sprint 不改 watchdog_overdue orphan requeue 安全路径；恢复路径新增测试不得破坏。
- INV-02 区域2: N/A - 不改通知/写库接口语义字段。
- INV-03 区域3: N/A - 不涉及 dep-audit advisory。
- INV-04 区域4: 覆盖于 BEHAVIOR `expired lease 有 provider session 时恢复原 attempt`，防 relay run 心跳误杀后重复 spawn。
- INV-05 区域5: N/A - 不做毕业 rename。
- INV-06 区域6: 覆盖于 BEHAVIOR 红测和 E2E，manual oracle 记录真实 exit code。
- INV-07 区域7: N/A - DoD 不使用 bash 双引号 JS `${}`。
- INV-08 区域8: N/A - PRD 未给 smoke 细节。
- INV-09 区域9: N/A - PRD 未给 smoke 细节。
- INV-10 区域10: 覆盖于两 run/Brain restart 回归，明确多轮状态不重置。
- INV-11 区域11: N/A - 不引入外部付费调用。
- INV-12 区域12: 覆盖于 lease/deadline 不变量，不写死跨模块时间关系。
- INV-13 区域13: N/A - target_environment 为 local_api，无 Android/agent-offline-alert。
- INV-14 区域14: N/A - 不改 task 注册 target_environment。
- INV-15 区域15: N/A - 不改 judge API schema。
- INV-16 区域16: N/A - 不新增无界字符串字段。
- INV-17 区域17: N/A - 不复活退役功能。
- INV-18 区域18: 覆盖于无 provider session 失败语义，null/false 分支显式结构化终结。
- INV-19 区域19: N/A - PRD 未给 smoke 细节。
- INV-20 区域20: N/A - 不改 journey_features report。
- INV-21 区域21: N/A - 不改 completion authority。
- INV-22 区域22: N/A - 不写 host 白名单断言。
- INV-23 区域23: N/A - 不改 headed relay payload。
- INV-24 区域24: 覆盖于只用结构化生产真相，不靠记忆。
- INV-25 区域25: N/A - 不新增后台 job。
- INV-26 区域26: 覆盖于禁 mock 边清单，复用表前核对全部写入方。
- INV-27 区域27: N/A - 不新增无消费方落库 job。
- INV-28 区域28: N/A - 不新增语义重叠字段。
- INV-29 区域29: 覆盖于跨 run 同签名去重，判变端与终验端同一结构化签名策略。
- INV-30 区域30: N/A - 不新增 git ref 判断。
- INV-31 区域31: 覆盖于 E2E 使用 DB_NAME=cecelia_test，不触碰生产资源。
- INV-32 区域32: 覆盖于失败语义，恢复失败不得 warning 降级。
- INV-33 区域33: N/A - 不改部署判变基准。
- INV-34 区域34: N/A - 不改 lint-test-quality。
- INV-35 区域35: 覆盖于 contract-draft Test Contract 固定 4 列。
- INV-36 区域36: N/A - Generator Red commit 加路径由下游执行。
- INV-37 区域37: 覆盖于真实 DB/源码接线测试，不用 mock 替代调度接线。
- INV-38 区域38: N/A - 不新增 cron。
- INV-39 区域39: 覆盖于范围限定，generator 不 merge PR。
- INV-40 区域40: N/A - 不改 headed innerCmd。
- INV-41 区域41: 覆盖于已知约束，本合同核对本次真实 PRD。
- INV-42 区域42: 覆盖于 scope diff 命令，不改共享 CI 基础设施。
- INV-43 区域43: N/A - 不改提前合并兜底。
- INV-44 区域44: N/A - PRD 未给 smoke 细节。
- INV-45 区域45: 覆盖于 ARTIFACT Brain 版本账本，smoke/allowlist 由仓库规则执行。
- INV-46 区域46: N/A - 不新增 task_type。
- INV-47 区域47: N/A - 不改服务存活判定。
- INV-48 区域48: N/A - 不改 LaunchAgents。
- INV-49 区域49: N/A - 不新增常驻宿主服务。
- INV-50 区域50: N/A - PRD 未给 smoke 细节。
- INV-51 区域51: 覆盖于 Kernel 去重，单 slot 不重复派 generator。
- INV-52 区域52: 覆盖于合同禁止写死环境假设值。
- INV-53 区域53: N/A - 无真机/生产环境接缝，local_api 测试用隔离 DB。
- INV-54 区域54: N/A - 不涉及租户数据查询；如触及 tasks payload 须保持 current_task_id 限定。
- INV-55 区域55: 覆盖于不写 secrets、不记录 callback 明文。
- INV-56 区域56: N/A - 不处理 PII/聊天内容。
- INV-57 区域57: N/A - 不新增 API 端点。
- INV-58 区域58: N/A - 不新增租户数据接口。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）测试允许替换更外层 `execCmd` 的 GitHub/Docker 命令为隔离输出，但不得 mock 被改的 DB/Kernel 模块边。
