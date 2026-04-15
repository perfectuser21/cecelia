# Contract DoD — Workstream 3: 内存调度 + 三池隔离（Round 2）

- [ ] [BEHAVIOR] slot-allocator.js 非注释代码中定义 TOTAL_CONTAINER_MEMORY_MB=12288 + 三池大小（2048/6144/4096）+ 可用内存计算逻辑
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(code)){console.log('FAIL: TOTAL_CONTAINER_MEMORY_MB');process.exit(1)}if(!/2048/.test(code)||!/6144/.test(code)||!/4096/.test(code)){console.log('FAIL: 三池大小');process.exit(1)}if(!/available.*memory|memory.*available|remain|capacity/i.test(code)){console.log('FAIL: 无可用内存计算');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] tick.js 调度逻辑引用内存/容器规格（非仅 MAX_SEATS，非注释代码）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!/memory|CONTAINER_SIZES|allocat/i.test(code)){console.log('FAIL: tick.js 无内存感知调度');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] slot-allocator 单元测试通过且覆盖三池/内存场景
  Test: npm test -- --testPathPattern=slot-allocator --reporter=verbose 2>&1 | node -e "const out=require('fs').readFileSync('/dev/stdin','utf8');if(/Tests:.*failed/.test(out)){console.log('FAIL');process.exit(1)}if(!/Tests:.*\d+ passed/.test(out)||/Tests:.*0 passed/.test(out)){console.log('FAIL: 无通过测试');process.exit(1)}if(!/pool|Pool|内存|memory/i.test(out)){console.log('FAIL: 未覆盖池场景');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 池满载时 allocate 返回 null/false，任务排队（失败路径）
  Test: npm test -- --testPathPattern=slot-allocator --testNamePattern="full|reject|queue|满载|insufficient" --reporter=verbose 2>&1 | node -e "const out=require('fs').readFileSync('/dev/stdin','utf8');if(/Tests:.*failed/.test(out)){console.log('FAIL');process.exit(1)}if(!/Tests:.*\d+ passed/.test(out)||/Tests:.*0 passed/.test(out)){console.log('FAIL: 无池满载测试');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] slot-allocator.test.js 包含三池隔离和内存不足排队的测试用例
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!c.includes('pool')&&!c.includes('Pool')&&!c.includes('memory'))process.exit(1);console.log('OK')"
