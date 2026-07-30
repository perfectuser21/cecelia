contract_branch: cp-07301444-harness-prd
sprint_dir: sprints/07301431-relay-9f24e3a9

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: T10 统一收件箱完整性缺口修复（learnings → capture_atoms 路由补齐）

**范围**: `packages/brain/src/` 下 11 处 `INSERT INTO learnings` 调用点（`cortex.js:890`、`executor.js:1106`、`conversation-consolidator.js:161`、`learning.js:728`、`learning.js:779`、`auto-learning.js:98`、`chat-action-dispatcher.js:126`、`chat-action-dispatcher.js:267`、`decision-executor.js:321`、`decision-executor.js:400`、`fact-extractor.js:384`）逐一补齐 `pushCaptureAtom` 调用；新增 1 条永久 CI 结构性回归测试（source-code inspection，覆盖全部调用点）+ 1 条 `cortex.js::recordLearnings` 行为级复现测试。不改动已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js` learnings-received）、不改动 `capture-inbox.js` 内部实现、不改动 `ledger-hygiene.js` m7 探针判定逻辑。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增结构性回归测试文件 `packages/brain/src/__tests__/learnings-capture-atom-routing.test.js` 存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/learnings-capture-atom-routing.test.js','utf8');if(!c.includes('pushCaptureAtom')||!c.includes('INSERT INTO learnings'))process.exit(1)"

- [ ] [ARTIFACT] 新增行为级复现测试文件 `packages/brain/src/__tests__/cortex-learnings-capture-push.test.js` 存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/cortex-learnings-capture-push.test.js','utf8');if(!c.includes('pushCaptureAtom')||!c.includes('recordLearnings'))process.exit(1)"

- [ ] [ARTIFACT] 11 处调用点所在的 8 个源文件均新增 `pushCaptureAtom` 引用（静态文本检查，逐个文件确认，与结构性测试互为交叉验证）
  Test: node -e "const fs=require('fs');const files=['packages/brain/src/cortex.js','packages/brain/src/executor.js','packages/brain/src/conversation-consolidator.js','packages/brain/src/learning.js','packages/brain/src/auto-learning.js','packages/brain/src/chat-action-dispatcher.js','packages/brain/src/decision-executor.js','packages/brain/src/fact-extractor.js'];for(const f of files){const c=fs.readFileSync(f,'utf8');if(!c.includes('pushCaptureAtom')){console.error('MISSING pushCaptureAtom import/call in '+f);process.exit(1);}}"

## BEHAVIOR 条目（journey_type = autonomous，内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 结构性回归测试通过：`packages/brain/src/` 下所有 `INSERT INTO learnings` 调用点，其所在函数体内都含 `pushCaptureAtom`（source-code inspection，零 mock，永久 CI，防止未来新增写入点再次漏接）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose 2>&1 | tail -40; EXIT=${PIPESTATUS[0]:-$?}; [ "$EXIT" -eq 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] `cortex.js::recordLearnings` 行为级复现测试通过：写入 `learnings` 成功后调用 `pushCaptureAtom`，推送字段（targetType/targetSubtype/routedToTable/routedToId）与既有约定一致（复现 m7 探针误报的原始 issue 场景）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/cortex-learnings-capture-push.test.js --reporter=verbose 2>&1 | tail -60; EXIT=${PIPESTATUS[0]:-$?}; [ "$EXIT" -eq 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] pushCaptureAtom 调用失败不阻断 `learnings` 主写入（不得向上抛出未捕获异常，对齐 `learning.js:121` 既有容错模式）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/cortex-learnings-capture-push.test.js -t "pushCaptureAtom 抛错时" --reporter=verbose 2>&1 | tail -30; EXIT=${PIPESTATUS[0]:-$?}; [ "$EXIT" -eq 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js` learnings-received 端点）未被误改动，既有回归测试全绿
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/learning-capture-push.test.js src/__tests__/learnings-received.test.js --reporter=verbose 2>&1 | tail -60; EXIT=${PIPESTATUS[0]:-$?}; [ "$EXIT" -eq 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 真实触发（零 mock，真 Postgres）：调用 `auto-learning.js::createAutoLearning`（11 处调用点之一）写入一条新 learning 后，`capture_atoms`（经 `captures` 关联）在 5 分钟窗口内同步新增对应记录
  Test: manual:bash -c '
DB="${DB:-postgresql://cecelia@localhost:5432/cecelia_test}";
cd packages/brain;
MARKER_TITLE="dod-e2e-$(date +%s)-${RANDOM}";
RESULT=$(node --input-type=module -e "
import { createAutoLearning } from '"'"'./src/auto-learning.js'"'"';
import pool from '"'"'./src/db.js'"'"';
const r = await createAutoLearning({ title: '"'"'${MARKER_TITLE}'"'"', category: '"'"'dev_insight'"'"', content: '"'"'DoD 验收真实触发'"'"', triggerEvent: '"'"'dod_verify'"'"', metadata: {} });
console.log(JSON.stringify(r));
await pool.end();
");
echo "$RESULT" | grep -q "\"id\"" || { echo "FAIL: createAutoLearning 未返回 id"; exit 1; };
COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM capture_atoms ca JOIN captures c ON c.id = ca.capture_id WHERE ca.target_type='"'"'learning'"'"' AND c.content ILIKE '"'"'%${MARKER_TITLE}%'"'"' AND ca.created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ");
[ "$COUNT" -ge 1 ] || { echo "FAIL: capture_atoms 未同步产出 marker=${MARKER_TITLE}"; exit 1; };
echo OK'
  期望: OK

## Invariant 覆盖（来自 sprint-prd.md「Invariant 约束」段，逐条映射或 N/A）

- INV-1 单slot串行 — N/A：本 sprint 不涉及多 slot/多会话并发调度，纯代码路由补齐，单一 PR/单一 generator 顺序执行
- INV-2 禁止写死环境假设值 — N/A：本次改动不引入任何屏幕坐标/阈值/环境相关的硬编码值，11 处新增调用均是 `pushCaptureAtom(pool, {...})` 的纯代码调用，无环境假设
- INV-3 真环境验证才算done — 适用，已落地为下方独立 BEHAVIOR 条目（`## E2E 验收` 对 `auto-learning.js::createAutoLearning` 做真实 Postgres 端到端触发 + `psql` 验证，零 mock）
- INV-4 测试默认多租户 — N/A：`learnings`/`captures`/`capture_atoms` 三张表均无 `tenant_id` 列（已用 `psql \d` 核实），系统当前为单租户内部系统，不适用
- INV-5 凭据安全 — N/A：本次不涉及任何新增/修改凭据、密钥、token
- INV-6 日志脱敏 — N/A：新增调用仅传递 `targetType`/`targetSubtype`/`content`（learning 自身的 title/summary，属系统内部学习记录，非用户对话 PII），无新增日志语句包含用户隐私内容
- INV-7 端点鉴权 — N/A：本次未新增/未修改任何 HTTP API 端点
- INV-8 租户隔离 — N/A：同 INV-4，无租户概念，不适用
- INV-9 表名认领冲突 — N/A：`capture_atoms`/`captures` 均为既有表，写入方唯一入口仍是既有的 `capture-inbox.js::pushCaptureAtom`（本次只是让另外 11 处调用这个既有单一入口，不新建表、不新增写入方式）
- INV-10 无消费方不上线 — N/A：`capture_atoms` 已有既存消费方（capture-triage 分诊链路），本次只是让更多来源接入同一条既有消费链路，不产生"无消费方"风险
- INV-11 错误码契约需显式else — N/A（沿用既有惯例）：`pushCaptureAtom` 失败时已在内部完成 `console.warn`（`capture-inbox.js:98`）记录，可观测性由被调用方自身保证；已接入的 2 处 wired 路径（`learning.js:121`）同样不显式检查返回值，本次遵循同一既定调用惯例，不引入新违规也不扩大既有敞口
- INV-12 语义字段判定成功 — N/A：`pushCaptureAtom` 是 fire-and-forget 式辅助写入（不影响调用方主流程判断成功与否），调用方无需依赖其返回值做业务判断
- INV-13 回归测试用source-code inspection — 适用，已落地为下方独立 BEHAVIOR 条目（`tests/learnings-capture-atom-routing.test.js`，零 mock 遍历全部 `INSERT INTO learnings` 调用点）
- INV-14 catch吞错需告警 — N/A（既有敞口，非本次引入，范围限定排除）：`pushCaptureAtom` 内部 catch 吞错目前只有 `console.warn`，未接失败计数/连续阈值告警；该行为在已接入的 2 处路径中已长期存在，本次只是让另外 11 处复用同一既有函数（PRD「不在范围内」明确排除"修改 capture-inbox.js 内部实现"），不扩大也不缩小该既有风险敞口；若需要落地失败计数+告警，应作为独立 sprint 处理 capture-inbox.js 本身

- [ ] [BEHAVIOR] INV-3/真环境验证：`auto-learning.js::createAutoLearning` 真实 Postgres 触发后，`## E2E 验收` 脚本（`contract-draft.md`）中的 psql 时间窗口验证片段存在且指向真实 DB 查询
  Test: manual:bash -c 'grep -q "COUNT=\$(psql" sprints/07301431-relay-9f24e3a9/contract-draft.md && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] INV-13/source-code inspection：结构性回归测试通过（同上"结构性回归测试通过"条目，此处作为 invariant 落地的独立复核）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose 2>&1 | tail -10; EXIT=${PIPESTATUS[0]:-$?}; [ "$EXIT" -eq 0 ] && echo OK || exit 1'
  期望: OK

## BEHAVIOR:E2E 条目

N/A — `journey_type=autonomous` + `target_environment=local_api`，无浏览器/UI，不适用 Mode B Playwright 截图流程；Mode B 的对应验证已由上方「BEHAVIOR 条目」的 manual:bash 命令 + `## E2E 验收`（`contract-draft.md`）脚本承担。
