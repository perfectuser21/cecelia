# Contract DoD — 主理人对话回路 PR4/4

**Task ID**: 2a4ead8d-a979-48e6-b317-676129e45f6a
**Journey Type**: user_facing
**Target Environment**: mac_web + local_api
**Date**: 2026-07-28

---

## 八要素 Checklist

| # | 要素 | 答案 |
|---|------|------|
| 1 | journey_type | user_facing |
| 2 | target_environment | mac_web（Playwright localhost:5174 用于 E2E-4 全流程）+ local_api（shell hook + vitest 单测）|
| 3 | 是否有新增 HTTP 端点 | 否，均为内部逻辑（shell/文件/测试/文档） |
| 4 | DB 写路径 | conversations 表 status→archived（conversation-ttl-archiver）|
| 5 | 接缝点数量 | 3 个（transcript 文件读、Brain curl 对账、.conversation-mode 锁文件）|
| 6 | mock 豁免 | vitest mock pool（TTL archiver 单测）— 已登记未覆盖真实链路清单 |
| 7 | 第三方 API 依赖 | 无 |
| 8 | 铁律覆盖 | INV-1~INV-9 全部映射，见下方铁律覆盖段 |

---

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|--------|--------|------|--------|
| stop-conversation.sh exit code | exit 0/2 验证 | 真实调用脚本检查 exit code | Hook 语义由 exit code 决定，必须真实验证 | 静默放行未落库决策（P0） |
| pending_user block 行为 | grep stdout + exit code | grep stdout（含"等待用户确认"）+ exit 2 | PRD 明确要求 stdout 包含提示文字 | ⚠️ 用户误认为会话结束而实则被 block（直接面客错误） |
| TTL archiver SQL 过滤条件 | mock pool.query capture | SQL 字面量 match | 避免 SQL 写错导致归档非期望记录 | 归档未到期对话（P1 数据错误） |
| .conversation-mode 写/删时机 | 文件存在性检查 | 真实文件 stat | 锁文件存在才触发 stop-conversation 路由 | stop.sh 路由失效，Hook 永远不触发（P1） |

---

## 铁律（Invariant）覆盖

| INV | 铁律内容 | 覆盖方式 |
|-----|---------|---------|
| INV-1 | conversations.journey_id 外键约束真实 journeys.id | N/A：本 PR 不新增 conversation 创建逻辑，由 PR1 保证 |
| INV-2 | gp_id 必须是真实 golden_path.id，后端校验不存在则 404 | N/A：本 PR 不修改 gp_id 校验逻辑 |
| INV-3 | 所有 agent 调用必须经 POST /api/brain/conversations/:id/messages | N/A：本 PR 不新增调用路径，由 PR2 保证 |
| INV-4 | turn_count 由后端写消息递增，前端只读 | N/A：本 PR 不修改 turn_count 逻辑 |
| INV-5 | decisions 是唯一落库入口，archived_summary 只做摘要索引 | B-03 BEHAVIOR 验证：decisions 落库验证（decision_saved 对账必须查 decisions 表） |
| INV-6 | decision_saved=<uuid> 声明与 decisions 落库之间不允许窗口期 | B-01 BEHAVIOR：stop hook 验证 UUID 对账，DB 无记录 → exit 2，强制原子性 |
| INV-7 | TTL archiver 只软归档（status→archived），不删行不删消息 | B-05 BEHAVIOR：SQL 验证只 UPDATE status，不 DELETE |
| INV-8 | 单 slot 串行，同时只允许一个任务在跑 | N/A：本 PR 不修改调度逻辑 |
| INV-9 | secrets 不硬编码不进 git，聊天内容不明文进日志 | N/A：SKILL.md 文档约束，代码层不涉及 secret |

---

## [ARTIFACT] 静态产出物

- [ ] [ARTIFACT] `packages/workflows/skills/conversation-agent/SKILL.md` 存在，且含 decision_saved / pending_user / turn_marker 三个关键词
- [ ] [ARTIFACT] `packages/engine/hooks/stop-conversation.sh` 含 pending_user 分支（grep -q "pending_user"）
- [ ] [ARTIFACT] `packages/brain/src/__tests__/conversation-ttl-archiver.test.js` 存在（可能已有，PR4 补强）
- [ ] [ARTIFACT] `packages/brain/src/lib/conversation-agent.js` 含 `.conversation-mode` 写入/删除逻辑

---

## [BEHAVIOR] 行为断言

- [ ] [BEHAVIOR] [L2] B-01: stop-conversation.sh 对 decision_saved fake uuid → exit 2 [接缝×2]
  动作: 构造含 `[TURN: decision_saved=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]` 的 transcript JSONL + `.conversation-mode` 文件，调用 stop-conversation.sh（Brain DB 无该 uuid）
  预期观察: exit code = 2，stdout 含 decision uuid 相关告警（uuid 未找到）
  等待预算: 10s（curl timeout ≤ 8s）
  留证: /tmp/e2e1_out.txt + exit code 输出
  Test: manual:bash -c 'TMP1=$(mktemp -d); TRANSCRIPT1="$TMP1/transcript.jsonl"; printf '"'"'{"role":"assistant","content":"[TURN: decision_saved=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]"}\n'"'"' > "$TRANSCRIPT1"; touch "$TMP1/.conversation-mode"; CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT1" bash -c "cd $TMP1 && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/b01_out.txt 2>&1; RC=$?; rm -rf "$TMP1"; [ $RC -eq 2 ] && echo "B-01 PASS exit=2" || { echo "FAIL exit=$RC"; cat /tmp/b01_out.txt; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: stop-conversation.sh pending_user 阻断 → exit 2 + stdout 含阻断提示 [接缝×2]
  动作: 构造末轮含 `[TURN: pending_user]` 的 transcript JSONL + `.conversation-mode` 文件，调用 stop-conversation.sh
  预期观察: exit code = 2，stdout 含"等待用户确认"或"pending_user"字样（D3 新增逻辑）
  等待预算: 5s
  留证: /tmp/b02_out.txt + exit code
  Test: manual:bash -c 'TMP2=$(mktemp -d); TRANSCRIPT2="$TMP2/transcript.jsonl"; printf '"'"'{"role":"assistant","content":"请确认方案，[TURN: pending_user]"}\n'"'"' > "$TRANSCRIPT2"; touch "$TMP2/.conversation-mode"; CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT2" bash -c "cd $TMP2 && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/b02_out.txt 2>&1; RC=$?; rm -rf "$TMP2"; [ $RC -eq 2 ] || { echo "FAIL exit=$RC（D3 pending_user block 未实现）"; cat /tmp/b02_out.txt; exit 1; }; grep -qE "等待用户确认|pending_user" /tmp/b02_out.txt || { echo "FAIL stdout 缺阻断提示"; cat /tmp/b02_out.txt; exit 1; }; echo "B-02 PASS"'

- [ ] [BEHAVIOR] [L2] B-03: TTL archiver 单测全通过（到期 active → archived，非到期不变，gate 10min 内跳过）
  动作: 运行 vitest packages/brain/src/__tests__/conversation-ttl-archiver.test.js
  预期观察: 4 个测试用例全部 passed（B1 gate/B2 归档/B3 无记录/B4 SQL 条件）
  等待预算: 30s
  留证: vitest 输出末 30 行（含 passed 统计）
  Test: manual:bash -c 'cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run packages/brain/src/__tests__/conversation-ttl-archiver.test.js --reporter=verbose 2>&1 | tee /tmp/b03_out.txt; grep -q "passed" /tmp/b03_out.txt && echo "B-03 PASS" || { echo "FAIL"; cat /tmp/b03_out.txt; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-04: SKILL.md 存在且含三个必需协议标记关键词
  动作: 检查 packages/workflows/skills/conversation-agent/SKILL.md 文件内容
  预期观察: 文件存在，且含 decision_saved / pending_user / turn_marker 三个关键词
  等待预算: 0s
  留证: grep 输出
  Test: manual:bash -c 'test -f /workspace/packages/workflows/skills/conversation-agent/SKILL.md && grep -q "decision_saved" /workspace/packages/workflows/skills/conversation-agent/SKILL.md && grep -q "pending_user" /workspace/packages/workflows/skills/conversation-agent/SKILL.md && grep -q "turn_marker" /workspace/packages/workflows/skills/conversation-agent/SKILL.md && echo "B-04 PASS SKILL.md" || { echo "FAIL SKILL.md 缺失或缺关键词"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: TTL archiver SQL 只软归档（UPDATE status→archived，不 DELETE）
  动作: 运行 B4 测试，检查 SQL 不含 DELETE 语句
  预期观察: SQL 断言：含 UPDATE ... SET status='archived'，不含 DELETE
  等待预算: 0s
  留证: SQL 字面量 grep 输出
  Test: manual:bash -c 'cd /workspace && node --experimental-vm-modules node_modules/.bin/vitest run packages/brain/src/__tests__/conversation-ttl-archiver.test.js --reporter=verbose 2>&1 | grep -q "passed" && ! grep -q "DELETE" packages/brain/src/conversation-ttl-archiver.js && echo "B-05 PASS 无 DELETE" || { echo "FAIL"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-06: stop.sh 在 .conversation-mode 存在时路由到 stop-conversation.sh（而非跳过）
  动作: 检查 stop.sh 含 .conversation-mode 路由分支且调用 stop-conversation.sh
  预期观察: stop.sh grep 到 conversation-mode 路由分支
  等待预算: 0s
  留证: grep 输出
  Test: manual:bash -c 'grep -q "conversation-mode" /workspace/packages/engine/hooks/stop.sh && grep -q "stop-conversation.sh" /workspace/packages/engine/hooks/stop.sh && echo "B-06 PASS 路由存在" || { echo "FAIL stop.sh 缺 conversation-mode 路由"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-07: stop-conversation.sh 无 .conversation-mode 时直接 exit 0（不阻断普通会话）
  动作: 构造 transcript（含 pending_user），但不创建 .conversation-mode，调用 stop-conversation.sh
  预期观察: exit code = 0（无锁文件时不阻断）
  等待预算: 5s
  留证: exit code 输出
  Test: manual:bash -c 'TMP7=$(mktemp -d); TRANSCRIPT7="$TMP7/transcript.jsonl"; printf '"'"'{"role":"assistant","content":"[TURN: pending_user]"}\n'"'"' > "$TRANSCRIPT7"; CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT7" bash -c "cd $TMP7 && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/b07_out.txt 2>&1; RC=$?; rm -rf "$TMP7"; [ $RC -eq 0 ] && echo "B-07 PASS exit=0（无锁文件不阻断）" || { echo "FAIL exit=$RC"; cat /tmp/b07_out.txt; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-08: conversation-agent.js spawn 路径写入 .conversation-mode / resolve 路径删除（TDD Red — D2 待实现）[接缝×1]
  动作: 调用 conversation-agent.js 的 spawn 路径（createConversation/startConversation），检查工作目录下 .conversation-mode 文件被创建；再调用 resolve/archive 路径，检查文件被删除
  预期观察: spawn 后 .conversation-mode 存在，内含 conversation_id；resolve/archive 后 .conversation-mode 不存在
  等待预算: 5s
  留证: 文件 stat 输出（存在/不存在）
  TDD Red: conversation-agent.js 当前无 .conversation-mode 写/删逻辑（D2 待实现），此断言在 D2 实现前故意 FAIL
  Test: vitest:sprints/07281915-relay-2a4ead8d/tests/conversation-agent-lock.test.ts

- [ ] [BEHAVIOR] [L2] B-09: .conversation-mode 存在 + 末轮无 [TURN:...] → exit 2（无标记 block，TDD Red — D3 待实现）[接缝×1]
  动作: 构造末轮无任何 [TURN:...] 的 transcript JSONL + .conversation-mode 文件，调用 stop-conversation.sh
  预期观察: exit code = 2（有锁文件但无标记，必须阻断，防止 agent 静默退出）
  等待预算: 5s
  留证: /tmp/b09_out.txt + exit code 输出
  TDD Red: stop-conversation.sh 当前对无标记内容仅 exit 0（D3 尚未实现无标记 block 分支），此断言在 D3 实现前故意 FAIL
  Test: manual:bash -c 'TMP9=$(mktemp -d); TRANSCRIPT9="$TMP9/transcript.jsonl"; printf '"'"'{"role":"assistant","content":"这是普通回复，没有任何 TURN 标记"}\n'"'"' > "$TRANSCRIPT9"; touch "$TMP9/.conversation-mode"; CLAUDE_HOOK_TRANSCRIPT_PATH="$TRANSCRIPT9" bash -c "cd $TMP9 && bash /workspace/packages/engine/hooks/stop-conversation.sh" > /tmp/b09_out.txt 2>&1; RC=$?; rm -rf "$TMP9"; [ $RC -eq 2 ] && echo "B-09 PASS exit=2（无标记 block）" || { echo "FAIL exit=$RC（D3 无标记 block 未实现，TDD Red）"; cat /tmp/b09_out.txt; exit 1; }'

---

## 失败语义声明

| 场景 | 期望行为 |
|------|---------|
| stop-conversation.sh 在 Brain 不可达时 | curl timeout → 无法验证 decision_saved → exit 2（宁可误 block 不放行未落库的决策） |
| transcript 文件为空/损坏 | exit 0（无 TURN 标记 + 无 .conversation-mode 则放行）|
| TTL archiver 无过期对话 | 返回 {skipped:false, archived:0}，不报错 |
| SKILL.md 文件不存在 | D1 未交付，B-04 FAIL |
| .conversation-mode 已被删除 | stop-conversation.sh exit 0（锁文件已删 = 对话已正常关闭）|

---

## 输入对抗面

| 输入 | 非法值 | 期望行为 |
|------|--------|---------|
| transcript JSONL | 含 NULL 字节/BOM/乱码行 | hook 逐行容错（try/except），不 crash，不 exit 非 0/2 以外的值 |
| decision_saved UUID | 格式错误（非 v4 UUID）| curl 对账 → 404 → exit 2 |
| CLAUDE_HOOK_TRANSCRIPT_PATH | 文件不存在 | stop-conversation.sh exit 0（已有逻辑） |
| TTL archiver pool | pool.query 抛异常 | 单测 B4 不覆盖（由 B3 隐性验证 query 被调用） |
