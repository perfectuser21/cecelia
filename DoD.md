contract_branch: cp-07151221-harness-propose-r1-cd0b936c
sprint_dir: sprints/07151206-relay-cd0b936c

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: claude-headed-smoke 回归冒烟（第二轮，扩展 nightly 池覆盖）

**范围**: 新增 `sprints/07151206-relay-cd0b936c/e2e-verify.sh`，内容对齐既有
`scripts/smoke/e2e/relay-4bb31ef5.sh` 的验证项，TASK_ID/SPRINT_DIR 默认值改绑本轮
task_id=cd0b936c-2891-4fed-a921-5636ca08d1e8。不修改 `relay-4bb31ef5.sh` / `ci.yml` /
`smoke-allowlist.txt`。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/07151206-relay-cd0b936c/e2e-verify.sh` 存在，结构对齐 relay-4bb31ef5.sh
  Test: node -e "const c=require('fs').readFileSync('sprints/07151206-relay-cd0b936c/e2e-verify.sh','utf8');if(!c.includes('claude-headed-dispatch-smoke.sh')||!c.includes('initiative_runs')||!c.includes('skill-relay-claude-headed'))process.exit(1)"

- [ ] [ARTIFACT] `relay-4bb31ef5.sh` 未被修改（历史锚点保留）
  Test: git diff --quiet HEAD -- scripts/smoke/e2e/relay-4bb31ef5.sh

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] e2e-verify.sh 的 TASK_ID 默认值真实求值等于本轮 task_id（非照抄旧文件默认值）
  Test: manual:bash -c 'OUT=$(bash -c "source <(grep -E \"^TASK_ID=\" sprints/07151206-relay-cd0b936c/e2e-verify.sh); echo \$TASK_ID"); [ "$OUT" = "cd0b936c-2891-4fed-a921-5636ca08d1e8" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] e2e-verify.sh 对真实 Brain API + 真实 DB 全流程执行返回 PASS（正向路径，无 mock）
  Test: manual:bash -c 'BRAIN_URL=http://localhost:5221 DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07151206-relay-cd0b936c/e2e-verify.sh | grep -q "OK headed smoke regression verified for cd0b936c-2891-4fed-a921-5636ca08d1e8" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_runs 真实查询：本轮 task_id 对应行 orchestrator_host=skill-relay-claude-headed 且 phase 非 failed
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; ROW=$(psql "$DB" -XAt -F "|" -c "SELECT orchestrator_host, phase FROM initiative_runs WHERE initiative_id='"'"'cd0b936c-2891-4fed-a921-5636ca08d1e8'"'"' ORDER BY started_at DESC LIMIT 1"); HOST=$(echo "$ROW" | cut -d"|" -f1); PHASE=$(echo "$ROW" | cut -d"|" -f2); [ "$HOST" = "skill-relay-claude-headed" ] && [ "$PHASE" != "failed" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 陌生 task_id 下脚本必须 FAIL（exit 非 0），且不 sleep/retry 掩盖（耗时 < 15s）
  Test: manual:bash -c 'START=$(date +%s); TASK_ID=00000000-0000-0000-0000-000000000000 BRAIN_URL=http://localhost:5221 DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07151206-relay-cd0b936c/e2e-verify.sh >/tmp/e2e-verify-neg.log 2>&1; CODE=$?; END=$(date +%s); [ "$CODE" -ne 0 ] && [ $((END-START)) -lt 15 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] ci.yml 判定分支优先级断言未回归（claude-headed 精确判定行号早于 codex 通用兜底 seed 行号，#3829 修复未被破坏）
  Test: manual:bash -c 'CLAUDE_LINE=$(grep -n "skill-relay-claude-headed" .github/workflows/ci.yml | head -1 | cut -d: -f1); CODEX_LINE=$(grep -n "\"executor\":\"codex\"" .github/workflows/ci.yml | head -1 | cut -d: -f1); [ -n "$CLAUDE_LINE" ] && [ -n "$CODEX_LINE" ] && [ "$CLAUDE_LINE" -lt "$CODEX_LINE" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] allowlist 登记复用检查——claude-headed-dispatch-smoke.sh 仍登记在 smoke-allowlist.txt（本轮不新增不删除）
  Test: manual:bash -c 'grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 毕业路径预演——graduate-sprint-tests.mjs 对本 sprint 目录的规划输出 e2e 目标路径字面等于 scripts/smoke/e2e/relay-cd0b936c.sh
  Test: manual:bash -c 'node -e "import(\"./scripts/graduate-sprint-tests.mjs\").then(m=>{const p=m.planGraduation(process.cwd(),\"sprints/07151206-relay-cd0b936c\");const e=p.e2e[0];if(!e||e.to!==\"scripts/smoke/e2e/relay-cd0b936c.sh\"){console.error(\"FAIL\",e);process.exit(1)}console.log(\"OK\")})"'
  期望: OK

## Invariant 覆盖条目（PRD 铁律清单逐条映射 — Step 1.3）

- [ ] [BEHAVIOR] INV-1 smoke 登记纪律：e2e-verify.sh 复用的 claude-headed-dispatch-smoke.sh 仍在 smoke-allowlist.txt 登记（不新增独立 smoke.sh，不触发新登记要求；复用同一条 BEHAVIOR 断言：allowlist 登记复用检查）
  Test: manual:bash -c 'grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-2 真环境验证才算done：e2e-verify.sh 全部断言直接打真实 Brain API（localhost:5221）与真实 PostgreSQL，无 force_*/mock/stub（复用「正向路径」BEHAVIOR 断言即验证此铁律）
  Test: manual:bash -c 'grep -qE "MOCK_|force_result|force_timeout|jest\.mock|vi\.mock" sprints/07151206-relay-cd0b936c/e2e-verify.sh && exit 1 || echo OK'
  期望: OK

- [ ] INV-3 禁止写死环境假设值：N/A —— 本脚本无屏幕坐标/UIA阈值等环境假设值，仅使用可通过环境变量覆盖的 TASK_ID/SPRINT_DIR/BRAIN_URL/DATABASE_URL 默认值（均可被真实环境覆盖，非硬编码假设）

- [ ] [BEHAVIOR] INV-4 凭据安全：e2e-verify.sh 保留 payload 敏感字段反向检查（token/github_token/anthropic_token/thin_prd 不应出现在 payload）
  Test: manual:bash -c 'grep -q "has(\"token\")" sprints/07151206-relay-cd0b936c/e2e-verify.sh || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-5 日志脱敏：e2e-verify.sh 保留 tui.log 敏感字段扫描（token|github_token|anthropic_token|thin_prd|ghp_ 不得明文出现）
  Test: manual:bash -c 'grep -qE "token.*github_token.*anthropic_token.*thin_prd.*ghp_" sprints/07151206-relay-cd0b936c/e2e-verify.sh || exit 1; echo OK'
  期望: OK

- [ ] INV-6 单slot串行：N/A —— 本脚本是只读校验脚本，不派发/不调度任务，不涉及跨 slot 并行执行

## BEHAVIOR:E2E 条目

（dev_pipeline / local_api — 无 UI，不适用截图型 BEHAVIOR:E2E，模式 B final-e2e 见 contract-draft.md `## E2E 验收` 段的 bash 脚本）
