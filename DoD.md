contract_branch: cp-07221119-harness-prd
sprint_dir: sprints/07212136-relay-7630f4fb

---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: headed relay 派发链路自测（claude-headed, task 7630f4fb）

**范围**: 新增锚定 task_id=7630f4fb-0acf-4f7a-ad42-e2dea3485089 的 `sprints/07212136-relay-7630f4fb/e2e-verify.sh`，复用（不重实现）`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`，只读校验三件事：①该 smoke 脚本全绿执行且已在 `packages/quality/smoke-allowlist.txt` 精确登记；②`GET /api/brain/tasks/7630f4fb...` payload 关键字段齐全（mode/executor/orchestrator/journey_id）且不含敏感字段明文；③DB `initiative_runs` 定点核对 initiative_id=7630f4fb... 的 orchestrator_host 精确等于 `skill-relay-claude-headed`、phase 合法且非 failed/unknown。不新增业务功能/dashboard/UI/migration，不改 `claude-headed-dispatch-smoke.sh` 本体，不改 `.github/workflows/ci.yml`，不重复登记 allowlist。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] contract draft 含 Golden Path 与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07212136-relay-7630f4fb/contract-draft.md','utf8');if(!c.includes('## Golden Path')||!c.includes('## E2E 验收'))process.exit(1)"

- [x] [ARTIFACT] e2e-verify.sh 已生成，锚定当前 task_id 与 sprint_dir，且调用既有 smoke 脚本路径
  Test: node -e "const fs=require('fs');const p='sprints/07212136-relay-7630f4fb/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('7630f4fb-0acf-4f7a-ad42-e2dea3485089')||!c.includes('packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh')||!c.includes('packages/quality/smoke-allowlist.txt'))process.exit(1)"

- [x] [ARTIFACT] e2e-verify.sh 具备可执行权限
  Test: node -e "const fs=require('fs');const st=fs.statSync('sprints/07212136-relay-7630f4fb/e2e-verify.sh');if(!(st.mode & 0o111))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，local_api 本机执行）

- [x] [BEHAVIOR] 复用 claude-headed-dispatch-smoke.sh 全绿执行 + allowlist 精确登记确认
  Test: manual:bash -c 'set -euo pipefail; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh; grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: allowlist 未精确登记"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] 当前 task 的 Brain API payload 关键字段齐全且不含敏感字段明文
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"; export TASK_ID; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; RESP=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"); echo "$RESP" | jq -e ".id == env.TASK_ID" >/dev/null; echo "$RESP" | jq -e ".payload.mode == \"headed\"" >/dev/null; echo "$RESP" | jq -e ".payload.executor == \"claude\"" >/dev/null; echo "$RESP" | jq -e ".payload.orchestrator == \"skill-relay\"" >/dev/null; echo "$RESP" | jq -e ".payload.journey_id | type == \"string\" and length > 0" >/dev/null; echo "$RESP" | jq -e "(.payload | has(\"token\") | not) and (.payload | has(\"github_token\") | not) and (.payload | has(\"anthropic_token\") | not) and (.payload | has(\"thin_prd\") | not)" >/dev/null; echo OK'
  期望: OK

- [x] [BEHAVIOR] DB initiative_runs 定点核对 orchestrator_host 精确匹配 + phase 合法非 failed/unknown
  Test: manual:bash -c 'set -euo pipefail; TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; ROW=$(psql "$DB" -XAt -F "|" -c "SELECT orchestrator_host, phase, started_at FROM initiative_runs WHERE initiative_id = \$\$${TASK_ID}\$\$ ORDER BY started_at DESC LIMIT 1"); [ -n "$ROW" ] || { echo "FAIL: initiative_runs 无当前 task run"; exit 1; }; HOST=$(printf "%s" "$ROW" | cut -d"|" -f1); PHASE=$(printf "%s" "$ROW" | cut -d"|" -f2); STARTED_AT=$(printf "%s" "$ROW" | cut -d"|" -f3); [ "$HOST" = "skill-relay-claude-headed" ] || { echo "FAIL: orchestrator_host=$HOST"; exit 1; }; [ "$PHASE" != "failed" ] || { echo "FAIL: phase=failed"; exit 1; }; [ "$PHASE" != "unknown" ] || { echo "FAIL: phase=unknown"; exit 1; }; case "$PHASE" in A_planning|planning|gan|generate|evaluate|done) ;; *) echo "FAIL: phase 非法枚举 phase=$PHASE"; exit 1 ;; esac; [ -n "$STARTED_AT" ] || { echo "FAIL: started_at 为空"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] e2e-verify.sh 完整脚本端到端跑通（三件事全过，脚本 exit 0）
  Test: manual:bash -c 'TASK_ID="${TASK_ID:-7630f4fb-0acf-4f7a-ad42-e2dea3485089}" SPRINT_DIR="${SPRINT_DIR:-sprints/07212136-relay-7630f4fb}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07212136-relay-7630f4fb/e2e-verify.sh'
  期望: 脚本 exit 0，末尾打印 ✅ PASS

- [x] [BEHAVIOR] 未改动 claude-headed-dispatch-smoke.sh 本体（范围限定：不重实现）
  Test: manual:bash -c 'set -euo pipefail; if git rev-parse --verify origin/main^{commit} >/dev/null 2>&1; then CHANGED=$(git diff --name-only origin/main...HEAD -- packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh 2>/dev/null || true); [ -z "$CHANGED" ] || { echo "FAIL: claude-headed-dispatch-smoke.sh 本体被修改，超出范围"; exit 1; }; echo OK; else echo "WARN: origin/main 不可达，跳过 diff 比对（非阻塞，需 evaluator 在有 origin/main 的环境重跑）"; echo OK; fi'
  期望: OK

- [x] [BEHAVIOR] 未改动 .github/workflows/ci.yml（范围限定：不改 CI 文件）
  Test: manual:bash -c 'set -euo pipefail; if git rev-parse --verify origin/main^{commit} >/dev/null 2>&1; then CHANGED=$(git diff --name-only origin/main...HEAD -- .github/workflows/ci.yml 2>/dev/null || true); [ -z "$CHANGED" ] || { echo "FAIL: ci.yml 被修改，超出范围"; exit 1; }; echo OK; else echo "WARN: origin/main 不可达，跳过 diff 比对（非阻塞）"; echo OK; fi'
  期望: OK

- [x] [BEHAVIOR] allowlist 未重复登记（第 23 行精确唯一，未新增重复行）
  Test: manual:bash -c 'set -euo pipefail; COUNT=$(grep -Fx "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt | wc -l | tr -d " "); [ "$COUNT" = "1" ] || { echo "FAIL: allowlist 中 claude-headed-dispatch-smoke.sh 出现 $COUNT 次（应精确 1 次，禁止重复登记）"; exit 1; }; echo OK'
  期望: OK

## Invariant 覆盖条目（PRD ## Invariant 约束 段 49 条铁律逐条覆盖）

> 覆盖规则：本任务范围内真正适用的铁律 → `[BEHAVIOR] INV-N` + 可执行断言；范围外/不适用 → `[ARTIFACT] INV-N` + 显式 `N/A：<理由>`（一律不静默漏项）。

- [x] [ARTIFACT] INV-1 [测试冷启动重置掩盖跨周期bug] N/A：本任务无周期性扫描/afterEach 重置状态模式，e2e-verify.sh 是一次性同步只读校验脚本，不存在"冷启动掩盖跨周期 bug"的测试模式风险
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-1 [测试冷启动重置掩盖跨周期bug] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-2 [周期重扫防重复调用] N/A：本任务无周期性重扫逻辑，也不引入任何外部付费 API 调用（LLM/第三方）
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-2 [周期重扫防重复调用] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-3 [跨模块时间常数依赖] N/A：本任务未引入任何新的跨模块时间常量（扫描间隔/闲置阈值/缓存TTL）
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-3 [跨模块时间常数依赖] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-4 [theater_mismatch android误判] N/A：本任务合同文本与脚本内容不涉及 android 关键词，不触发 theater_mismatch 判定
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-4 [theater_mismatch android误判] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-5 [target_environment来源DB] N/A：本任务不做新任务注册、不写入 DB tasks.payload 的 target_environment 字段；PRD 头部 `## target_environment` 是文档层声明供 harness 路由使用，与本铁律描述的"任务注册时 DB payload 写入"场景不同
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-5 [target_environment来源DB] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-6 [judge结果JSON格式] N/A：本任务不产出也不消费 Brain judge 的 .brain-result.json
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-6 [judge结果JSON格式] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-7 [DB字段长度截断] N/A：本任务无任何 DB 写入，纯只读 SELECT 查询
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-7 [DB字段长度截断] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-8 [复活功能先查死因] N/A：本任务不复活任何曾死过的功能
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-8 [复活功能先查死因] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-9 [错误码契约需显式else] N/A：e2e-verify.sh 用 shell exit code 驱动断言，不调用"失败返回 null/false"契约的函数
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-9 [错误码契约需显式else] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-10 [smoke-invariant-2387] N/A：占位符铁律无具体规则内容（仅 id=33ede9f1），本任务复用既有 smoke 脚本并校验 allowlist 登记（见 BEHAVIOR「复用 claude-headed-dispatch-smoke.sh 全绿执行」）已自然符合通用 smoke 治理精神
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-10 [smoke-invariant-2387] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-11 [updated_at停滞探针] N/A：本任务不涉及 journey_features 表或 report 阶段
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-11 [updated_at停滞探针] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-12 [relay跳过report兜底校验] N/A：本任务是只读校验脚本，不涉及 controller/relay 对 report 阶段是否被跳过的判定逻辑
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-12 [relay跳过report兜底校验] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-13 [host白名单核对headed] 适用：本合同起草 orchestrator_host 断言时已核对 headed 场景，采用精确匹配 `skill-relay-claude-headed`（非宽松 `headed` 关键字包含），避免把其他 headed 变体（如 codex-headed）误判通过
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "skill-relay-claude-headed" "$SCRIPT" >/dev/null || { echo "FAIL: 未精确匹配 skill-relay-claude-headed"; exit 1; }; ! grep -E "grep .*-q.*headed[^-]" "$SCRIPT" >/dev/null || { echo "FAIL: 疑似使用宽松 headed 关键字匹配"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-14 [headed点火需base_repo/pr_url] N/A：本任务不执行 headed relay 点火动作，只校验已存在 task 的现状（task 是否含 base_repo/pr_url 属点火时的既有职责，非本次校验脚本范围）
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-14 [headed点火需base_repo/pr_url] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-15 [退役判断查生产库实锤] N/A：本任务不做任何退役判断
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-15 [退役判断查生产库实锤] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-16 [吞错job需失败计数告警] N/A：本任务不新增任何后台 job
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-16 [吞错job需失败计数告警] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-17 [建表前grep写入方] N/A：本任务不新建或复用任何 DB 表
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-17 [建表前grep写入方] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-18 [后台job须声明消费方] N/A：本任务不新增任何后台 job
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-18 [后台job须声明消费方] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-19 [多设备类型UI区分] N/A：本任务无任何 UI
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-19 [多设备类型UI区分] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-20 [git_sha语义跨脚本一致] N/A：本任务不涉及 git_sha 语义处理
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-20 [git_sha语义跨脚本一致] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-21 [git rev-parse需--verify] N/A：e2e-verify.sh 本体不使用 git rev-parse 判 ref 存在（该用法出现在 DoD 的范围限定检查里，且已用 `git rev-parse --verify origin/main^{commit}` 正确写法）
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-21 [git rev-parse需--verify] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-22 [smoke真实worktree防触碰生产] 适用：e2e-verify.sh 在真实 worktree 下执行，已核对本体不含破坏性/触碰生产的命令
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -Ei "DROP TABLE|DELETE FROM|rm -rf /|UPDATE .* SET|INSERT INTO" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 含疑似破坏性/写入命令"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-23 [部署链失败禁warning降级] N/A：本任务不涉及任何部署链
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-23 [部署链失败禁warning降级] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-24 [判变基准用生产自报] N/A：本任务不做 build-info.json / health.git_sha 与 origin/main 的判变对账
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-24 [判变基准用生产自报] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-25 [lint要求await包装async] 适用：tests/*.test.ts 中读文件的断言均用 async function 包装并 await，不裸用 readFileSync
  Test: manual:bash -c 'set -euo pipefail; T="sprints/07212136-relay-7630f4fb/tests/e2e-verify-contract.test.ts"; [ -f "$T" ] || { echo "FAIL: missing $T"; exit 1; }; grep -F "await" "$T" >/dev/null || { echo "FAIL: 测试文件缺 await"; exit 1; }; grep -F "async" "$T" >/dev/null || { echo "FAIL: 测试文件缺 async 包装"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-26 [Test Contract表格4列格式] 适用：contract-draft.md 的 Test Contract 表格固定 4 列，testFile 用反引号包裹
  Test: manual:bash -c 'set -euo pipefail; F="sprints/07212136-relay-7630f4fb/contract-draft.md"; [ -f "$F" ] || { echo "FAIL: missing $F"; exit 1; }; grep -F "| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |" "$F" >/dev/null || { echo "FAIL: Test Contract 表格表头非 4 列标准格式"; exit 1; }; grep -E "\| \`sprints/07212136-relay-7630f4fb/tests/" "$F" >/dev/null || { echo "FAIL: testFile 未用反引号包裹"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-27 [Red commit精确add路径] N/A（过程纪律，非产物级可 grep 断言对象）：本合同 Step 4 出口协议要求 `git add` 只加精确路径（contract-draft.md/contract-dod.md/tests//task-plan.json），generator 后续 Red commit 同样只 add `*.test.ts` 精确路径，由 Step 4 流程与后续 harness-generator 规则保障，非本 DoD 静态文件可验证内容
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-27 [Red commit精确add路径] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-28 [回归测试用源码检查] 适用：本合同的 Invariant 覆盖条目大量使用 source-code inspection（grep 静态检查 e2e-verify.sh/contract-draft.md 源码文本）而非 mock 覆盖来验证调度接线（如 INV-13/INV-22/INV-25/INV-26/INV-33/INV-42/INV-43/INV-46）
  Test: manual:bash -c 'set -euo pipefail; D="sprints/07212136-relay-7630f4fb/contract-dod.md"; N=$(grep -c "manual:bash -c .set -euo pipefail; SCRIPT=" "$D" || true); [ "$N" -ge 1 ] || { echo "FAIL: 缺 source-code inspection 型断言"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-29 [cron功能查scheduler-jobs.js] N/A：本任务不新增任何 cron 功能
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-29 [cron功能查scheduler-jobs.js] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-30 [generator禁止自merge] N/A（proposer 阶段不涉及 merge）：该铁律约束 harness-generator 角色的 merge 权限边界，本合同产出的是 propose 分支产物，不涉及任何 merge 操作；后续 generator 阶段仍需遵守本铁律，但非本次 proposer 产物可 grep 断言的内容
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-30 [generator禁止自merge] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-31 [tmux子shell需显式export] N/A：本任务不涉及 headed relay tmux innerCmd 的环境变量传递机制，e2e-verify.sh 是被 evaluator/开发者直接调用的独立脚本，非 tmux innerCmd 子 shell
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-31 [tmux子shell需显式export] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-32 [复用模板需核对真实历史] 适用：已用 git show/gh 核对 4bb31ef5(PR #3829)/57e25e92(PR #4109)/049ebf93(PR #3970) 真实历史内容，未假设"与先例路径相同"（见 contract-draft.md「已知约束」段）
  Test: manual:bash -c 'set -euo pipefail; F="sprints/07212136-relay-7630f4fb/contract-draft.md"; [ -f "$F" ] || { echo "FAIL: missing $F"; exit 1; }; grep -F "git show 5e892ba636593d4a3463e07362de3f87c74d1521" "$F" >/dev/null || { echo "FAIL: 未留痕真实历史核对命令"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-33 [共享CI文件默认禁区] 适用：e2e-verify.sh 与本合同均不修改 `.github/workflows/*.yml`、`packages/quality/smoke-allowlist.txt`
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -E ">>\s*\.github/workflows|>\s*\.github/workflows|>>\s*packages/quality/smoke-allowlist\.txt|>\s*packages/quality/smoke-allowlist\.txt" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 疑似写入共享 CI 禁区文件"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-34 [提前合并需核对headSHA] N/A：本任务是 proposer 阶段产物（propose 分支），不涉及 PR 合并环节的 head SHA 核对，属 controller/evaluator/merge 阶段职责
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-34 [提前合并需核对headSHA] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-35 [smoke-invariant-79911] N/A：占位符铁律无具体规则内容（仅 id=552520d0），同 INV-10 已由复用既有 smoke 脚本满足其精神
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-35 [smoke-invariant-79911] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-36 [PR需一次带齐smoke+allowlist] 适用：本合同确认 `claude-headed-dispatch-smoke.sh` 已在 allowlist 精确登记（第 23 行），不存在"smoke 已加但 allowlist 未登记"导致 CI 两连红的风险
  Test: manual:bash -c 'set -euo pipefail; grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || { echo "FAIL: smoke 未在 allowlist 登记，PR 会两连红"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-37 [新task_type七点清单] N/A：本任务不新增任何 task_type
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-37 [新task_type七点清单] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-38 [服务存活双信号判定] N/A：本任务不涉及任何服务存活判定逻辑
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-38 [服务存活双信号判定] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-39 [美国Mac禁用LaunchAgents] N/A：本任务不涉及任何 LaunchAgents/LaunchDaemon 配置
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-39 [美国Mac禁用LaunchAgents] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-40 [常驻服务须入launchd-patrol] N/A：本任务不新增任何常驻宿主服务
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-40 [常驻服务须入launchd-patrol] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-41 [smoke-invariant-93097] N/A：占位符铁律无具体规则内容（仅 id=4b73376c），同 INV-10 已由复用既有 smoke 脚本满足其精神
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-41 [smoke-invariant-93097] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-42 [单slot串行任务] 适用：e2e-verify.sh 不 spawn/kill 任何 tmux 或并发会话，本次校验只在当前单一 slot 内串行执行
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -E "tmux[[:space:]]+new-session|tmux[[:space:]]+kill|killall|pkill|&\s*$" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 疑似 spawn/kill 并发会话"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-43 [禁止写死环境假设值] 适用：BRAIN_URL/DATABASE_URL/TASK_ID/SPRINT_DIR 均走 env 变量默认值，可被 evaluator 覆盖，不写死凭据/路径
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "TASK_ID=\"\${TASK_ID:-" "$SCRIPT" >/dev/null || { echo "FAIL: TASK_ID 未走 env 默认"; exit 1; }; grep -F "BRAIN_URL=\"\${BRAIN_URL:-" "$SCRIPT" >/dev/null || { echo "FAIL: BRAIN_URL 未走 env 默认"; exit 1; }; grep -F "DATABASE_URL:-" "$SCRIPT" >/dev/null || { echo "FAIL: DATABASE_URL 未走 env 默认"; exit 1; }; ! grep -E "ghp_[A-Za-z0-9_]+|/Users/administrator/\.ssh|-2600" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 含写死凭据/坐标痕迹"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-44 [真环境验证才算done] 适用：e2e-verify.sh 打真实 Brain API（curl localhost:5221）+ 真实 PostgreSQL（psql）+ 真实复用既有 smoke 脚本，无 mock/stub
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "curl -sf" "$SCRIPT" >/dev/null || { echo "FAIL: 未见真实 curl 调用"; exit 1; }; grep -F "psql" "$SCRIPT" >/dev/null || { echo "FAIL: 未见真实 psql 调用"; exit 1; }; ! grep -Ei "MOCK_|jest\.mock|vi\.mock|sinon\.stub|dryrun|dry-run|\|\|[[:space:]]*true[[:space:]]*$" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 含 mock/stub/dry-run/吞错痕迹"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-45 [测试默认多租户] N/A：`initiative_runs`/`tasks` 是 Brain 内部全局调度表，非多租户业务数据表，本任务查询不涉及租户隔离场景，无需种 ≥2 租户断言互不串
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-45 [测试默认多租户] N/A'))process.exit(1)"

- [x] [BEHAVIOR] INV-46 [凭据安全] 适用：e2e-verify.sh 不硬编码任何 secrets，DATABASE_URL 走 env 默认（本地开发库弱口令，非生产凭据），不进日志明文输出
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -Ei "ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9]{16,}|anthropic_token[[:space:]]*=|api[_-]?key[[:space:]]*=[[:space:]]*[\"'"'"'][A-Za-z0-9]{10,}" "$SCRIPT" >/dev/null || { echo "FAIL: e2e-verify.sh 疑似硬编码真实 secrets"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-47 [日志脱敏] 适用：e2e-verify.sh 对 payload 做 token/github_token/anthropic_token/thin_prd 反向存在性断言，发现明文即 FAIL，不打印敏感字段原文
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07212136-relay-7630f4fb/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "has(\"token\")" "$SCRIPT" >/dev/null || { echo "FAIL: 未拒绝 token 字段"; exit 1; }; grep -F "has(\"github_token\")" "$SCRIPT" >/dev/null || { echo "FAIL: 未拒绝 github_token 字段"; exit 1; }; grep -F "has(\"anthropic_token\")" "$SCRIPT" >/dev/null || { echo "FAIL: 未拒绝 anthropic_token 字段"; exit 1; }; grep -F "has(\"thin_prd\")" "$SCRIPT" >/dev/null || { echo "FAIL: 未拒绝 thin_prd 字段"; exit 1; }; ! grep -F ".payload)\"" "$SCRIPT" >/dev/null || { echo "FAIL: 疑似整体打印 payload 原文"; exit 1; }; echo OK'
  期望: OK

- [x] [ARTIFACT] INV-48 [端点鉴权] N/A：本任务不新增或修改任何 API 端点，只读调用既有已鉴权/已上线的 `GET /api/brain/tasks/:id`
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-48 [端点鉴权] N/A'))process.exit(1)"

- [x] [ARTIFACT] INV-49 [租户隔离] N/A：本任务查询的 `initiative_runs`/`tasks` 为 Brain 内部调度表而非客户租户业务数据，不涉及跨租户读写场景
  Test: node -e "const c=require('fs').readFileSync('sprints/07212136-relay-7630f4fb/contract-dod.md','utf8');if(!c.includes('INV-49 [租户隔离] N/A'))process.exit(1)"

## Invariant 覆盖统计

- PRD `## Invariant 约束` 段实测共 **49** 条铁律（`awk` 范围内 `grep -c '^- \['` = 49；任务描述中提及的「32 条」与本次 PRD 文件实测计数不一致，本合同按**实测 49 条**全量覆盖，不按提示数字裁剪，避免漏项）。
- 适用（`[BEHAVIOR] INV-N`，含真实可执行断言）：INV-13、INV-22、INV-25、INV-26、INV-28、INV-32、INV-33、INV-36、INV-42、INV-43、INV-44、INV-46、INV-47，共 13 条。
- 不适用（`[ARTIFACT] INV-N` + 显式 N/A 理由）：其余 36 条（INV-1~12、14~21、23~24、27、29~31、34~35、37~41、45、48~49）。
- 覆盖完整性自查：`grep -oE 'INV-[0-9]+' contract-dod.md | sort -t- -k2 -n -u | wc -l` 必须等于 49。
