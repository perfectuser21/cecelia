---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复 ledger-hygiene m2「归属完整率」口径失真

**范围**: packages/brain/src/ledger-hygiene.js m2 三条子查询口径修正（自产排除/冒烟标记排除/attribution_harness 停计与双重计数消除）+ 冒烟派发脚本 smoke_tag 补齐 + 回归测试永留 CI。不含：guard-drill 频控、写入侧 journey_id 上牙、历史回填、棘轮机制改造、ability_id 接线（PRD 范围限定）。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] ledger-hygiene.js 含 m2 排除谓词与停计注释：导出 LEDGER_SELF_ISSUE_PREFIX、m2 tasks/issues 子查询注释锚保留、smoke_tag 排除谓词存在、attribution_harness 停计处有「接线」恢复注释
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ledger-hygiene.js','utf8');if(!c.includes('LEDGER_SELF_ISSUE_PREFIX'))process.exit(1);if(!c.includes('attribution_tasks'))process.exit(1);if(!c.includes('attribution_issues'))process.exit(1);if(!c.includes('smoke_tag'))process.exit(1);if(!c.includes('接线'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 两个 headed 派发冒烟脚本所有 harness_initiative 建 task 的 POST body 均含 smoke_tag（含 invalid-mode 防御性补齐）
  Test: node -e "const fs=require('fs');const files=['packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh','packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh'];for(const f of files){const bad=fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('harness_initiative')&&!l.includes('smoke_tag'));if(bad.length){console.error(f,bad);process.exit(1)}}console.log('OK')"

- [x] [ARTIFACT] m2 回归测试永留 CI：合同 tests/ledger-hygiene-m2-noise.test.js 已复制到 packages/brain/src/__tests__/。落位改写点**仅以下两处**（CONTRACT-IS-LAW 授权边界）：①静态 import 语句路径 `'../../../packages/brain/src/ledger-hygiene.js'` → `'../ledger-hygiene.js'`；②`MODULE_PATH` 常量值同步改为 `'../ledger-hygiene.js'`（供动态 import 在落位处正确解析）。其余逐字同源，关键 it 名齐全
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/ledger-hygiene-m2-noise.test.js','utf8');if(c.includes('../../../packages/brain'))process.exit(1);if(!c.includes(\"MODULE_PATH = '../ledger-hygiene.js'\"))process.exit(1);const its=['m2 tasks 子查询含 smoke_tag 与守卫自产','m2 issues 子查询含自产前缀排除谓词','m2 求和不再计入 attribution_harness','raiseBreachAlerts 写入 title 同源','debt 骤降不触发击穿且不重置 baseline'];for(const s of its){if(!c.includes(s)){console.error('缺 it:',s);process.exit(1)}}console.log('OK')"

- [x] [ARTIFACT] 既有 ledger-hygiene.test.js 的旧口径 m2 断言已同步更新为停计口径（合同规范§5 唯一授权改动点；旧断言 debt=4 含 harness 子项不得残留）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/ledger-hygiene.test.js','utf8');if(c.includes('harness缺1 → debt=4'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type=autonomous — 真 cecelia 库 + 只读复现脚本差分）

> 计数断言均为同一唯一 tag 的注入→重算差分（基线在注入前几秒读取），历史数据无法冒充差分；场景脚本内置 trap 清理 + 并发漂移整场景重试 1 次（二次失败 = FAIL，非兜底放行）。

- [x] [BEHAVIOR] INV-10 自产/冒烟噪声全排除：注入 1 条 [ledger-hygiene] 前缀 issue（journey_id NULL）+ 1 条 [紧急] issue: [ledger-hygiene] 前缀 task + 1 条 payload.smoke_tag 非空的 harness task（均无 journey 归属）后重算，m2 debt 不变（守卫不因噪声涨账，Golden Path Step 2+3）
  Test: manual:bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh noise
  期望: exit 0 且输出含 PASS scenario=noise

- [x] [BEHAVIOR] 排除不误伤（task 侧）：注入 1 条无标记、无 journey_id 的真实业务 task 后重算，m2 debt 恰 +1（真实退化仍被捕捉，Golden Path Step 5）
  Test: manual:bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh real-miss
  期望: exit 0 且输出含 PASS scenario=real-miss

- [x] [BEHAVIOR] 排除不误伤（issue 侧，边界/error path）：注入 1 条 title 含 [ledger-hygiene] 字样但不以自产前缀开头、journey_id NULL 的真实 issue 后重算，m2 debt 恰 +1（前缀锚定 title 开头，禁模糊 %中缀% 匹配，Golden Path Step 5）
  Test: manual:bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh issue-real-miss
  期望: exit 0 且输出含 PASS scenario=issue-real-miss

- [x] [BEHAVIOR] attribution_harness 停计 + 双重计数消除：注入 1 条无 smoke_tag、无 ability_id、无 journey_id 的 harness_initiative task 后重算，m2 debt 恰 +1（旧口径 +2 双重计数；PRD 验收点 5，Golden Path Step 4）
  Test: manual:bash sprints/08070516-relay-2c482ed6/tests/m2-noise-scenarios.sh harness-once
  期望: exit 0 且输出含 PASS scenario=harness-once

- [x] [BEHAVIOR] m2 回归测试红→绿进 CI：合同测试在最终落位全绿（红证据见 Test Contract 表：合同起草时 4 failed / 2 passed）
  Test: manual:bash -c 'bash -lc "cd $(git rev-parse --show-toplevel)/packages/brain && npx vitest run src/__tests__/ledger-hygiene-m2-noise.test.js"'
  期望: exit 0，6 tests passed

- [x] [BEHAVIOR] INV-2 常量同源（禁写死环境值/孤立字面量）：LEDGER_SELF_ISSUE_PREFIX 运行时导出且逐字等于 [ledger-hygiene]，与既有 LEDGER_SELF_ATOM_PREFIX 并列（排除谓词由共享常量派生，非孤立第三份字面量）
  Test: manual:node -e "import('./packages/brain/src/ledger-hygiene.js').then(function(m){if(m.LEDGER_SELF_ISSUE_PREFIX!=='[ledger-hygiene]')process.exit(1);if(m.LEDGER_SELF_ATOM_PREFIX!=='issue: [ledger-hygiene]')process.exit(1);console.log('OK')}).catch(function(){process.exit(1)})"
  期望: OK

- [x] [BEHAVIOR] INV-5 凭据安全：本 sprint 触达文件无硬编码凭据/token 形态字符串
  Test: manual:bash -c '! grep -rnE "(sk-[A-Za-z0-9]{16}|ghp_[A-Za-z0-9]{16}|xoxb-[0-9]|AKIA[0-9A-Z]{12})" packages/brain/src/ledger-hygiene.js packages/brain/scripts/smoke/codex-headed-dispatch-smoke.sh packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh sprints/08070516-relay-2c482ed6/tests/ && echo OK'
  期望: OK

## Invariant 铁律映射（PRD:60-74 逐条 — 覆盖条目或显式 N/A）

- INV-1 [串行执行] N/A：本 sprint 不触及 slot/会话调度，纯指标口径修正
- INV-2 [禁写死环境值] 覆盖于 [BEHAVIOR] INV-2（排除前缀经共享常量派生；smoke_tag 为机器标记非环境假设值，无屏幕坐标/阈值写死）
- INV-3 [真环境验证] 覆盖于 [BEHAVIOR] noise/real-miss/issue-real-miss/harness-once 四场景（真 cecelia 库 + 真跑只读复现脚本差分）与 `## E2E 验收` 脚本；本 sprint 接缝 = 代码↔真 Postgres，全部真库验证，无 logic-done-pending 项
- INV-4 [测试多租户] N/A：tasks/issues 表无租户维度，守卫为 Brain 单实例内部指标
- INV-5 [凭据安全] 覆盖于 [BEHAVIOR] INV-5（触达文件无硬编码凭据；测试数据不含 secrets）
- INV-6 [日志脱敏] N/A：守卫日志仅指标数字与 title 前缀，无 PII/聊天内容
- INV-7 [端点鉴权] N/A：不新增/不修改任何 API 端点
- INV-8 [租户隔离] N/A：同 INV-4
- INV-9 [设备类型审查] N/A：无 UI/设备语义；无字段语义重叠新增
- INV-10 [自产数据排除] 覆盖于 [BEHAVIOR] INV-10（本 sprint 核心：共享常量前缀标记 + 统计侧排除，m2 对齐 m7 既有模式）与 [ARTIFACT] A1
- INV-11 [日历窗口] N/A：本 sprint 不新建探针时间窗；新增排除谓词均为无时间参数的字段谓词；存量 m2 7 天滚动窗依 PRD 假设 3 不改（改造记后续 sprint）

## error path 说明

m2 计算无 HTTP 面；口径层面的「error path」= 排除误伤防护（real-miss / issue-real-miss 双侧覆盖：排除过宽 → 差分为 +0 即 FAIL）。SQL 执行失败的降级路径（safeMetric → enabled=false 不阻断其他指标）由既有回归测试 ledger-hygiene.test.js「单指标 SQL 失败 → 该指标 enabled=false」守护，本合同不重复、不得回退。
