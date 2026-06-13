---
skeleton: false
journey_type: autonomous
---
# Contract DoD — GAN 容器退出后图静默卡死根治（checkpointer 连接超时硬化）

**范围**: 仅改 packages/brain/src/orchestrator/pg-checkpointer.js（getPgCheckpointer 改用自建带超时 pg Pool 的 PostgresSaver，替代无超时 fromConnString）+ 新增 regression test。不改 GAN graph 节点逻辑、不改 watchdog。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] pg-checkpointer.js 导出 buildCheckpointerPool 与 buildPgCheckpointer
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/pg-checkpointer.js','utf8');if(!c.includes('export function buildCheckpointerPool')||!c.includes('export function buildPgCheckpointer'))process.exit(1)"

- [x] [ARTIFACT] regression 测试文件存在且断言超时配置
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/pg-checkpointer-timeout.test.js','utf8');if(!c.includes('query_timeout')||!/describe|it\(/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 真实 node 进程/退出码）

- [x] [BEHAVIOR] checkpointer pool 注入 query_timeout + keepAlive，且不再用无超时的 fromConnString（防 checkpoint 写入静默无限挂起）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/pg-checkpointer.js','utf8');if(!/query_timeout:\s*CKPT_QUERY_TIMEOUT_MS/.test(c))process.exit(1);if(!/keepAlive:\s*true/.test(c))process.exit(1);if(/PostgresSaver\.fromConnString/.test(c))process.exit(1)"
  期望: exit 0（注入 query_timeout + keepAlive，且彻底移除 fromConnString）

- [x] [BEHAVIOR] 自建 pool 真实带有效超时数值（连接级 + 查询级，正数）
  Test: manual:node --input-type=module -e "import('./packages/brain/src/orchestrator/pg-checkpointer.js').then(async m=>{const p=m.buildCheckpointerPool('postgresql://cecelia@localhost:5432/cecelia');const o=p.options;await p.end();if(!(o.query_timeout>0)||!(o.statement_timeout>0)||!(o.connectionTimeoutMillis>0)||o.keepAlive!==true)process.exit(1)})"
  期望: exit 0（query_timeout/statement_timeout/connectionTimeoutMillis 均为正数，keepAlive=true）

- [x] [BEHAVIOR] regression 测试存在且复现「连接不可达 → 有界 reject 不无限挂起」行为（brain-ci 跑 vitest 验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/pg-checkpointer-timeout.test.js','utf8');if(!c.includes('10.255.255.1')||!c.includes('toBeLessThan(5000)')||!/describe|it\(/.test(c))process.exit(1)"
  期望: exit 0（测试含不可达连接有界 reject 的行为断言）
