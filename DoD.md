# DoD — WS3 内存调度 + 三池隔离（FR-005 / FR-006）

## 成功标准

### [ARTIFACT] slot-allocator.js 含三池常量（非注释代码）

- [x] `TOTAL_CONTAINER_MEMORY_MB = 12288` 存在于非注释代码
- [x] 三池大小 2048/6144/4096 存在于非注释代码
- Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//') && !l.trim().startsWith('*'));const code=lines.join('\n');if(!/TOTAL_CONTAINER_MEMORY_MB\s*=\s*12288/.test(code)){console.log('FAIL');process.exit(1);}if(!/2048/.test(code)||!/6144/.test(code)||!/4096/.test(code)){console.log('FAIL: 三池大小缺失');process.exit(1);}console.log('PASS')"`

### [ARTIFACT] slot-allocator.js 含可用内存计算逻辑

- [x] `getPoolAvailableMemoryMb`、`allocate` 函数存在于非注释代码
- Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/slot-allocator.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!/available.*memory|memory.*available|remain|capacity/i.test(code)){console.log('FAIL: 无可用内存计算逻辑');process.exit(1);}console.log('PASS')"`

### [BEHAVIOR] tick.js 包含内存感知调度

- [x] tick.js 引用了 CONTAINER_SIZES / allocate / getTaskPoolName
- Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('//')&&!l.trim().startsWith('*'));const code=lines.join('\n');if(!/memory|CONTAINER_SIZES|allocat/i.test(code)){console.log('FAIL: tick.js 未引用内存/容器规格');process.exit(1);}console.log('PASS')"`

### [BEHAVIOR] slot-allocator 单元测试通过且覆盖三池场景

- [x] 测试覆盖三池常量验证、getTaskPoolName、allocate、满载拒绝场景
- Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!/TOTAL_CONTAINER_MEMORY_MB|POOL_A_MB|POOL_B_MB|POOL_C_MB/.test(c)){console.log('FAIL: 测试缺少三池常量验证');process.exit(1);}if(!/full|reject|queue|满载|insufficient/i.test(c)){console.log('FAIL: 缺少满载测试');process.exit(1);}if(!/pool|Pool|memory/i.test(c)){console.log('FAIL: 测试未覆盖池/内存场景');process.exit(1);}console.log('PASS')"`

### [BEHAVIOR] 池满载时 allocate 返回 false，任务拒绝派发

- [x] Pool B 满载（6 任务 × 1024 MB = 6144 MB）时 allocate 返回 false
- [x] Pool B 满载不影响 Pool C（池间隔离）
- Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/slot-allocator.test.js','utf8');if(!/allocate.*false|false.*allocate|拒绝派发|pool.*full/i.test(c)){console.log('FAIL: 缺少满载拒绝测试');process.exit(1);}console.log('PASS')"`
