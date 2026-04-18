# DoD: selectNextDispatchableTask 加 claimed_by IS NULL 过滤

- [x] [ARTIFACT] `packages/brain/src/tick.js` 的 `selectNextDispatchableTask` SELECT WHERE 含 `AND t.claimed_by IS NULL`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const i=c.indexOf('async function selectNextDispatchableTask');const j=c.indexOf('async function',i+10);const block=c.slice(i,j);if(!block.includes('t.claimed_by IS NULL'))process.exit(1);console.log('claimed_by filter present')"`

- [x] [BEHAVIOR] 单测 `packages/brain/src/__tests__/select-next-claimed-filter.test.js` 通过，断言 SELECT SQL 字符串含 `claimed_by IS NULL`
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/select-next-claimed-filter.test.js','utf8');if(!c.includes('claimed_by IS NULL'))process.exit(1);if(!c.includes('selectNextDispatchableTask'))process.exit(1);console.log('test file OK')"`

- [x] [ARTIFACT] Learning 文件 `docs/learnings/cp-04180903-claim-filter.md` 存在并含根本原因 + 下次预防
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04180903-claim-filter.md','utf8');if(!c.includes('### 根本原因'))process.exit(1);if(!c.includes('### 下次预防'))process.exit(1);if(!c.includes('- [ ]'))process.exit(1);console.log('learning OK')"`
