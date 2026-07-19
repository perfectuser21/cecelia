contract_branch: cp-07191320-harness-prd
sprint_dir: sprints/07191312-relay-57e25e92

---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: headed relay 派发链路自测（claude-headed, task 57e25e92）

**范围**: 新增锚定 task_id=57e25e92-84a3-4599-992c-b4b74ec54acc 的 `sprints/07191312-relay-57e25e92/e2e-verify.sh`；复用（不重实现）`packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh`；只读校验 Brain task 记录与 `initiative_runs` 记录状态；不新增业务功能、dashboard/UI、migration，不改 `claude-headed-dispatch-smoke.sh` 本体，不改 `ci.yml`，不重复登记 allowlist。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] contract draft 含 Golden Path 与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07191312-relay-57e25e92/contract-draft.md','utf8');if(!c.includes('## Golden Path')||!c.includes('## E2E 验收'))process.exit(1)"

- [ ] [ARTIFACT] generator 补 sprint-local e2e wrapper，锚定当前 task_id（路径按 PRD 字面固定，不用历史漂移路径）
  Test: node -e "const fs=require('fs');const p='sprints/07191312-relay-57e25e92/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');if(!c.includes('claude-headed-dispatch-smoke.sh')||!c.includes('57e25e92-84a3-4599-992c-b4b74ec54acc'))process.exit(1)"

- [ ] [ARTIFACT] 复用的 claude headed smoke 已在 allowlist 登记（不重复登记，只校验存在）
  Test: grep -Fxq "claude-headed-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt

- [ ] [ARTIFACT] Invariant 端点鉴权 auth：N/A，本 sprint 不新增或修改 API 端点
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07191312-relay-57e25e92/contract-dod.md','utf8');if(!c.includes('端点鉴权 auth：N/A')||!c.includes('不新增或修改 API 端点'))process.exit(1)"

- [ ] [ARTIFACT] Invariant 租户隔离 tenant：N/A，本 sprint 不查询或修改租户作用域数据
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07191312-relay-57e25e92/contract-dod.md','utf8');if(!c.includes('租户隔离 tenant：N/A')||!c.includes('不查询或修改租户作用域数据'))process.exit(1)"

- [ ] [ARTIFACT] e2e-verify.sh 逐字保留全部 GP-STEP-1~GP-STEP-4 BEGIN/END 标记，且标记之间的原文内容含真实断言原语字面串（round 3 新增标记存在性硬闸，round 4 升级为内容级校验——呼应 reviewer 第三轮反馈：round 3 版本只验证"标记文字在不在"，无法拦截"标记保留但段内被替换成占位注释"的假绿场景，reviewer 已实测复现该漏洞。round 4 改为先用 indexOf 定位每对 BEGIN/END 精确边界切出段落原文，再对切出内容做字面串包含校验：GP-STEP-1 段须含 `claude-headed-dispatch-smoke.sh` 且含 `grep -Fxq`；GP-STEP-2 段须含 `curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"` 且 `jq -e` 出现次数 ≥4；GP-STEP-3 段须含 `psql "$DB"` 且含 `is_fresh`）
  Test: node -e "const fs=require('fs');const p='sprints/07191312-relay-57e25e92/e2e-verify.sh';const c=fs.readFileSync(p,'utf8');function seg(step){const b='# '+step+' BEGIN',e='# '+step+' END';const bi=c.indexOf(b),ei=c.indexOf(e);if(bi===-1||ei===-1||ei<bi)return null;return c.slice(bi+b.length,ei);}const steps=['GP-STEP-1','GP-STEP-2','GP-STEP-3','GP-STEP-4'];for(const s of steps){if(seg(s)===null){console.error('missing marker segment: '+s);process.exit(1);}}const gp1=seg('GP-STEP-1');if(!gp1.includes('claude-headed-dispatch-smoke.sh')||!gp1.includes('grep -Fxq')){console.error('GP-STEP-1 内容不足（标记保留但内容被掏空）');process.exit(1);}const gp2=seg('GP-STEP-2');if(!gp2.includes('curl -sf \"\$BRAIN_URL/api/brain/tasks/\$TASK_ID\"')){console.error('GP-STEP-2 缺真实 curl 断言字面串（标记保留但内容被掏空）');process.exit(1);}const jqCount=(gp2.match(/jq -e/g)||[]).length;if(jqCount<4){console.error('GP-STEP-2 jq -e 断言数='+jqCount+' <4（标记保留但内容被掏空）');process.exit(1);}const gp3=seg('GP-STEP-3');if(!gp3.includes('psql \"\$DB\"')||!gp3.includes('is_fresh')){console.error('GP-STEP-3 缺 psql/is_fresh 断言字面串（标记保留但内容被掏空）');process.exit(1);}"

## Invariant 覆盖条目（PRD 铁律 1:1 映射，12 条 BEHAVIOR，来源: area）

- [ ] [BEHAVIOR] INV-1 (9202c14e) 失败路径禁止 warning 降级：所有失败分支必须显式 FAIL + exit 非零
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -inE "echo[[:space:]]+\"?WARN" "$SCRIPT" >/dev/null || { echo "FAIL: 脚本含 WARN 降级分支"; exit 1; }; grep -c "exit 1" "$SCRIPT" | grep -qE "^[1-9]" || { echo "FAIL: 脚本无显式 exit 1 失败路径"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-2 (5775d866) phase 合法枚举必须来自当前真实 DB CHECK 约束，不写死过期子集
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; LIVE=$(psql "$DB" -XAt -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='"'"'initiative_runs_phase_check'"'"'"); for p in A_planning A_contract B_task_loop C_final_e2e planning gan generate evaluate done; do echo "$LIVE" | grep -q "$p" || { echo "FAIL: 真实约束缺少 $p，脚本假设可能过期"; exit 1; }; grep -q "$p" "$SCRIPT" || { echo "FAIL: 脚本枚举缺少真实合法值 $p"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-3 (6414193b) 回归测试用 async function 包裹源码读取（满足 lint-test-quality）
  Test: manual:bash -c 'set -euo pipefail; T="tests/regression/relay-57e25e92/headed-smoke-contract.test.ts"; [ -f "$T" ] || { echo "FAIL: missing $T"; exit 1; }; grep -qE "async function" "$T" || { echo "FAIL: 测试文件无 async function 包裹"; exit 1; }; grep -qE "await " "$T" || { echo "FAIL: 测试文件无 await 调用"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-4 (14ed5336) Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹
  Test: manual:bash -c 'set -euo pipefail; C="sprints/07191312-relay-57e25e92/contract-draft.md"; [ -f "$C" ] || { echo "FAIL: missing $C"; exit 1; }; grep -qE "^\| 功能 \| Test File \| BEHAVIOR 覆盖 \| 预期红证据 \|$" "$C" || { echo "FAIL: Test Contract 表头不是固定 4 列格式"; exit 1; }; grep -qE "^\|.*\`tests/regression/relay-57e25e92" "$C" || { echo "FAIL: Test File 列未用 backtick 包裹路径"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-5 (c674ab49) 回归测试用 source-code inspection，不使用 mock/stub
  Test: manual:bash -c 'set -euo pipefail; T="tests/regression/relay-57e25e92/headed-smoke-contract.test.ts"; [ -f "$T" ] || { echo "FAIL: missing $T"; exit 1; }; ! grep -qE "vi\.mock|jest\.mock|sinon\.stub" "$T" || { echo "FAIL: 测试文件含 mock/stub"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-6 (72890f7c) 脚本关键变量必须显式默认值，不依赖隐式继承的父进程 env
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "TASK_ID=\"\${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}\"" "$SCRIPT" >/dev/null || { echo "FAIL: TASK_ID 未走显式默认值"; exit 1; }; grep -F "BRAIN_URL=\"\${BRAIN_URL:-http://localhost:5221}\"" "$SCRIPT" >/dev/null || { echo "FAIL: BRAIN_URL 未走显式默认值"; exit 1; }; grep -F "DB=\"\${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}\"" "$SCRIPT" >/dev/null || { echo "FAIL: DATABASE_URL 未走显式默认值"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-7 (8d92f7b1) 合同已核对本次任务真实派发/执行历史（当前实测记录存在）
  Test: manual:bash -c 'set -euo pipefail; C="sprints/07191312-relay-57e25e92/contract-draft.md"; [ -f "$C" ] || { echo "FAIL: missing $C"; exit 1; }; grep -q "\[当前实测\]" "$C" || { echo "FAIL: 合同缺当前实测记录"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-8 (1100cb8f) 本 sprint 不修改共享 CI 基础设施文件（workflows/allowlist）
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; DIRTY=$(git status --porcelain -- ".github/workflows/" "packages/quality/smoke-allowlist.txt" 2>/dev/null); [ -z "$DIRTY" ] || { echo "FAIL: 共享 CI 基础设施文件被改动: $DIRTY"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-9 (7ccfa168) 脚本不 spawn/kill 并发会话，单 slot 串行
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -E "tmux[[:space:]]+new-session|tmux[[:space:]]+kill|killall|pkill" "$SCRIPT" >/dev/null || { echo "FAIL: 脚本 spawn/kill 并发会话"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-10 (5e125909) 禁写死环境假设值：BRAIN_URL/DATABASE_URL 走 env，脚本无写死真实凭据/路径
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; ! grep -E "ssh[[:space:]]+|38\.23\.47\.81|/Users/administrator|/root/\.ssh|ghp_[A-Za-z0-9_]+" "$SCRIPT" >/dev/null || { echo "FAIL: 脚本含写死环境假设或凭据痕迹"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-11 (3c30394c) 真环境验证才算 done：必须打真实 Brain API + 真实 PostgreSQL + 真实 headed smoke，不允许 mock/stub/吞错
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "claude-headed-dispatch-smoke.sh" "$SCRIPT" >/dev/null || { echo "FAIL: 未调用真实 headed smoke"; exit 1; }; grep -F "curl -sf \"\$BRAIN_URL/api/brain/tasks/\$TASK_ID\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未 curl 真实 Brain task API"; exit 1; }; grep -F "psql \"\$DB\"" "$SCRIPT" >/dev/null || { echo "FAIL: 未查询真实 PostgreSQL"; exit 1; }; ! grep -E "MOCK_|mock|stub|\|\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$SCRIPT" >/dev/null || { echo "FAIL: 脚本含 mock/stub/吞错/无条件 exit 0"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-12 (564802ee) secrets 不硬编码：payload 拒绝 token/github_token/anthropic_token/thin_prd 明文字段
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; grep -F "has(\"token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 token 字段"; exit 1; }; grep -F "has(\"github_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 github_token 字段"; exit 1; }; grep -F "has(\"anthropic_token\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 anthropic_token 字段"; exit 1; }; grep -F "has(\"thin_prd\") | not" "$SCRIPT" >/dev/null || { echo "FAIL: payload 未拒绝 thin_prd 字段"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual: 命令，local_api 本机执行）

**round 2 修订说明（单一权威来源收敛，呼应 reviewer 第一轮反馈第 1 条）**：以下 3 条 BEHAVIOR 的断言逻辑不再独立重写，而是用 `awk` 从 `e2e-verify.sh` 的 `# GP-STEP-N BEGIN`~`# GP-STEP-N END` 标记段原样提取后直接执行——`e2e-verify.sh` 本体（`## E2E 验收` 唯一权威脚本）是断言逻辑的唯一物理来源，此处物理上不可能产生第二份漂移文本。第 4 条（完整 wrapper）本就是直接调用整份脚本，逻辑不变。

**round 3 修订说明（非空守卫 + 标记存在性硬闸，呼应 reviewer 第二轮反馈唯一阻塞项）**：reviewer 实测复现——若 `e2e-verify.sh` 的 `# GP-STEP-N BEGIN`/`# GP-STEP-N END` 标记注释被删除或重新措辞，`awk` 抽取会静默产出空文件（`/tmp/gp-stepN-57e25e92.sh` 大小为 0），随后 `bash -euo pipefail` 对空文件执行 exit 0，导致以下 3 条 BEHAVIOR 误判 OK（零断言实际执行）。本轮双重修复（互补不冲突）：① 以下 3 条 Test 命令在 `awk` 提取后、`bash` 执行前插入 `[ -s <tmpfile> ]` 非空守卫，提取为空立即打印诊断信息并 `exit 1`（运行时兜底）；② 新增一条 `[ARTIFACT]` 条目（见上方"e2e-verify.sh 逐字保留全部 GP-STEP-1~GP-STEP-4 BEGIN/END 标记注释行"），用 `grep`/字符串包含校验逐一确认生成的 `e2e-verify.sh` 字面包含全部 4 对（8 处）标记（构建期硬闸，独立于 awk 抽取路径，即使某条 BEHAVIOR 的非空守卫因其他原因被绕过，ARTIFACT 条目仍会拦截标记缺失）。

**round 4 修订说明（内容级字面串校验，呼应 reviewer 第三轮反馈唯一阻塞项：dod_machineability=4、verification_oracle_completeness=4）**：reviewer 三场景复测证明 round 3 的"存在性检查"不够——构造一份 GP-STEP-2/3 标记保留、段内只留 `# TODO: 断言逻辑已挪到别处，这里留空占位` 的假 `e2e-verify.sh`：① `[ARTIFACT]` 标记存在性检查 PASS（标记字面都在）；② 非空守卫也 PASS（占位注释非空，93 字节）；③ 最关键——直接 `bash e2e-verify.sh` 整体执行，GP-STEP-2/3 因是空注释直接跳过，GP-STEP-4 打印 OK，exit 0 全绿过关，但一次真实 Brain API/DB 调用都没发生。本轮修复（在现有 awk 抽取机制上追加内容级校验，不重新设计机制，同时覆盖"诊断命令"与"交付物整体"两层面）：① 以下 3 条 GP-STEP Test 命令在非空守卫之后追加内容级 `grep -qF`/`grep -o | wc -l` 校验，要求提取出的段落必须包含该步骤的关键断言原语字面串（GP-STEP-1 段须含 `claude-headed-dispatch-smoke.sh` 且含 `grep -Fxq`；GP-STEP-2 段须含 `curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID"` 且 `jq -e` 出现次数 ≥4；GP-STEP-3 段须含 `psql "$DB"` 且含 `is_fresh`）；② 上方 `[ARTIFACT]` 标记存在性条目原地升级为内容级校验（indexOf 切段落原文 + 同一组字面串断言）；③ 最关键——`e2e-verify.sh` 交付物本体（`## E2E 验收` 脚本）最开头新增 `# CONTENT-INTEGRITY-GATE` 段，脚本读取自身源码做同一组内容级自证，在执行任何 GP-STEP 之前先 FAIL，使"直接执行完整 e2e-verify.sh"（reviewer 场景 3，也是 BEHAVIOR-4 的检查对象）不再可能假绿。三个复测场景（无标记/标记保留内容掏空/完整脚本直接执行）的逐一复测结果见 contract-draft.md round 4 修订记录。

- [ ] [BEHAVIOR] e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记（从唯一权威脚本 GP-STEP-1 段提取执行）
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; awk "/# GP-STEP-1 BEGIN/{f=1;next} /# GP-STEP-1 END/{f=0} f" "$SCRIPT" > /tmp/gp-step1-57e25e92.sh; [ -s /tmp/gp-step1-57e25e92.sh ] || { echo "FAIL: GP-STEP-1 标记未在 e2e-verify.sh 中找到或提取为空"; exit 1; }; grep -qF "claude-headed-dispatch-smoke.sh" /tmp/gp-step1-57e25e92.sh || { echo "FAIL: GP-STEP-1 提取内容缺少 claude-headed-dispatch-smoke.sh 字面串（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; grep -qF "grep -Fxq" /tmp/gp-step1-57e25e92.sh || { echo "FAIL: GP-STEP-1 提取内容缺少 grep -Fxq 字面串（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; BRAIN_URL="$BRAIN_URL" DB="$DB" bash -euo pipefail /tmp/gp-step1-57e25e92.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] task payload 四字段齐全且不含敏感字段（从唯一权威脚本 GP-STEP-2 段提取执行，真实 curl 当前 task）
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}"; BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"; awk "/# GP-STEP-2 BEGIN/{f=1;next} /# GP-STEP-2 END/{f=0} f" "$SCRIPT" > /tmp/gp-step2-57e25e92.sh; [ -s /tmp/gp-step2-57e25e92.sh ] || { echo "FAIL: GP-STEP-2 标记未在 e2e-verify.sh 中找到或提取为空"; exit 1; }; grep -qF "curl -sf \"\$BRAIN_URL/api/brain/tasks/\$TASK_ID\"" /tmp/gp-step2-57e25e92.sh || { echo "FAIL: GP-STEP-2 提取内容缺少真实 curl Brain task API 断言字面串（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; JQC=$(grep -o "jq -e" /tmp/gp-step2-57e25e92.sh | wc -l | tr -d " "); [ "${JQC:-0}" -ge 4 ] || { echo "FAIL: GP-STEP-2 提取内容 jq -e 断言出现次数=${JQC:-0} <4，需覆盖 id/task_type/payload三元组/禁用字段（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; TASK_ID="$TASK_ID" BRAIN_URL="$BRAIN_URL" bash -euo pipefail /tmp/gp-step2-57e25e92.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] initiative_runs 含 skill-relay-claude-headed 且 phase 使用真实 DB 枚举拒绝 failed/unknown，且 started_at 新鲜度不早于 task.created_at（从唯一权威脚本 GP-STEP-3 段提取执行，真实 psql 定点查当前 task，round 2 新增新鲜度校验）
  Test: manual:bash -c 'set -euo pipefail; SCRIPT="sprints/07191312-relay-57e25e92/e2e-verify.sh"; [ -f "$SCRIPT" ] || { echo "FAIL: missing $SCRIPT"; exit 1; }; TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}"; DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"; awk "/# GP-STEP-3 BEGIN/{f=1;next} /# GP-STEP-3 END/{f=0} f" "$SCRIPT" > /tmp/gp-step3-57e25e92.sh; [ -s /tmp/gp-step3-57e25e92.sh ] || { echo "FAIL: GP-STEP-3 标记未在 e2e-verify.sh 中找到或提取为空"; exit 1; }; grep -qF "psql \"\$DB\"" /tmp/gp-step3-57e25e92.sh || { echo "FAIL: GP-STEP-3 提取内容缺少真实 psql 查询字面串（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; grep -qF "is_fresh" /tmp/gp-step3-57e25e92.sh || { echo "FAIL: GP-STEP-3 提取内容缺少 is_fresh 新鲜度断言字面串（标记保留但内容被掏空，round 4 内容级校验新增）"; exit 1; }; TASK_ID="$TASK_ID" DB="$DB" bash -euo pipefail /tmp/gp-step3-57e25e92.sh && echo OK'
  期望: OK（若 FAIL 且信息提示「已知外部时序依赖」，见 contract-draft.md Risks R1——不代表脚本实现有误，需等 orchestrator 推进落库后重跑）

- [ ] [BEHAVIOR] local_api E2E wrapper 锚定当前 task_id 完整验证 smoke/task/run 外部真相（整份 e2e-verify.sh 即唯一权威脚本本体，逻辑与上 3 条同源）
  Test: manual:bash -c 'TASK_ID="${TASK_ID:-57e25e92-84a3-4599-992c-b4b74ec54acc}" BRAIN_URL="${BRAIN_URL:-http://localhost:5221}" DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" bash sprints/07191312-relay-57e25e92/e2e-verify.sh'
  期望: OK
