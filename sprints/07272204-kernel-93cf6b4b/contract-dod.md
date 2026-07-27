---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: F1 × 11要素账本归位与等价基线 Recovery

**范围**: 只允许在既有 `bb8cc561-b3ee-4fec-b74d-2255694bd963` F1 Journey 上完成 current main 对账、S0-S12 × 11要素归位、P0/P1 等价基线回挂、fresh evidence gate 重建；禁止新建平行 Journey、状态机、账本或第二份 regression SSOT。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `regression-contract.yaml` 新增 `KERNEL-F1-RECOVERY-07272204` 等价基线条目
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('regression-contract.yaml','utf8');if(!c.includes('KERNEL-F1-RECOVERY-07272204'))process.exit(1)"

- [ ] [ARTIFACT] `docs/current/SYSTEM_MAP.md` 记录 F1 Recovery 仍沿用同一 Journey 与 current SHA 验收链约束
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('docs/current/SYSTEM_MAP.md','utf8');if(!c.includes('bb8cc561-b3ee-4fec-b74d-2255694bd963')||!c.includes('current SHA'))process.exit(1)"

- [ ] [ARTIFACT] 新增 4 个 smoke 脚本骨架
  Test: node -e "const fs=require('fs');['packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh','packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh','packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh','packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh'].forEach(p=>fs.accessSync(p))"

## 铁律映射（Step 1.3）

- [ ] [BEHAVIOR] [L2] INV-1 旧 relay failed run 必须经 current main 重对账后重跑，不能复用旧完成结论
  动作: 构造带旧 SHA / 旧 run 证据的恢复输入并执行 recovery smoke
  预期观察: 旧 run 只会触发重新判色，不会直接把 F1 标成完成
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-2 target_environment 继续从任务 / PRD 真实载荷读取为 `local_api`，不得本地拍脑袋改路由
  动作: 对 recovery 任务运行 smoke 并读取其真实路由判定
  预期观察: 任务仍走 `local_api`，无额外并行环境分叉
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-3 任一失败分支必须显式落 `pending/red/unknown`，不得只靠 try/catch 吞掉
  动作: 注入缺失 fresh evidence / 缺失 assertion_ref 的失败样例
  预期观察: F1 保持非 green 状态并给出明确失败原因
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-4 report 阶段必须真实写出 F1 Recovery 产物，而不是仅凭 exit 0
  动作: 跑 recovery smoke 后检查约定产物文件和基线条目
  预期观察: `regression-contract.yaml` 与文档 / smoke 文件均落库
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-5 点火元数据必须保留 current main / 分支 / task 短 ID 可追溯
  动作: 执行 current-main reconcile smoke
  预期观察: 新 head 与 current SHA、task short id 对账信息可被读出
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-6 generator 只产分支与证据，不得自行 merge PR
  动作: 执行 fresh evidence gate smoke
  预期观察: 无 judge / 主理人人审时 merge 仍被 gate 拒绝
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-7 不得修改共享 CI 基础设施以绕过验收
  动作: 执行 regression equivalence smoke
  预期观察: 新基线仅落在 F1 Recovery 自身 smoke / contract / regression 条目，不改共享 CI 基础设施通过条件
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-8 evaluator / judge verdict 必须与 current SHA 一致，旧 verdict 不得复用
  动作: 注入旧 SHA verdict 并执行 fresh evidence gate smoke
  预期观察: 旧 verdict 被判为 stale，F1 不得 ready/merge
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-9 同一 slot 只允许同一条 F1 Journey 推进，恢复链不得踩出第二条并行路线
  动作: 执行 single journey smoke
  预期观察: 仍只有 `bb8cc561-b3ee-4fec-b74d-2255694bd963` 这一路被更新
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-10 依赖真实外部状态的接缝未真验前不得标 done
  动作: 故意缺 evaluator / judge / 主理人人审中的任一项
  预期观察: F1 继续停留在 `pending` 或 `unknown`
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-11 若查询 / 写入涉及租户面，必须保留真实租户隔离约束
  动作: 执行 regression equivalence smoke 中的 DB / evidence 查询
  预期观察: 合同与脚本不引入跨租户扫表捷径
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh

- [ ] [BEHAVIOR] [L2] INV-12 禁止写死环境假设值，环境差异必须从 current main / current SHA / 真实证据推导
  动作: 执行 current-main reconcile smoke
  预期观察: smoke 使用 `git rev-parse origin/main` 与真实 verdict 数据，不写死 SHA
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] current main 对账后只允许同一条 F1 Journey 继续推进
  动作: 对 `origin/main` 与当前工作头执行 recovery reconcile
  预期观察: 系统继续沿用 `bb8cc561-b3ee-4fec-b74d-2255694bd963`，不存在第二条平行 Journey 或第二本账本
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-current-main-reconcile-smoke.sh

- [ ] [BEHAVIOR] [L2] S0-S12 骨干和 11要素格子在同一 Journey 上完整可见
  动作: 运行账本矩阵 smoke，对同一 Journey 读取骨干 step 与 cell 数据
  预期观察: S0-S12 全部存在；11要素格子按真实证据显示 `green|pending|red|unknown`，缺口不默认绿
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-ledger-s0-s12-matrix-smoke.sh

- [ ] [BEHAVIOR] [L2] 旧 Claude Code P0/P1 守卫已回挂到根 regression-contract 与同一 Journey assertion_ref
  动作: 运行回归等价 smoke，解析根 `regression-contract.yaml` 与 journey assertion 锚点
  预期观察: P0/P1 等价条目只出现在根 `regression-contract.yaml`；每条 `assertion_ref` 均指向真实存在测试或 smoke
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-regression-equivalence-smoke.sh

- [ ] [BEHAVIOR] [L2] 缺 fresh evaluator / judge / 主理人人审任一项时必须 fail-closed
  动作: 运行 fresh evidence gate smoke 并分别注入缺 evaluator、缺 judge、缺主理人人审三种样例
  预期观察: 任一缺失都保持 `pending|unknown|red`，不得 ready/merge
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] 旧 SHA 证据不会被 current head 复用
  动作: 使用旧 SHA verdict 样例执行 evidence gate
  预期观察: 系统把旧证据标记为 stale，并要求 fresh evaluator / judge / 主理人人审重新绑定 current SHA
  验证命令: Test: manual:bash bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh

- [ ] [BEHAVIOR] [L2] [legacy] `GET /api/brain/journeys/:id` 继续返回既有 F1 Journey 基本信息
  Test: manual:bash curl -sf http://localhost:5221/api/brain/journeys/bb8cc561-b3ee-4fec-b74d-2255694bd963 | jq -e '.id=="bb8cc561-b3ee-4fec-b74d-2255694bd963" and .name=="Cecelia Harness Pipeline"'

- [ ] [BEHAVIOR] [L2] [legacy] `GET /api/brain/journey_features/:id/blast-radius` 在 recovery 后能返回非空联动半径
  Test: manual:bash curl -sf http://localhost:5221/api/brain/journey_features/ce82cffa-3b04-4f9f-b048-1413403e59e1/blast-radius | jq -e '.count >= 1'

- [ ] [BEHAVIOR] [L2] [legacy] error path — 当 F1 recovery smoke 发现旧 SHA 冒充 current SHA 时返回非零退出码
  Test: manual:bash bash -lc 'bash packages/brain/scripts/smoke/f1-fresh-evidence-gate-smoke.sh --fixture stale-sha && { echo FAIL; exit 1; } || true'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] recovery final-e2e 顺序执行 4 个 smoke，并在根回归契约上形成 current-main 基线
  期望: 4 个 smoke 全部 exit 0，且 `regression-contract.yaml` 存在 `KERNEL-F1-RECOVERY-07272204`

