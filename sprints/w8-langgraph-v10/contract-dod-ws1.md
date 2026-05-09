---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 入口 fixture + 注入脚本

**范围**: 提供最小可信 harness_initiative payload 与一键注入脚本
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/fixtures/initiative-payload.json` 存在且为合法 JSON，含 `task_type=harness_initiative` 与最小代码改动需求字段
  Test: node -e "const j=JSON.parse(require('fs').readFileSync('sprints/w8-langgraph-v10/fixtures/initiative-payload.json','utf8'));if(j.task_type!=='harness_initiative')process.exit(1);if(!j.payload||typeof j.payload.requirement!=='string'||j.payload.requirement.length<10)process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/scripts/inject-initiative.sh` 存在且可执行，注入后输出 UUID 到 stdout
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v10/scripts/inject-initiative.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('sprints/w8-langgraph-v10/scripts/inject-initiative.sh','utf8');if(!c.includes('INSERT INTO brain_tasks'))process.exit(2);if(!c.includes('RETURNING id'))process.exit(3)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/inject-initiative.cjs` 导出 `injectInitiative({pgClient, payloadPath})` 函数
  Test: node -e "const m=require('./sprints/w8-langgraph-v10/lib/inject-initiative.cjs');if(typeof m.injectInitiative!=='function')process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/inject-initiative.test.ts`，覆盖：
- injectInitiative() 读取 fixture payload 并通过 pgClient.query 插入一条 brain_tasks 行
- 返回值是新插入行的 id（UUID 字符串）
- 当 fixture payload 缺 requirement 字段时抛出可识别错误
