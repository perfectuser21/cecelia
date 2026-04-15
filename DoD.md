contract_branch: cp-harness-contract-ad3cd28b
workstream_index: 3
sprint_dir: sprints/harness-v7-docker-sandbox

- [x] [ARTIFACT] packages/brain/src/slot-allocator.js 定义 TOTAL_CONTAINER_MEMORY_MB = 12288（非注释代码）
- [x] [ARTIFACT] packages/brain/src/slot-allocator.js 定义三池：Pool A = 2048 MB，Pool B = 6144 MB，Pool C = 4096 MB（非注释代码）
- [x] [BEHAVIOR] slot-allocator.js 含可用内存计算逻辑（非硬编码返回值）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//') && !l.trim().startsWith('*'));const code=lines.join('\n');if(!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(code)){console.log('FAIL');process.exit(1);}if(!/2048/.test(code)||!/6144/.test(code)||!/4096/.test(code)){console.log('FAIL');process.exit(1);}if(!/available.*memory|memory.*available|remain|capacity/i.test(code)){console.log('FAIL');process.exit(1);}console.log('PASS');"
- [x] [BEHAVIOR] tick.js 调度逻辑引用 memory/CONTAINER_SIZES/allocat（非注释代码）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//') && !l.trim().startsWith('*'));const code=lines.join('\n');if(!/memory|CONTAINER_SIZES|allocat/i.test(code)){console.log('FAIL');process.exit(1);}console.log('PASS');"
- [x] [BEHAVIOR] slot-allocator 单元测试通过且覆盖三池和满载场景
  Test: tests/packages/brain/src/__tests__/slot-allocator.test.js
- [x] [BEHAVIOR] 池满载时 allocate 返回 false，任务应排队
  Test: tests/packages/brain/src/__tests__/slot-allocator.test.js
