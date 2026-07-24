---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel v1 mixed provider fire drill r2 证据文档

**范围**: 仅新增 `docs/fire-drills/kernel-v1-mixed-20260724-r2.md` 一个文档文件；不碰 packages/brain、migrations、现有合同测试、CI 配置
**大小**: S

> 说明：本 sprint 无 HTTP 端点（Response Schema N/A），故「schema 字段 / keys 完整性 / 禁用字段反向」三类 API 场景不适用；BEHAVIOR 按 PRD 验收点覆盖：存在性+标记 / 字面值 / 真实性核验 / 六角色完整性 / 范围守卫（失败侧）。

## ARTIFACT 条目

- [ ] [ARTIFACT] docs/fire-drills/kernel-v1-mixed-20260724-r2.md 存在且含 PASS 标记与版本字面值
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r2.md','utf8');if(!c.includes('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2')||!c.includes('1.267.67'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous）

- [ ] [BEHAVIOR] [L2] 证据文档存在且含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 标记（Golden Path Step 2）
  动作: fire drill 链路 generator 将证据写入 docs/fire-drills/kernel-v1-mixed-20260724-r2.md
  预期观察: 仓库出现该文件，文件内含字面 PASS 标记
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r2.md && grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R2 docs/fire-drills/kernel-v1-mixed-20260724-r2.md || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 证据文档含生产版本 1.267.67 字面值（Golden Path Step 2）
  动作: generator 将生产版本号写入文档
  预期观察: 文档任意位置出现字面 1.267.67
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r2.md && grep -q "1\.267\.67" docs/fire-drills/kernel-v1-mixed-20260724-r2.md || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 证据文档含 merge commit 字面值，且该 commit 在仓库真实可解析（Golden Path Step 2+3；落实铁律 rev-parse --verify ^{commit}）
  动作: generator 将 merge commit 19887912bbb581597f12c714a9ed187f051e2850 写入文档
  预期观察: 文档含该 hash，且 git 能将其解析为真实 commit 对象（防抄错/编造）
  Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724-r2.md && grep -q 19887912bbb581597f12c714a9ed187f051e2850 docs/fire-drills/kernel-v1-mixed-20260724-r2.md && git rev-parse --verify "19887912bbb581597f12c714a9ed187f051e2850^{commit}" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 六角色（planner/proposer/reviewer/generator/evaluator/judge）每个都有 provider/account 证据行，缺任一角色 FAIL（Golden Path Step 1→2 证据投影；PRD 边界情况）
  动作: generator 汇总六个角色各自的 provider/account 实际运行证据写入文档
  预期观察: 每个角色名至少与 provider 或 account 字样同现一行
  Test: manual:bash -c 'DOC=docs/fire-drills/kernel-v1-mixed-20260724-r2.md; test -f "$DOC" || exit 1; for R in planner proposer reviewer generator evaluator judge; do grep -Ei "$R.*(provider|account)|(provider|account).*$R" "$DOC" | grep -q . || { echo "MISSING $R"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 范围守卫：交付分支相对 origin/main 不触碰 packages/brain、migrations、.github/workflows（Golden Path Step 4；PRD E2E 验收点 5）
  动作: generator 仅新增 docs/fire-drills/ 下文档文件并提交
  预期观察: 禁区路径 diff 为空
  Test: manual:bash -c 'CHANGED=$(git diff --name-only origin/main...HEAD -- packages/brain migrations .github/workflows | head -20); [ -z "$CHANGED" ] || { echo "FAIL: $CHANGED"; exit 1; }; echo OK'
  期望: OK
  备注: 本条为约束型守卫断言（实现前空仓库也 PASS 属预期），不单独证明实现；done 判定 = 前四条实现证明 + 本条守卫联合成立，透明声明以免误判假绿。

## Invariant 覆盖（铁律映射 — PRD Invariant 段逐条，INV 或 N/A）

已落实（映射到上方条目/流程）：

| 铁律 | 覆盖 |
|---|---|
| 合同批准前记录 manual oracle 真实 exit code + 确认解释器启动 | INV：见下方「manual oracle 真跑记录（Round 1 红态）」段，逐条真跑记录 exit code |
| manual:node -e 双引号 ${} 须 GAN 批准前真跑 | INV：本合同唯一 node -e（ARTIFACT）不含 ${}，且已真跑记录 exit code |
| git rev-parse 判 ref 必须带 --verify "<ref>^{commit}" | INV：BEHAVIOR 第 3 条命令即为该写法 |
| 部署链失败路径禁止 warning 降级 | INV：全部断言显式 exit 1，无 `\|\| true`/`\|\| echo` 兜底 |
| Red commit 只 git add 精确路径 | INV：本轮 commit 仅 add 合同四产物精确路径 |
| Test Contract 表固定 4 列、testFile 用 backtick | INV：contract-draft.md Test Contract 表已按此格式 |
| lint-test-quality 要求 await fn() ≥ 1，不许直接 readFileSync | INV：tests/ 用 async 函数 + await readFile |
| 禁止 generator 自行 merge PR，merge 权归 controller | INV：合同 notes 声明 human review 通过前禁止 merge；generator 只推 branch |
| 共享 CI 基础设施文件默认禁区（.github/workflows 等） | INV：BEHAVIOR 第 5 条禁区 diff 守卫含 .github/workflows |
| Proposer 复用历史合同模板前须核对真实派发历史 | INV：本合同未复用历史 E2E 模板，断言全部从本 PRD 字面推导 |
| 禁止写死环境假设值 | INV：合同内全部字面值（版本/hash/路径/标记）来自 PRD 原文，无环境假设值 |
| 真环境验证才算 done（接缝断言真目标验证） | INV：接缝清单为空（纯文档交付，不碰真机/生产 env/真实调用方），全部断言为环境无关逻辑断言 |
| 凭据安全（secrets 不进 git/日志） | INV：证据摘要只允许写 provider/account 标识（如 provider 名、账号别名），禁止写 key/token；generator 写文档时须遵守 |
| theater_mismatch 关键词规则（合同文本不得出现移动端真机关键词） | INV：本合同全文不含该触发关键词 |
| target_environment 由 Brain 从 tasks.payload 读取 | INV：合同 target_environment=local_api 与 PRD 一致，payload 由 controller 注册时负责 |
| PR 提前合并须用 head SHA 核对 verdict | INV：合同层面已声明 human review 前禁 merge，finalize 核对归 controller |
| 单 slot 串行执行 | INV：流程约束，本合同不引入并行任务（task-plan 单 ws1） |

N/A（本 sprint 纯文档新增，不触及对应面）：

- smoke 铁律（×5）：不触 smoke 基础设施/brain/src → N/A
- 状态不重置的多轮扫描集成测试 / 重扫付费调用前置检查 / 跨模块时间常数不变量 / 新增 cron 查 scheduler-jobs / 新 task_type 七点清单：无调度、无扫描、无 cron、无新 task_type → N/A
- varchar 长度截断 / 表名认领冲突 / 新后台 job 声明消费方 / catch 吞错 job 失败计数 / journey_features updated_at 探针：无 DB 写入、无后台 job → N/A
- 复活死功能前读退役代码 / 退役判断查生产库：非复活/退役类任务 → N/A
- null/false 失败分支显式 else / 回归测试 source-code inspection / git_sha=unknown 同一语义 / 判变基准用生产实体自报 / worktree 触碰生产资源：无产品代码逻辑、无部署判变，断言全部只读 → N/A
- Brain judge API 格式（顶层 exit_code+log_tail+behavior_tests[]）：evaluator/judge 侧协议，合同 BEHAVIOR 均产出可采集 exit code，格式组装归 evaluator → N/A（合同侧无违反面）
- relay 容器 Step 7 report 机械闸门 / headed relay payload base_repo / headed relay tmux 环境变量 / host 白名单断言核对 headed 场景：controller/relay 侧责任，本合同无 host 白名单断言、无 headed 环节 → N/A
- 服务存活双信号 / LaunchAgents 禁区 / launchd-patrol manifest：无常驻服务 → N/A
- feat+brain PR 带齐 smoke-allowlist：不触 brain/src → N/A
- 新字段与既有字段语义重叠消解：无新字段 → N/A
- 测试默认多租户 / 端点鉴权 / 租户隔离 / 日志脱敏：无租户数据、无新端点、无日志输出、无 PII → N/A

## manual oracle 真跑记录（Round 1 红态 — 铁律 INV-1 执行证据）

<!-- proposer 在交付前逐条真跑上方 manual:bash 命令并记录真实 exit code；预期红态：文件未创建前 B1-B4 exit 1，B5（守卫）exit 0 -->

2026-07-24 Round 1 真跑记录（bash 解释器确认启动，逐条真实 exit code）：

| 条目 | 真实 exit code | 红态判定 |
|---|---|---|
| BEHAVIOR 1（文件+PASS 标记） | 1 | ✅ 真红（文件不存在） |
| BEHAVIOR 2（版本 1.267.67） | 1 | ✅ 真红 |
| BEHAVIOR 3（merge commit + rev-parse） | 1 | ✅ 真红（grep 失败；rev-parse 单独跑 exit 0，commit 19887912bbb581597f12c714a9ed187f051e2850 在仓库真实可解析） |
| BEHAVIOR 4（六角色循环） | 1 | ✅ 真红 |
| BEHAVIOR 5（范围守卫） | 0 | 守卫型断言，实现前 PASS 属预期（已在条目备注透明声明） |
| ARTIFACT（node -e 读文件） | 1 | ✅ 真红（ENOENT；node 解释器确认启动，无 ${} expansion） |

vitest 红证据：`npx vitest run sprints/0724172956-kernel-fire-drill-mixed-r2/tests/` → Tests 6 failed (6)，全部 ENOENT，无假绿。
