---
skeleton: true
journey_type: autonomous
---
# Contract DoD — Sprint: playground 加 GET /ping endpoint（relay smoke）

**范围**: `playground/server.js` 新增 `GET /ping` 路由 + `playground/tests/ping.test.js` 单测（合同测试逐字复制毕业）；不动 Brain/engine/dashboard/CI 基础设施/playground 其他端点/依赖
**大小**: S

> playground 训练 sprint 例外声明：`skeleton: true` 且 PRD 明确"smoke 训练 sprint"——BEHAVIOR 命令允许 `node playground/server.js`，全部命令与 E2E 零 Brain URL。

## ARTIFACT 条目

- [ ] [ARTIFACT] playground/tests/ping.test.js 存在且为合同测试逐字复制（含 GET /ping describe 与 pong 断言）
  Test: node -e "const c=require('fs').readFileSync('playground/tests/ping.test.js','utf8');if(!c.includes('GET /ping')||!c.includes('pong')||!c.includes('supertest'))process.exit(1)"

- [ ] [ARTIFACT] playground/server.js 注册 /ping 路由
  Test: node -e "const c=require('fs').readFileSync('playground/server.js','utf8');if(!c.includes('/ping'))process.exit(1)"

## BEHAVIOR 条目（playground 例外：真启本地 server 真发 HTTP，零 mock、零 Brain URL）

- [ ] [BEHAVIOR] GET /ping 返回 200 + {pong: true}（对应 Golden Path Step 1 的用户可观察输出）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; NODE_ENV= PLAYGROUND_PORT=3151 node playground/server.js & SPID=$!; for i in 1 2 3 4 5; do curl -sf localhost:3151/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done; RESP=$(curl -sf localhost:3151/ping); RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || exit 1; echo "$RESP" | jq -e ".pong == true" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应顶层 keys 完整性 == ["pong"]（对应 Golden Path Step 4）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; NODE_ENV= PLAYGROUND_PORT=3152 node playground/server.js & SPID=$!; for i in 1 2 3 4 5; do curl -sf localhost:3152/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done; RESP=$(curl -sf localhost:3152/ping); RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || exit 1; echo "$RESP" | jq -e "keys == [\"pong\"]" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段反向：ping/alive/ok/status/result 均不存在（对应 Golden Path Step 4，PRD 第 20 行禁用清单）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; NODE_ENV= PLAYGROUND_PORT=3153 node playground/server.js & SPID=$!; for i in 1 2 3 4 5; do curl -sf localhost:3153/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done; RESP=$(curl -sf localhost:3153/ping); RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || exit 1; for k in ping alive ok status result; do echo "$RESP" | jq -e "has(\"$k\") | not" >/dev/null || exit 1; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 携带任意 query 参数 → 忽略参数仍 200 {pong: true} 且 keys == ["pong"]（对应 Golden Path Step 2，PRD 第 26 行边界）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; NODE_ENV= PLAYGROUND_PORT=3154 node playground/server.js & SPID=$!; for i in 1 2 3 4 5; do curl -sf localhost:3154/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done; RESP=$(curl -sf "localhost:3154/ping?foo=bar&x=1"); RC=$?; kill $SPID 2>/dev/null; [ $RC -eq 0 ] || exit 1; echo "$RESP" | jq -e ".pong == true and (keys == [\"pong\"])" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — POST /ping 返回 Express 默认 404（对应 Golden Path Step 3，PRD 第 27 行边界；负向断言，只验状态码不验 body）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; NODE_ENV= PLAYGROUND_PORT=3155 node playground/server.js & SPID=$!; for i in 1 2 3 4 5; do curl -sf localhost:3155/health | jq -e ".ok == true" >/dev/null && break; sleep 1; done; CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3155/ping); kill $SPID 2>/dev/null; [ "$CODE" = "404" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] INV-1 范围越界守卫：本 sprint 相对 origin/main 的改动只允许落在 playground/ 与 sprints/（覆盖铁律：CI 基础设施禁区 / 不动 Brain / 范围限定）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)"; CHANGED=$(git diff --name-only origin/main...HEAD -- . | grep -vE "^(playground/|sprints/)"); if [ -n "$CHANGED" ]; then echo "FAIL: 越界文件: $CHANGED"; exit 1; fi; echo OK'
  期望: OK

## 铁律清单 → INV 映射（Step 1.3，PRD 注入 area 级 69 条逐条映射）

映射代号：
- **INV-1** = 上方 BEHAVIOR INV-1 范围越界守卫（可机检）
- **硬条款-n** = contract-draft.md「Generator 执行硬条款」第 n 条（generator 纪律，evaluator CONTRACT-IS-LAW 审查）
- **已落实** = 本合同的写法/条款已直接满足，无需独立断言
- **R2** = relay/harness 编排层义务（controller/evaluator/judge/report/Brain 侧承接），非本合同断言对象
- **N/A** = 本 sprint 不触及该铁律覆盖的模块/场景

| # | 铁律（摘要） | 映射 |
|---|---|---|
| 1 | LaunchAgents 禁放常驻服务 | N/A：不新增常驻服务 |
| 2 | status 枚举硬编码断言需全仓 grep 复查 | N/A：本 sprint 无状态枚举 |
| 3 | 共享 CI 基础设施文件默认禁区 | INV-1 + 硬条款-4 |
| 4 | 同一语义判变端/终验端同一策略 | N/A：无判变/终验双端脚本 |
| 5 | Test Contract 表固定 4 列、testFile backtick | 已落实：contract-draft.md Test Contract 表即该格式 |
| 6 | 表名认领冲突先 grep 写入方 | N/A：不建表不写 DB |
| 7 | 后台 job 必须声明消费方 | N/A：无后台 job |
| 8 | PR 提前合并需 head SHA 核对 verdict | R2：controller/judge 侧 |
| 9 | git rev-parse 判 ref 需 --verify | N/A：合同命令无判 ref 存在场景（--show-toplevel 不属判 ref） |
| 10 | smoke-invariant-1784 | N/A：铁律正文缺失（仅名称），无可断言内容；smoke 链路本身即本 sprint 全部内容 |
| 11 | 服务活性判定双信号 | N/A：playground 非常驻服务 |
| 12 | headed relay 点火写 base_repo/pr_url + 分支带 short id | R2：controller/Brain 侧（本分支名已带 task 上下文） |
| 13 | 跨模块时间常数不变量显式化 | N/A：无时间常数依赖 |
| 14 | evaluator 临时脚本落会话独享路径 | 已落实：合同命令零共享 /tmp 固定文件名，端口 3151-3157 本 sprint 独占段 |
| 15 | 接缝断言必须真目标验证才 done | 已落实：接缝清单为空（全逻辑断言），见 contract-draft.md 接缝清单段 |
| 16 | feat+brain/src PR 带 smoke.sh 登记 | N/A：不触 packages/brain |
| 17 | headed relay 长等待周期 PATCH 心跳 | R2：relay session 侧 |
| 18 | catch 吞错后台 job 带失败计数 | N/A：无后台 job |
| 19 | dep-audit fixAvailable 先查 | N/A：不动依赖 |
| 20 | 日志脱敏（PII 不明文进日志） | N/A：无 PII/聊天内容 |
| 21 | 毕业 commit 本地先跑 lint-tdd-commit-order + check-test-coverage | 硬条款-5 |
| 22 | smoke-invariant-1783 | N/A：同 #10（铁律正文缺失） |
| 23 | 端点鉴权（无鉴权端点不准 ship） | N/A（显式豁免声明）：playground 为本地训练沙箱、非生产 API；PRD 第 20 行锁死响应 schema 且第 32 行禁止新增依赖，既有 13 端点均无鉴权，本端点保持沙箱一致性。该豁免不外推到任何生产端点 |
| 24 | smoke-invariant-1783（重复条目） | N/A：同 #22 |
| 25 | 测试默认多租户（种 ≥2 租户断言隔离） | N/A：playground 无租户模型、无数据存储 |
| 26 | 新 cron 先查 scheduler-jobs.js | N/A：无 cron |
| 27 | 凭据安全（不硬编码/不进 git/不进日志） | 已落实：合同与测试零凭据 |
| 28 | watchdog never_started 分类兜底 | R2：Brain watchdog 侧 |
| 29 | 判变基准用生产实体自报 | N/A：无部署判变 |
| 30 | 通知/写库成功判定看语义字段 | N/A：无通知/写库接口（HTTP 断言均走 jq 语义字段） |
| 31 | journey_features updated_at 停滞巡检 | R2：report 阶段侧 |
| 32 | 新 task_type 七点接线清单 | N/A：无新 task_type |
| 33 | 禁写死环境假设值 | 已落实：无屏幕坐标/UIA 阈值/env 假设；端口为测试自选参数非环境假设 |
| 34 | smoke-invariant-1784（重复条目） | N/A：同 #10 |
| 35 | watchdog_overdue orphan requeue 恢复路径 | R2：Brain 侧 |
| 36 | lint-test-quality 要求 await fn() ≥1 | 已落实：合同测试每个 test() 均 await supertest 请求 |
| 37 | smoke 用真实 worktree 时核对生产资源触碰 | 已落实：E2E 只起本地 node 进程 + 本地端口，零生产资源触碰 |
| 38 | 租户隔离（查询写入 scope 租户） | N/A：无租户数据 |
| 39 | 复活死功能先读退役代码 | N/A：/ping 非复活功能（playground 从未有过） |
| 40 | PR CONFLICTING 时 CI 静默不触发 | R2：controller/watchdog 处置知识 |
| 41 | tmux innerCmd 不继承父环境变量 | R2：relay 编排层 |
| 42 | Red commit 只 add 精确路径 | 硬条款-2 |
| 43 | 单 slot 串行执行任务 | R2：编排层调度纪律 |
| 44 | 守卫自产数据共享前缀排除 | N/A：无守卫计数 |
| 45 | capture_atoms urgent 路由查重 | R2：Brain 侧 |
| 46 | Proposer 复用历史模板先核对真实派发历史 | 已落实：E2E 按本次 PRD target_environment=playground 新写（未照抄历史 sprint 断言），并已实测 playground 当前代码与测试现状 |
| 47 | 新字段语义重叠须本 sprint 内消解 | N/A：响应仅 pong 单字段，禁用清单已反向断言堵重叠面 |
| 48 | 部署链失败禁 warning 降级 | 已落实：E2E/BEHAVIOR 全部显式 FAIL + exit 非 0，零 warning 降级 |
| 49 | host/环境白名单断言核对 headed 人工接管 | N/A：合同无 host/环境白名单断言 |
| 50 | smoke-invariant-1784（重复条目） | N/A：同 #10 |
| 51 | 新常驻宿主服务进 launchd-patrol manifest | N/A：无常驻服务 |
| 52 | 冷启动重置型测试需补真实多轮集成测试 | N/A：/ping 无跨扫描周期状态、无 sentinel |
| 53 | theater_mismatch：contract 含 android 关键词触发警告 | 已落实：本合同全文无该关键词 |
| 54 | source-code inspection 验调度接线 | N/A：无调度接线 |
| 55 | relay 单 session 各 phase 调 phase-event 回写 | R2：relay session 侧 |
| 56 | 探针时间窗用确定性日历窗 | N/A：无探针计账、无 DB 时间窗（playground 无 DB） |
| 57 | varchar 长度约束显式截断 | N/A：无 DB 写入 |
| 58 | manual:node -e 双引号 ${} 须 GAN 批准前真跑 | 已落实：DoD node -e 命令无 ${}，且 Round 1 已逐条本地真跑（exit code 实录见下方附注） |
| 59 | cortex recordLearnings 两层验证法 | N/A：不触 cortex |
| 60 | judge .brain-result 格式（exit_code + log_tail + behavior_tests[]） | R2：evaluator/judge 侧格式义务 |
| 61 | 周期重扫 + 付费调用需前置已处理检查 | N/A：无付费调用 |
| 62 | agents 表字段先 psql 核对真实列名 | N/A：不触 agents 表 |
| 63 | generator 禁自行 merge PR | 硬条款-6 |
| 64 | controller Step 6 后可能跳过 Step 7 report | R2：controller/Brain 侧 |
| 65 | 返回 null/false 契约必须显式 else 失败分支 | 已落实：E2E/BEHAVIOR 每个失败分支显式 `|| { echo FAIL; exit 1; }` |
| 66 | 退役判断依据查生产库不靠记忆 | N/A：无退役动作 |
| 67 | 合同批准前记录 manual oracle 真实 exit code + 解释器启动 | 已落实：Round 1 已真跑——Red 证据 4 failed / 1 passed 实录 + BEHAVIOR 命令逐条 exit code 附注见下 |
| 68 | 冒烟脚本 DB_NAME 写入/校验同源 | N/A：无 DB |
| 69 | target_environment 从 tasks.payload 读 | R2：planner/orchestrator 注册义务（PRD 已声明 target_environment: playground） |

### 附注：Round 1 manual oracle 实跑记录（铁律 #67）

实现前（/ping 路由不存在）逐条真跑结果：
- BEHAVIOR 1/2/3/4（正向断言）：curl -sf 对 /ping 收 404 → RC 非 0 → exit 1（**真红 ✓**，代码未写必 FAIL）
- BEHAVIOR 5（POST 404 负向断言）：exit 0（负向断言实现前后均 404，天然绿——与合同测试 `1 passed` 一致）
- BEHAVIOR INV-1：exit 0（当前分支相对 origin/main 仅改 sprints/，未越界）
- ARTIFACT 1：exit 1（**真红 ✓**，ping.test.js 未毕业）；ARTIFACT 2：exit 1（**真红 ✓**，server.js 无 /ping）
- 合同测试 Red：`Test Files 1 failed (1) / Tests 4 failed | 1 passed (5)`（实录）
