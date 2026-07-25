---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel v1 GPT-5.5 全 Agent lane4 canary

**范围**: 验证 task `6449cebb-8f6f-4561-ba5f-350691bd6cec` 的 Kernel Harness canary：五个执行角色 planner/proposer/reviewer/generator/evaluator 均为 codex/team4/gpt-5.5 fresh session；generator 只交付 fire-drill 文档；最终 CI/evaluator/judge PASS；PR diff 不越界。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同文件含 Golden Path、E2E 验收、八要素、禁 mock 边清单
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251630-kernel-gpt55-team4/contract-draft.md','utf8');for(const s of ['## Golden Path','## E2E 验收','## 八要素需求规范','## 禁 mock 边清单']){if(!c.includes(s))throw new Error('missing '+s)}"

- [ ] [ARTIFACT] fire-drill 文档是唯一允许的产品交付文件
  Test: node -e "const fs=require('fs');const p='sprints/07251630-kernel-gpt55-team4/contract-draft.md';const c=fs.readFileSync(p,'utf8');if(!c.includes('docs/fire-drills/kernel-v1-gpt55-team4-20260725.md'))throw new Error('missing delivery doc path');if(!c.includes('严禁修改 `packages/**`'))throw new Error('missing forbidden product paths')"

- [ ] [ARTIFACT] Test Contract 表格固定 4 列且 test file 用 backtick 包裹
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251630-kernel-gpt55-team4/contract-draft.md','utf8');if(!c.includes('| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |'))throw new Error('bad Test Contract header');if(!c.includes('`sprints/07251630-kernel-gpt55-team4/tests/kernel-gpt55-canary.test.ts`'))throw new Error('test file not backticked')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] BEH-01 覆盖 Golden Path Step 1：真实 Brain task payload 锁定 gpt-5.5/codex/team4
  动作: 调用真实 Brain task API 读取当前 canary task。
  预期观察: payload.model 为 gpt-5.5，五个 role assignment 均为 provider=codex/account=team4。
  验证命令: Test: manual:bash -c 'set -euo pipefail; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; TASK_ID="${TASK_ID:-6449cebb-8f6f-4561-ba5f-350691bd6cec}"; TASK_JSON=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"); echo "$TASK_JSON" | jq -e ".payload.model == \"gpt-5.5\"" >/dev/null; echo "$TASK_JSON" | jq -e ".payload.executor == \"codex\" and .payload.executor_account == \"team4\"" >/dev/null; for role in planner proposer reviewer generator evaluator; do echo "$TASK_JSON" | jq -e --arg role "$role" ".payload.role_assignments[\$role].provider == \"codex\" and .payload.role_assignments[\$role].account == \"team4\"" >/dev/null; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] BEH-02 覆盖 Golden Path Step 2：harness_attempts 五角色均为 codex/team4 且 fresh session
  动作: 查询真实 PostgreSQL `harness_attempts` 当前 run 的五个执行角色。
  预期观察: planner/proposer/reviewer/generator/evaluator 均有成功 attempt，provider=codex/account_id=team4，provider_session_id 非空且互不相同。
  验证命令: Test: manual:bash -c 'set -euo pipefail; DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"; RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"; if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then DB_URL="postgresql://host.docker.internal/cecelia"; fi; ROLE_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT role) FROM harness_attempts WHERE run_id='\''$RUN_ID'\''::uuid AND role IN ('\''planner'\'','\''proposer'\'','\''reviewer'\'','\''generator'\'','\''evaluator'\'') AND provider='\''codex'\'' AND account_id='\''team4'\'' AND status IN ('\''completed'\'','\''completed_with_concerns'\'') AND created_at > NOW() - interval '\''7 days'\''"); [ "$ROLE_COUNT" = "5" ] || { echo "FAIL roles=$ROLE_COUNT"; exit 1; }; SESSION_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT provider_session_id) FROM harness_attempts WHERE run_id='\''$RUN_ID'\''::uuid AND role IN ('\''planner'\'','\''proposer'\'','\''reviewer'\'','\''generator'\'','\''evaluator'\'') AND provider_session_id IS NOT NULL AND created_at > NOW() - interval '\''7 days'\''"); [ "$SESSION_COUNT" = "5" ] || { echo "FAIL sessions=$SESSION_COUNT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] BEH-03 覆盖 Golden Path Step 3：fire-drill 文档存在并记录 task/run/model/五角色/PR/verdict 字段
  动作: 读取 generator 唯一允许交付的 fire-drill 文档。
  预期观察: 文档包含 task id、run id、gpt-5.5、五角色、codex/team4、PR URL、evaluator/judge 字段和 deepseek-v4-flash 说明。
  验证命令: Test: manual:bash -c 'node -e "const fs=require('\''fs'\'');const p='\''docs/fire-drills/kernel-v1-gpt55-team4-20260725.md'\'';if(!fs.existsSync(p))throw new Error('\''missing '\''+p);const c=fs.readFileSync(p,'\''utf8'\'');for(const s of ['\''6449cebb-8f6f-4561-ba5f-350691bd6cec'\'','\''ee037a92-8061-4729-a67b-cc9fc7d9db56'\'','\''gpt-5.5'\'','\''planner'\'','\''proposer'\'','\''reviewer'\'','\''generator'\'','\''evaluator'\'','\''provider=codex'\'','\''account=team4'\'','\''PR URL'\'','\''evaluator'\'','\''judge'\'','\''deepseek-v4-flash'\'']){if(!c.includes(s))throw new Error('\''missing '\''+s)}if(/ghp_|gho_|ghs_|github_pat_|sk-[A-Za-z0-9]/.test(c))throw new Error('\''secret leaked'\'');"; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] BEH-04 覆盖 Golden Path Step 4：最终 evaluator 与 independent judge 均 PASS，judge 不伪称 GPT-5.5
  动作: 查询真实 PostgreSQL `initiative_runs` 与 judge attempt。
  预期观察: 当前 run 的 evaluate_verdict=PASS、judge_verdict=PASS、pr_url 非空；judge provider=independent-judge。
  验证命令: Test: manual:bash -c 'set -euo pipefail; DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"; RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"; if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then DB_URL="postgresql://host.docker.internal/cecelia"; fi; psql "$DB_URL" -tAc "SELECT evaluate_verdict='\''PASS'\'' AND judge_verdict='\''PASS'\'' AND COALESCE(pr_url,'\'''\'') <> '\'''\'' FROM initiative_runs WHERE id='\''$RUN_ID'\''::uuid" | grep -qx t || { echo "FAIL verdict/pr_url"; exit 1; }; psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='\''$RUN_ID'\''::uuid AND role='\''judge'\'' AND provider='\''independent-judge'\'' AND status IN ('\''completed'\'','\''completed_with_concerns'\'') AND created_at > NOW() - interval '\''7 days'\''" | grep -qx 1 || { echo "FAIL judge provider"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] BEH-05 覆盖边界情况：PR diff 只包含 fire-drill 文档与本 sprint Harness 产物
  动作: 对当前 PR 分支与 `origin/main` 做真实 diff allowlist。
  预期观察: 除 `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md` 与 `sprints/07251630-kernel-gpt55-team4/` 外无任何改动路径。
  验证命令: Test: manual:bash -c 'set -euo pipefail; SPRINT_DIR="${SPRINT_DIR:-sprints/07251630-kernel-gpt55-team4}"; git fetch origin main >/dev/null 2>&1; BASE_REF="${BASE_REF:-origin/main}"; git rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || { echo "FAIL base ref"; exit 1; }; DIFF_FILES=$(git diff --name-only "$BASE_REF"...HEAD); UNEXPECTED=$(printf "%s\n" "$DIFF_FILES" | awk -v sprint="$SPRINT_DIR" "NF && \\$0 !~ (\"^(docs/fire-drills/kernel-v1-gpt55-team4-20260725\\\\.md|\" sprint \"/)\") { print }"); [ -z "$UNEXPECTED" ] || { echo "FAIL forbidden diff"; printf "%s\n" "$UNEXPECTED"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] BEH-06 覆盖 CI 出口：GitHub PR URL 可读取且 required checks 全绿
  动作: 从 `initiative_runs.pr_url` 读取真实 PR URL，再用 `gh` 查询 PR 和 required checks。
  预期观察: PR URL 是 GitHub URL，required checks 通过；缺 gh/auth/PR 均 FAIL。
  验证命令: Test: manual:bash -c 'set -euo pipefail; DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"; RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"; if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then DB_URL="postgresql://host.docker.internal/cecelia"; fi; PR_URL=$(psql "$DB_URL" -tAc "SELECT COALESCE(pr_url,'\'''\'') FROM initiative_runs WHERE id='\''$RUN_ID'\''::uuid" | tr -d " "); [ -n "$PR_URL" ] || { echo "FAIL no PR URL"; exit 1; }; gh pr view "$PR_URL" --json url --jq ".url" | grep -q "^https://github.com/" || { echo "FAIL gh pr view"; exit 1; }; gh pr checks "$PR_URL" --required --watch --interval 10 --fail-fast; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-1 smoke/DevGate 铁律：本 sprint 不改源码 smoke/allowlist，唯一产品 diff 仍为 docs/fire-drills 文档
  动作: 执行同一 diff allowlist，确认未碰 `packages/quality/smoke-allowlist.txt`、workflow、source 和 scripts。
  预期观察: 禁止路径集合为空。
  验证命令: Test: manual:bash -c 'set -euo pipefail; git fetch origin main >/dev/null 2>&1; BASE_REF="${BASE_REF:-origin/main}"; git rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || { echo "FAIL base ref"; exit 1; }; BAD=$(git diff --name-only "$BASE_REF"...HEAD | awk "/^(packages\\/|apps\\/|scripts\\/|\\.github\\/|config\\/|database\\/|docker\\/|package(-lock)?\\.json|DEFINITION\\.md|VERSION)/ { print }"); [ -z "$BAD" ] || { echo "FAIL forbidden product/test infra paths"; printf "%s\n" "$BAD"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] INV-2 凭据安全：合同与 fire-drill 文档不含 secret/token 形态
  动作: 扫描合同产物和唯一交付文档。
  预期观察: 不出现 GitHub token、OpenAI/Anthropic key 形态。
  验证命令: Test: manual:bash -c 'node -e "const fs=require('\''fs'\'');const paths=['\''sprints/07251630-kernel-gpt55-team4/contract-draft.md'\'','\''sprints/07251630-kernel-gpt55-team4/contract-dod.md'\'','\''docs/fire-drills/kernel-v1-gpt55-team4-20260725.md'\''];const re=/ghp_[A-Za-z0-9]|gho_[A-Za-z0-9]|ghs_[A-Za-z0-9]|github_pat_|sk-[A-Za-z0-9]{20,}/;for(const p of paths){if(!fs.existsSync(p))throw new Error('\''missing '\''+p);if(re.test(fs.readFileSync(p,'\''utf8'\'')))throw new Error('\''secret leaked in '\''+p);}"; echo OK'
  期望: OK

## Invariant 铁律逐条映射

- INV-01 LaunchAgents 常驻服务禁区：N/A，本 sprint 不新增本机常驻服务。
- INV-02 共享 CI 基础设施禁区：BEH-05/INV-1 确认不改 `.github/workflows` 和 smoke allowlist。
- INV-03 同一语义判变一致：BEH-04 以 `initiative_runs.evaluate_verdict/judge_verdict` 为唯一 verdict 真相。
- INV-04 Test Contract 四列表：ARTIFACT 第 3 条覆盖。
- INV-05 表名认领冲突：N/A，本 sprint 不建表、不写 DB。
- INV-06 后台 job 消费方：N/A，本 sprint 不新增后台 job。
- INV-07 PR head SHA 与 evaluator/judge verdict 锚定：BEH-04/BEH-06 以当前 PR 和 DB verdict 为门禁；controller 继续负责 SHA 锚定。
- INV-08 `git rev-parse --verify`：BEH-05/BEH-06 使用 `git rev-parse --verify "$BASE_REF^{commit}"`。
- INV-09 smoke 铁律：INV-1 明确不碰 smoke/allowlist。
- INV-10 服务存活双信号：N/A，本 sprint 不新增服务存活判定。
- INV-11 headed relay payload 锚点：task payload 已含 base_repo/worktree_path，Step 1 真实 shape 核对。
- INV-12 时间常数关系：N/A，本 sprint 不改时间常数。
- INV-13 真环境验证才 done：本合同 target_environment=local_api，真 Brain/DB/gh 验证后才 PASS。
- INV-14 catch 吞错后台 job 指标：N/A，本 sprint 不改后台 job。
- INV-15 dep audit：N/A，本 sprint 不改依赖。
- INV-16 日志脱敏/PII：INV-2 扫描 token/secret；PRD 无聊天内容交付。
- INV-17 毕业测试入册：N/A，本 sprint tests 是 Harness 合同临时产物，generator 不新增永久测试基础设施。
- INV-18 API 鉴权：N/A，本 sprint 不新增 API。
- INV-19 多租户隔离：N/A，本 sprint 不读写租户数据。
- INV-20 新 cron 检查 JOBS：N/A，本 sprint 不新增 cron。
- INV-21 secrets 不进 git：INV-2 覆盖。
- INV-22 生产实体自报为判变基准：BEH-04 使用 DB verdict，BEH-06 使用 gh PR checks。
- INV-23 通知语义字段：N/A，本 sprint 不发通知。
- INV-24 journey_features 停滞探针：N/A，本 sprint journey_id none。
- INV-25 新 task_type 七点清单：N/A，本 sprint 不新增 task_type。
- INV-26 禁写死环境假设值：E2E 端口/DB/路径均可由 env 覆盖，默认只作 local_api fallback。
- INV-27 watchdog/orphan 恢复：N/A，本 sprint 不改 watchdog。
- INV-28 lint-test-quality async read：N/A，本 sprint 不改产品测试。
- INV-29 生产资源触碰：BEH-05/INV-1 禁止 scripts/packages 等生产资源改动。
- INV-30 租户隔离：N/A，同 INV-19。
- INV-31 退役复活读历史：N/A，本 sprint 不复活退役功能。
- INV-32 headed relay env 透传：Step 1 task payload shape 核对，未改 tmux innerCmd。
- INV-33 Red commit 精确 add：本合同产物路径明确；generator 后续只允许 fire-drill 文档。
- INV-34 slot 串行：N/A，controller 调度纪律，不由本交付改动。
- INV-35 Proposer 复用模板需核对真实历史：已读取真实 task API、dispatcher、attempt migration。
- INV-36 新字段语义重叠不留债：N/A，本 sprint 不新增字段。
- INV-37 部署失败非 warning：BEH-04/BEH-06 fail closed。
- INV-38 host/环境白名单断言核对 headed：N/A，本 sprint target=local_api。
- INV-39 常驻宿主服务 manifest：N/A，本 sprint 不新增服务。
- INV-40 多轮扫描状态：N/A，本 sprint 不改扫描。
- INV-41 theater mismatch：target_environment=local_api，合同不引入 Android/微信路径。
- INV-42 回归测试 source inspection：ARTIFACT 与 BEH-05 只作边界检查，运行态由 Brain/DB/gh 真验。
- INV-43 DB 字段长度：N/A，本 sprint 不写 DB 字段。
- INV-44 manual oracle 真 exit code：BEHAVIOR 均为 manual:bash，evaluator 必记录 exit_code/log_tail。
- INV-45 Brain judge API 格式：N/A，本 sprint 不改 judge API；BEH-04 要求 judge PASS。
- INV-46 周期性重扫付费调用：N/A，本 sprint 不触发 LLM/第三方付费调用。
- INV-47 generator 不自行 merge：BEH-04/BEH-06 只验证，不授权 generator merge。
- INV-48 controller report 不只看 exit code：BEH-04 使用 evaluator/judge DB verdict。
- INV-49 null/false 失败分支：N/A，本 sprint 不改函数契约。
- INV-50 退役判断查生产库：N/A。
- INV-51 合同批准前 manual oracle 真实 exit code：由 evaluator 真跑 BEHAVIOR 记录。
- INV-52 target_environment 来源：task payload target_environment=local_api，Step 1 核对。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api final-e2e 全链路执行 `contract-draft.md` 的 E2E bash 块
  期望: 脚本 exit 0；log_tail 含 `OK: Kernel v1 GPT-5.5 team4 canary verified`；behavior_tests 记录 exit_code/log_tail。
