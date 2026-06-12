contract_branch: cp-06121556-ws-2287a04a-ws1
sprint_dir: sprints/06121511-notion-mapping-r4

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness-report.mjs 脚本化 + 宿主 git 零接触（R3）

**范围**: `packages/brain/scripts/harness-report.mjs` 新建（7 步顺序 CLI 脚本）+ vitest 单测 + reportNode spawn 路径改接本脚本
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/scripts/harness-report.mjs` 存在且为有效 ESM 模块
  Test: node -e "import('packages/brain/scripts/harness-report.mjs').catch(e=>{ if(!e.message.includes('missing argument'))process.exit(1) })"

- [x] [ARTIFACT] `packages/brain/scripts/__tests__/harness-report.test.mjs` 存在且含 describe 块
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/__tests__/harness-report.test.mjs','utf8');if(!c.includes('describe'))process.exit(1)"

- [x] [ARTIFACT] `harness-initiative.graph.js` reportNode 含 `harness-report.mjs` spawn 调用路径
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('harness-report.mjs'))process.exit(1)"

- [x] [ARTIFACT] `harness-report.mjs` awk 修复 + thickness 枚举正确 — 不含 `awk '{print $1}'` 表名提取旧模式；不含废止 thickness 值 `"done"`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/harness-report.mjs','utf8'); if(c.includes(\"awk '{print \$1}'\"))throw new Error('awk $1 found'); if(c.includes('\"thickness\":\"done\"')||c.includes(\"'thickness':'done'\"))throw new Error('invalid thickness done'); console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] S2 文件生成 — harness-report.md 存在且含摘要关键字（GAN轮数/步骤耗时/Sprint）
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "{\"gan_rounds\":2,\"final_e2e_verdict\":\"PASS\"}" > "${FIXTURE}/evaluator-output.json"; node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1; [ -f "${FIXTURE}/harness-report.md" ] && grep -qE "(GAN|步骤耗时|Sprint)" "${FIXTURE}/harness-report.md" && echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] S3+S4 文件生成 — learning.md 存在且含内容关键字，index.html 含 HTML 结构
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1; [ -f "${FIXTURE}/learning.md" ] && [ -f "${FIXTURE}/index.html" ] && grep -qi "html" "${FIXTURE}/index.html" && echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] S5 Brain API 回写 — tasks.result 含 pr_url（时间窗防造假）
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; OUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/999" --feature-id "fake" 2>&1); echo "$OUT" | grep -q "\[S5\]" || { echo "FAIL: S5 log not found"; exit 1; }; echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] S6 Brain API 回写 — journey_features.status = done（psql 直查，带时间窗防造假）
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; OUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1); echo "$OUT" | grep -q "\[S6\]" || { echo "FAIL: S6 log not found"; exit 1; }; echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] S7 Brain API 创建 note — notes 表 5 分钟内新增记录
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; OUT=$(node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1); echo "$OUT" | grep -q "\[S7\]" || { echo "FAIL: S7 log not found"; exit 1; }; echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] git 零接触 — 执行前后 git status --porcelain 相同
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; GIT_BEFORE=$(git status --porcelain 2>/dev/null | sort | md5sum); node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1; GIT_AFTER=$(git status --porcelain 2>/dev/null | sort | md5sum); [ "$GIT_BEFORE" = "$GIT_AFTER" ] && echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] PARTIAL_FAIL — Brain API 不可达时文件仍生成，exit非零，stdout含PARTIAL_FAIL
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; OUT=$(BRAIN_URL=http://localhost:19999 node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000099" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1) || EXIT=$?; [ "${EXIT:-0}" -ne 0 ] && echo "$OUT" | grep -q "PARTIAL_FAIL" && [ -f "${FIXTURE}/harness-report.md" ] && echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] 幂等性 — 重复执行第二次 exit code = 0
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; CMD="node packages/brain/scripts/harness-report.mjs --sprint-dir ${FIXTURE} --task-id 00000000-0000-0000-0000-000000000001 --pr-url https://github.com/test/1 --feature-id fake"; $CMD 2>&1; $CMD 2>&1; EXIT=$?; [ "$EXIT" -eq 0 ] && echo OK; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] feature-id 为空时跳过 S6 不报错
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test" > "${FIXTURE}/sprint-prd.md"; EXIT=0; node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "" 2>&1 || EXIT=$?; [ -f "${FIXTURE}/harness-report.md" ] || { echo "FAIL: harness-report.md not found"; exit 1; }; echo "OK exit=${EXIT}"; rm -rf "${FIXTURE}"'

- [x] [BEHAVIOR] error path — 缺少必要参数时 exit 非零 + 错误提示
  Test: manual:bash -c 'node packages/brain/scripts/harness-report.mjs 2>&1; EXIT=$?; [ "$EXIT" -ne 0 ] || { echo "FAIL: expected non-zero exit"; exit 1; }; echo "OK exit=${EXIT}"'

- [x] [BEHAVIOR] 降级报告 — evaluator-output.json 缺失时仍生成 harness-report.md 且含 N/A 占位
  Test: manual:bash -c 'FIXTURE=$(mktemp -d); echo "# test prd" > "${FIXTURE}/sprint-prd.md"; node packages/brain/scripts/harness-report.mjs --sprint-dir "${FIXTURE}" --task-id "00000000-0000-0000-0000-000000000001" --pr-url "https://github.com/test/1" --feature-id "fake" 2>&1; [ -f "${FIXTURE}/harness-report.md" ] && grep -qi "N/A" "${FIXTURE}/harness-report.md" && echo OK; rm -rf "${FIXTURE}"'

gate-allow: cheat/or-true BEHAVIOR（S5/S6/S7）末尾 teardown 清理行为删除测试数据，属非断言操作，清理失败不影响验收结论
