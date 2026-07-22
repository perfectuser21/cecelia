---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: claude-headed-smoke（headed relay 链冒烟：Brain 纯函数 smoke stamp）

**范围**: 新增 `packages/brain/src/utils/relay-smoke.js` 纯函数 `formatSmokeStamp(taskId, date)` + 单测（CI 常跑副本落 `packages/brain/src/utils/relay-smoke.test.js`）+ smoke 登记（`packages/brain/scripts/smoke/relay-smoke-stamp-smoke.sh` + `packages/quality/smoke-allowlist.txt` 一行，过 ci.yml lint-feature-has-smoke 与 ci-smoke-glob-runner 棘轮两道机械闸）；零生产接线，不改任何现有 Brain 行为
**大小**: S

> 执行目录约定：所有 manual:bash 命令在 repo 根目录执行（worktree 根）。

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/utils/relay-smoke.js` 存在且以命名导出形式 `export function formatSmokeStamp` 提供纯函数
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/utils/relay-smoke.js','utf8');if(!c.includes('export function formatSmokeStamp'))process.exit(1)"

- [x] [ARTIFACT] CI 常跑测试副本 `packages/brain/src/utils/relay-smoke.test.js` 存在（brain vitest include `src/**/*.test.js` 覆盖路径），且含合同关键用例名
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/utils/relay-smoke.test.js','utf8');if(!c.includes('smoke:097e589d:20260722')||!c.includes('TypeError'))process.exit(1)"

- [x] [ARTIFACT] 零生产接线：`packages/brain/src` 下除 `utils/relay-smoke.js` / `utils/relay-smoke.test.js` 自身外无任何文件 import/require 本模块（source-code inspection，铁律[接线验证]。r3 勘误：原命令子串 grep "relay-smoke" 撞 main 预存同名 v2.2.0 HTTP 探针路由字符串——routes/walking-skeleton.js 与 routes/__tests__/relay-smoke.contract.test.js 引用的是 `/api/brain/relay-smoke` 路由名而非本模块 import，oracle 天生不可 PASS，属起草缺陷；改为 import/require 语句级断言，真红能力保留：任何生产文件 import 本模块必 FAIL）
  Test: bash -c 'W=$(grep -rlE "(from|import)[[:space:]]+[^[:space:]]*relay-smoke|(require|import)\([^[:space:]]*relay-smoke" packages/brain/src --include="*.js" | grep -vE "^packages/brain/src/utils/relay-smoke(\.test)?\.js$" || true); [ -z "$W" ]'

- [x] [ARTIFACT] 合同测试文件 `tests/regression/relay-097e589d/relay-smoke.test.ts` 原样保留（CONTRACT IS LAW，commit 1 后不可修改）
  Test: node -e "const c=require('fs').readFileSync('tests/regression/relay-097e589d/relay-smoke.test.ts','utf8');if(!c.includes('同进程多轮调用状态不重置输出确定'))process.exit(1)"

- [x] [ARTIFACT] smoke 脚本 `packages/brain/scripts/smoke/relay-smoke-stamp-smoke.sh` 存在、含真 `node` 命令且实跑通过（铁律[smoke登记]；满足 lint-feature-has-smoke 内容校验：≥5 实代码行 + ≥1 条 node 真命令，非 echo 空架子）
  Test: bash packages/brain/scripts/smoke/relay-smoke-stamp-smoke.sh

- [x] [ARTIFACT] smoke 脚本已登记 `packages/quality/smoke-allowlist.txt`（ci-smoke-glob-runner.yml 棘轮：新脚本未登记 → CI 红，新债不许欠）
  Test: bash -c "grep -qx 'relay-smoke-stamp-smoke.sh' packages/quality/smoke-allowlist.txt"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous）

> 本 sprint 为零接线纯函数（无 Brain API/DB 面，PRD Golden Path 即 node 直调），BEHAVIOR oracle 为 node 真跑真实 repo 模块 + vitest 实跑，全部真执行断言、无 mock。所有入参经 argv 注入（非硬编码进 JS 字符串），纯函数无历史态可冒充，无需时间窗。

- [x] [BEHAVIOR] 标准输入返回确定冒烟戳：`formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22T00:00:00Z'))` 恰为 `smoke:097e589d:20260722`
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const out=m.formatSmokeStamp(process.argv[2],new Date(process.argv[3]));if(out!==process.argv[4]){console.error(out);process.exit(1)}console.log(process.argv[5]);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z smoke:097e589d:20260722 OK'
  期望: OK

- [x] [BEHAVIOR] 确定性 + 短 taskId：同输入两次调用输出一致；taskId 不足 8 位（`abc`）用完整 taskId 得 `smoke:abc:20260722`
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const a=m.formatSmokeStamp(process.argv[2],d);const b=m.formatSmokeStamp(process.argv[2],d);if(a!==b)process.exit(1);if(m.formatSmokeStamp(process.argv[4],d)!==process.argv[5])process.exit(1);console.log(process.argv[6]);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z abc smoke:abc:20260722 OK'
  期望: OK

- [x] [BEHAVIOR] UTC 日期语义：`new Date('2026-01-05T00:00:00Z')` 恒得 `20260105`（月/日零填充；本地时区实现在西半球机器会漂到 20260104 → FAIL）
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const out=m.formatSmokeStamp(process.argv[2],new Date(process.argv[3]));if(out!==process.argv[4]){console.error(out);process.exit(1)}console.log(process.argv[5]);})" ./packages/brain/src/utils/relay-smoke.js abcd1234-0000-0000-0000-000000000000 2026-01-05T00:00:00Z smoke:abcd1234:20260105 OK'
  期望: OK

- [x] [BEHAVIOR] error path — 空 taskId / 非字符串 taskId 抛 TypeError（不静默返回）
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[2]);const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(String(),d));must(()=>m.formatSmokeStamp(12345678,d));console.log(process.argv[3]);})" ./packages/brain/src/utils/relay-smoke.js 2026-07-22T00:00:00Z OK'
  期望: OK

- [x] [BEHAVIOR] error path — Invalid Date / 非 Date 参数抛 TypeError（不静默返回）
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const must=f=>{try{f();process.exit(1)}catch(e){if(!(e instanceof TypeError))process.exit(1)}};must(()=>m.formatSmokeStamp(process.argv[2],new Date(NaN)));must(()=>m.formatSmokeStamp(process.argv[2],123));console.log(process.argv[3]);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd OK'
  期望: OK

- [x] [BEHAVIOR] 单测进入 brain-ci 常跑且全绿：CI 常跑副本在 brain vitest include 路径下 vitest 实跑 exit 0
  Test: manual:bash -c 'bash -lc "cd packages/brain && npx vitest run src/utils/relay-smoke.test.js --reporter=basic" && echo OK'
  期望: OK

- [x] [BEHAVIOR] INV-1 多轮不重置：同进程连续 100 轮交错输入调用，输出与首轮基准恒一致（铁律[测试设计]：非冷启动式、状态不重置）
  Test: manual:bash -c 'node -e "import(process.argv[1]).then(m=>{const d=new Date(process.argv[3]);const base=m.formatSmokeStamp(process.argv[2],d);const d2=new Date(process.argv[5]);const base2=m.formatSmokeStamp(process.argv[4],d2);for(let i=0;i<100;i++){if(m.formatSmokeStamp(process.argv[2],d)!==base)process.exit(1);if(m.formatSmokeStamp(process.argv[4],d2)!==base2)process.exit(1)}console.log(process.argv[6]);})" ./packages/brain/src/utils/relay-smoke.js 097e589d-ec53-4102-b8d1-9aa582b88ebd 2026-07-22T00:00:00Z deadbeef-0000-0000-0000-000000000000 2026-01-05T00:00:00Z OK'
  期望: OK

## Invariant 铁律映射（Step 1.3 — PRD 铁律清单逐条：INV 条目或显式 N/A）

- INV-1 [测试设计] → 已立 [BEHAVIOR] INV-1（上方多轮不重置条目）+ 合同 tests「同进程多轮调用状态不重置输出确定」用例
- N/A [防重复付费]：无外部付费调用、无周期性重扫
- N/A [时间常数]：无跨模块时间常数依赖
- N/A [环境断言]：合同/PRD 无 android 关键词，target_environment=local_api
- N/A [环境读取]：本合同不改任务注册逻辑；target_environment 已由 planner 写入 payload（local_api）
- N/A [judge格式]：.brain-result.json 顶层格式属 evaluator/judge 协议义务，非本合同交付面
- N/A [字段截断]：无 DB 写入
- N/A [复活考古]：已考古（git log --diff-filter=D 无输出，relay-smoke 系全新文件，见合同「已知约束」）
- N/A [else兜底]：不调用任何"返回 null/false 表示失败"契约的函数（本函数错误语义为抛 TypeError）
- N/A [冒烟占位] smoke-invariant-1784543934-2387：历史冒烟占位铁律，无实体约束
- N/A [report兜底]：controller/report 侧义务，非合同交付面
- N/A [relay收尾]：controller 侧义务，非合同交付面
- N/A [白名单断言]：合同无 host/环境白名单断言
- N/A [点火载荷]：controller 点火侧义务（本任务分支已带 task short id）
- N/A [退役实证]：无退役判断
- N/A [失败计数]：无后台 job、无 catch 吞错路径
- N/A [表认领]：不建表不复用表
- N/A [消费方]：无落库 job
- N/A [多设备UI]：无 UI
- N/A [语义一致]：无 git_sha/判变语义
- N/A [ref校验]：合同命令无 git rev-parse 判 ref
- N/A [烟测隔离]：不设 CECELIA_DEPLOY_ROOT；E2E 只读 repo + 本地跑单测，零生产资源触碰
- N/A [禁降级]：非部署链；但合同 E2E 已按同精神执行——所有失败路径显式 FAIL + exit 非零，无 warning 降级
- N/A [判变基准]：无判变场景
- N/A [测试质量]：已合规——合同 tests 内置「await 异步包装调用返回相同结果」用例（await fn() ≥1），lint-test-quality 机械闸把关
- N/A [合同表格]：已合规——contract-draft.md Test Contract 固定 4 列、testFile 用 backtick
- N/A [Red提交]：generator 流程纪律，已写入合同硬条款第 3 条（Red commit 只 add 精确测试路径）
- N/A [接线验证]：已以 ARTIFACT 零接线负向 grep（source-code inspection）落实，优于 mock 覆盖
- N/A [cron接线]：无 cron 功能
- N/A [禁自合]：流程纪律，已写入合同硬条款第 4 条（merge 权归 controller）
- N/A [tmux环境]：controller/headed 派发侧义务，非合同交付面
- N/A [模板核对]：本合同未复用历史合同模板，按本 PRD 全新起草
- N/A [CI禁区]：已写入合同硬条款第 4 条（generator 禁改 .github/workflows/*.yml）
- N/A [提前合并]：evaluator/judge 侧义务
- N/A [冒烟占位] smoke-invariant-1783850042-79911：历史冒烟占位铁律，无实体约束
- INV-2 [smoke登记] → 已立两条 [ARTIFACT] 机检（smoke.sh 实跑 exit 0 + allowlist 登记 grep -qx）+ 合同硬条款第 7 条。事实依据（round 2 修正 round 1 错误核查结论）：`.github/workflows/scripts/lint-feature-has-smoke.sh` 是 ci.yml **必过 job**——`feat:`/`feat(...):` commit + `packages/brain/src/` 新增/修改非测试 .js（`.test.js` 被排除但 `relay-smoke.js` 源文件不被排除）即命中，未新增 `packages/brain/scripts/smoke/*.sh` 则 exit 1 整个 CI 红，且脚本含内容校验（≥5 实代码行 + ≥1 条 curl/psql/docker/node/npm 真命令）；第二道闸 `ci-smoke-glob-runner.yml` 棘轮要求新 smoke.sh 同 PR 登记 `packages/quality/smoke-allowlist.txt`。禁止用非 feat: 前缀绕闸
- N/A [接线清单]：无新 task_type
- N/A [双信号]：无服务存活判定
- N/A [驻留位置]：无常驻服务
- N/A [驻留巡检]：无新增常驻宿主服务
- N/A [冒烟占位] smoke-invariant-1783693282-93097：历史冒烟占位铁律，无实体约束
- N/A [串行]：调度侧约束，本合同不涉 slot 并行
- N/A [环境值]：合同无写死环境假设值（UTC 日期语义属函数规格定义，非环境假设，且有 BEHAVIOR 跨时区断言背书）
- N/A [真验证]：本 sprint 接缝清单为空（全逻辑断言，见 contract-draft「接缝清单」），CI 绿 = 真 done；E2E 仍真跑 node/vitest 于真实 repo 代码
- N/A [多租户]：纯函数无租户面
- N/A [凭据安全]：不触及任何凭据
- N/A [日志脱敏]：纯函数无日志输出
- N/A [端点鉴权]：无端点
- N/A [租户隔离]：无租户数据
