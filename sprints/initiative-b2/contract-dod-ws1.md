# Contract DoD — Workstream 1: 建立 Initiative B2 标识清单 + discover + check + 文档索引登记

**范围**:
- 新增 `sprints/initiative-b2/manifest.json`（4 个字段：initiative_id / title / description / status）
- 新增 `sprints/initiative-b2/discover.mjs`（导出 `discoverInitiativeB2`，纯读取无副作用）
- 新增 `sprints/initiative-b2/check.mjs`（import discover.mjs，串起来跑）
- 修改 `docs/current/README.md`（追加 ≥ 1 条指向 `sprints/initiative-b2` 的索引条目）

**大小**: S（< 100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] manifest.json 文件存在
  Test: node -e "require('fs').accessSync('sprints/initiative-b2/manifest.json')"

- [ ] [ARTIFACT] manifest.json 是合法 JSON
  Test: node -e "JSON.parse(require('fs').readFileSync('sprints/initiative-b2/manifest.json','utf8'))"

- [ ] [ARTIFACT] manifest.json 含 initiative_id / title / description / status 四个键
  Test: node -e "const m=JSON.parse(require('fs').readFileSync('sprints/initiative-b2/manifest.json','utf8'));for(const k of ['initiative_id','title','description','status']){if(typeof m[k]!=='string'||m[k].length===0)process.exit(1)}"

- [ ] [ARTIFACT] manifest.json.status 等于 "active"
  Test: node -e "const m=JSON.parse(require('fs').readFileSync('sprints/initiative-b2/manifest.json','utf8'));if(m.status!=='active')process.exit(1)"

- [ ] [ARTIFACT] manifest.json.description 长度 >= 60
  Test: node -e "const m=JSON.parse(require('fs').readFileSync('sprints/initiative-b2/manifest.json','utf8'));if(typeof m.description!=='string'||m.description.length<60)process.exit(1)"

- [ ] [ARTIFACT] manifest.json.initiative_id 包含 "B2"（不区分大小写）
  Test: node -e "const m=JSON.parse(require('fs').readFileSync('sprints/initiative-b2/manifest.json','utf8'));if(!/B2/i.test(m.initiative_id))process.exit(1)"

- [ ] [ARTIFACT] discover.mjs 文件存在
  Test: node -e "require('fs').accessSync('sprints/initiative-b2/discover.mjs')"

- [ ] [ARTIFACT] discover.mjs 导出具名函数 discoverInitiativeB2
  Test: node -e "const c=require('fs').readFileSync('sprints/initiative-b2/discover.mjs','utf8');if(!/export\s+(async\s+)?function\s+discoverInitiativeB2\b|export\s*\{[^}]*\bdiscoverInitiativeB2\b[^}]*\}|export\s+const\s+discoverInitiativeB2\s*=/.test(c))process.exit(1)"

- [ ] [ARTIFACT] discover.mjs 不引入新依赖（仅 import node: 前缀模块）
  Test: node -e "const c=require('fs').readFileSync('sprints/initiative-b2/discover.mjs','utf8');const re=/import\s+(?:[^'\";]+\s+from\s+)?['\"]([^'\"]+)['\"]/g;let m;while((m=re.exec(c))){if(!m[1].startsWith('node:')&&!m[1].startsWith('./')&&!m[1].startsWith('../'))process.exit(1)}"

- [ ] [ARTIFACT] check.mjs 文件存在
  Test: node -e "require('fs').accessSync('sprints/initiative-b2/check.mjs')"

- [ ] [ARTIFACT] check.mjs 引用 discover.mjs（确保走 Feature 2 路径，不绕过 discover 复制逻辑）
  Test: node -e "const c=require('fs').readFileSync('sprints/initiative-b2/check.mjs','utf8');if(!/from\s+['\"]\.\/discover\.mjs['\"]|from\s+['\"]\.\/discover\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] check.mjs 不引入新依赖（仅 import node: 前缀或 ./discover.mjs）
  Test: node -e "const c=require('fs').readFileSync('sprints/initiative-b2/check.mjs','utf8');const re=/import\s+(?:[^'\";]+\s+from\s+)?['\"]([^'\"]+)['\"]/g;let m;while((m=re.exec(c))){const s=m[1];if(!s.startsWith('node:')&&s!=='./discover.mjs'&&s!=='./discover.js')process.exit(1)}"

- [ ] [ARTIFACT] docs/current/README.md 含 ≥ 1 行同时出现 "Initiative B2" 与 "sprints/initiative-b2"
  Test: node -e "const c=require('fs').readFileSync('docs/current/README.md','utf8');const hits=c.split('\n').filter(l=>l.includes('Initiative B2')&&l.includes('sprints/initiative-b2'));if(hits.length<1)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/discover.test.ts`，覆盖（Feature 2）：
- exports a named function discoverInitiativeB2
- returns an object with all four required fields as strings
- returns status equal to "active"
- returns description with length >= 60
- returns initiative_id containing "B2" (case-insensitive)
- is idempotent — two consecutive calls return deeply equal objects
- has no filesystem side effects on call

见 `tests/ws1/check.test.ts`，覆盖（Feature 4）：
- exits with code 0 in a clean checkout
- exits with non-zero code and reports manifest error when manifest.json is missing
