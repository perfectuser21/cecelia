---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness 失败可观测（terminal 必写 failure_class + 失败率计量 API）

**范围**: harness terminal 失败写入点统一经共享 helper 写 `tasks.result.failure_class`(受控枚举)+`failure_detail`；机械闸 lint 防回归；GET /api/brain/harness/failure-stats?days=N。
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 共享 helper 模块存在且导出枚举/规范化/终结函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-failure-class.js','utf8');if(!/FAILURE_CLASSES/.test(c)||!/normalizeFailureClass/.test(c)||!/markHarnessTaskTerminal/.test(c))process.exit(1)"

- [x] [ARTIFACT] 机械闸 lint 脚本存在
  Test: node -e "require('fs').accessSync('packages/brain/scripts/lint/lint-terminal-failure-class.mjs')"

- [x] [ARTIFACT] lint 自测坏样本 fixture 存在（供 exit-1 自测）
  Test: node -e "const c=require('fs').readFileSync('sprints/08111600-harness-failure-observability/fixtures/bad-terminal-write.snippet','utf8');if(!/status/.test(c)||!/harness/.test(c))process.exit(1)"

- [x] [ARTIFACT] failure-stats 路由注册在 harness.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('failure-stats'))process.exit(1)"

- [x] [ARTIFACT] ci.yml 新增 lint-terminal-failure-class job 且真正纳入 ci-passed 阻塞门（非孤儿 workflow、非文档约定）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const hasJob=/^\s{2}lint-terminal-failure-class:/m.test(c);const runsScript=c.includes('lint-terminal-failure-class.mjs');const gate=(c.match(/^\s{2}ci-passed:[\s\S]*?needs:\s*\[([^\]]*)\]/m)||[])[1]||'';const inGate=gate.includes('lint-terminal-failure-class');if(!hasJob||!runsScript||!inGate){console.error('FAIL '+JSON.stringify({hasJob,runsScript,inGate}));process.exit(1)}"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 逐条真跑）

> 说明：以下 node 断言全部用 JS 对象属性访问（`row.result.failure_class`）读 jsonb，避免 SQL 内单引号；`DB_URL` 由 Fleet 注入，node 直接读 `process.env.DB_URL`。

- [x] [BEHAVIOR] [L2] B-01: 共享 helper 把 result.failure_class + failure_detail 真落库
  动作: 对真实 Postgres 插入一条 in_progress 的 harness_initiative 任务，调用 markHarnessTaskTerminal(pool,id,{status:"failed",failureClass:"watchdog_deadline",failureDetail:"d"})
  预期观察: 该行 status=failed，result.failure_class="watchdog_deadline"，result.failure_detail="d"
  等待预算: 0s
  留证: node 脚本 stdout（OK 行）+ 清理 DELETE
  Test: manual:bash -c 'node --input-type=module -e '"'"'import { markHarnessTaskTerminal } from "./packages/brain/src/harness-failure-class.js"; import pg from "pg"; const pool=new pg.Pool({connectionString:process.env.DB_URL}); const id=(await pool.query("INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",["harness_initiative","smoke-b01","in_progress","{}"])).rows[0].id; await markHarnessTaskTerminal(pool,id,{status:"failed",failureClass:"watchdog_deadline",failureDetail:"d"}); const r=(await pool.query("SELECT status,result FROM tasks WHERE id=$1",[id])).rows[0]; await pool.query("DELETE FROM tasks WHERE id=$1",[id]); await pool.end(); if(r.status!=="failed"||r.result.failure_class!=="watchdog_deadline"||r.result.failure_detail!=="d") throw new Error("FAIL "+JSON.stringify(r)); console.log("OK");'"'"''
  期望: OK

- [x] [BEHAVIOR] [L2] B-02: executor 真实写入点（缺 orchestrator flag）迁到 result.failure_class
  动作: 插入 payload 无 orchestrator 的 harness_initiative 任务，真实调用 runHarnessInitiativeRouter(task,{pool})
  预期观察: 该任务 status=failed 且 result.failure_class="missing_orchestrator_flag"（不再只写 custom_props）
  等待预算: 0s
  留证: node 脚本 stdout（OK + failure_class）+ 清理
  Test: manual:bash -c 'node --input-type=module -e '"'"'import { runHarnessInitiativeRouter } from "./packages/brain/src/executor.js"; import pg from "pg"; const pool=new pg.Pool({connectionString:process.env.DB_URL}); const id=(await pool.query("INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",["harness_initiative","smoke-b02","in_progress","{}"])).rows[0].id; const task=(await pool.query("SELECT * FROM tasks WHERE id=$1",[id])).rows[0]; await runHarnessInitiativeRouter(task,{pool}); const r=(await pool.query("SELECT status,result FROM tasks WHERE id=$1",[id])).rows[0]; await pool.query("DELETE FROM tasks WHERE id=$1",[id]); await pool.end(); const fc=(r.status==="failed"&&r.result)?r.result.failure_class:null; if(fc!=="missing_orchestrator_flag") throw new Error("FAIL fc="+fc); console.log("OK "+fc);'"'"''
  期望: OK missing_orchestrator_flag

- [x] [BEHAVIOR] [L2] B-03: 受控枚举拒绝自由文本（规范化到 unclassified）
  动作: 调用 normalizeFailureClass 传枚举成员 / 自由文本 / null，并校验 FAILURE_CLASSES 冻结
  预期观察: 枚举成员原样返回；自由文本与 null 归 "unclassified"；FAILURE_CLASSES 为 frozen
  等待预算: 0s
  留证: node 脚本 stdout（OK 行）
  Test: manual:bash -c 'node --input-type=module -e '"'"'import { normalizeFailureClass, FAILURE_CLASSES } from "./packages/brain/src/harness-failure-class.js"; if(!Object.isFrozen(FAILURE_CLASSES)) throw new Error("FAIL not frozen"); if(normalizeFailureClass("watchdog_deadline")!=="watchdog_deadline") throw new Error("FAIL member"); if(normalizeFailureClass("free text xyz")!=="unclassified") throw new Error("FAIL freetext"); if(normalizeFailureClass(null)!=="unclassified") throw new Error("FAIL null"); console.log("OK");'"'"''
  期望: OK

- [x] [BEHAVIOR] [L2] B-04: GET /failure-stats?days=7 返回 failure_rate 数值 + by_class 分组对象
  动作: 对运行中的 Brain 调 GET /api/brain/harness/failure-stats?days=7
  预期观察: HTTP 200，body 含 failure_rate(number)、by_class(object)、total_tasks、terminal_failed_count；禁用字段 period_days 不出现
  等待预算: 0s
  留证: curl 响应体 + jq 断言输出
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7"); echo "$RESP" | jq -e ".failure_rate | type == \"number\"" >/dev/null && echo "$RESP" | jq -e ".by_class | type == \"object\"" >/dev/null && echo "$RESP" | jq -e "has(\"total_tasks\") and has(\"terminal_failed_count\")" >/dev/null && echo "$RESP" | jq -e "has(\"period_days\") | not" >/dev/null && echo OK || { echo "FAIL $RESP"; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] [L2] B-05: error path — 非法 days 返回 400 + error 字段
  动作: 调 GET /api/brain/harness/failure-stats?days=abc
  预期观察: HTTP 400，body 含 error(string)，不 500 不静默成空口径
  等待预算: 0s
  留证: http_code + 错误 body
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/b05.json -w "%{http_code}" "localhost:5221/api/brain/harness/failure-stats?days=abc"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/b05.json >/dev/null || { echo "FAIL no error field"; exit 1; }; echo OK'
  期望: OK

- [x] [BEHAVIOR] [L2] B-06: 机械闸 lint 干净树 exit 0、注入裸 terminal 写入 exit 1、还原后再 exit 0
  动作: 跑 lint（干净树）→ cat 坏样本 fixture 追加到被扫描源码 → 再跑 lint → git 还原
  预期观察: 干净树 exit 0；含裸 terminal harness 写入 exit 1；还原后再 exit 0
  等待预算: 0s
  留证: 三次 lint 退出码路径打印（OK/FAIL 行）
  Test: manual:bash -c 'node packages/brain/scripts/lint/lint-terminal-failure-class.mjs || { echo "FAIL clean-not-0"; exit 1; }; cat sprints/08111600-harness-failure-observability/fixtures/bad-terminal-write.snippet >> packages/brain/src/harness-failure-class.js; if node packages/brain/scripts/lint/lint-terminal-failure-class.mjs; then git checkout -- packages/brain/src/harness-failure-class.js; echo "FAIL lint-passed-bad-write"; exit 1; fi; git checkout -- packages/brain/src/harness-failure-class.js; node packages/brain/scripts/lint/lint-terminal-failure-class.mjs && echo OK || { echo "FAIL restore-not-0"; exit 1; }'
  期望: OK

- [x] [BEHAVIOR] [L2] INV-2: 口径三源防线 — stats 不恒空且 by_class 求和 == terminal_failed_count
  动作: 用 helper 造 1 条近窗口 terminal failed harness 任务，fetch failure-stats?days=1，校验计量真实反映且无双重计数，最后清理
  预期观察: terminal_failed_count>=1（非恒空/已接线），且 by_class 各类计数之和 == terminal_failed_count（无双重计数）
  等待预算: 0s
  留证: node/fetch 输出（OK 行）+ 清理 DELETE
  Test: manual:bash -c 'node --input-type=module -e '"'"'import { markHarnessTaskTerminal } from "./packages/brain/src/harness-failure-class.js"; import pg from "pg"; const pool=new pg.Pool({connectionString:process.env.DB_URL}); const id=(await pool.query("INSERT INTO tasks(task_type,title,status,payload) VALUES($1,$2,$3,$4) RETURNING id",["harness_initiative","smoke-inv2","in_progress","{}"])).rows[0].id; await markHarnessTaskTerminal(pool,id,{status:"failed",failureClass:"product_failure",failureDetail:"x"}); const res=await fetch("http://localhost:5221/api/brain/harness/failure-stats?days=1"); const j=await res.json(); await pool.query("DELETE FROM tasks WHERE id=$1",[id]); await pool.end(); if(!(j.terminal_failed_count>=1)) throw new Error("FAIL empty "+JSON.stringify(j)); const sum=Object.values(j.by_class).reduce((a,b)=>a+b,0); if(sum!==j.terminal_failed_count) throw new Error("FAIL sum "+sum+"!="+j.terminal_failed_count); console.log("OK");'"'"''
  期望: OK

## INV 铁律映射（历史约束三源 — 逐条）

- INV [口径三源] 指标口径防三源失真 → 见 B-04 + INV-2（挡未接线恒空 + 双重计数；分母口径已在 contract-draft 判定点登记表 codify）
- INV [验证实跑] 合同验证命令必须实跑确认 exit code → N/A 独立条目：本 DoD 全部 BEHAVIOR 即真执行 exit-code 断言
- INV [证据分档] judge FAIL 分证据不足 vs 实现缺陷 → N/A：本 sprint 不触及 judge / 证据链

## notes

- judgment-pending-user: 滚动失败率分母口径（⚠️ 已标）— PRD 假设选「窗口内 harness 任务总数」为分母（含 in_progress），PrepPRD/对齐会未显式拍板；已在 body 同时暴露 total_tasks 与 terminal_failed_count，消费者可自算「终态口径」；如主理人要求改为「窗口内终态任务数」，仅需改路由聚合一处，不影响写入层与机械闸。
- 未覆盖真实链路清单: N/A（本合同无 mock 豁免；所有 BEHAVIOR 真 DB / 真 Brain / 真 lint）。
- version bump 三处同步（NFR 硬约束）：bump packages/brain/package.json 时必须同步 packages/brain/package-lock.json 与根 package-lock.json（`packages["packages/brain"].version`），push 前自查 `node -e "const l=require('./package-lock.json'),p=require('./packages/brain/package.json');if(l.packages['packages/brain'].version!==p.version)throw new Error('root lock 版本不同步')"`。
