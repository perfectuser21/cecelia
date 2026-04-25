# Contract DoD — Workstream 4: 项目内 vitest 测试 + 文档路由表更新

**范围**: 在 `packages/brain/src/__tests__/` 下新增 health 路由测试文件（必须字面引用 `/api/brain/health`，与现有 `health-monitor.test.js` 等区分），并在 `docs/` 或 `packages/brain/` 下追加端点说明（**不能**只更新 `sprints/` 内文件、**不能**只更新 `DEFINITION.md`）。**不修改** `routes/health.js`、`server.js`、`sprints/`。
**大小**: S
**依赖**: Workstream 1 PR 已 merged 进 main（项目内测试通过自组 mini app + import `routes/health.js` 验证三字段，不依赖 WS2/WS3 PR）
**派发顺序**: Phase B 第二批，与 WS2/WS3 并发

> **命名空间隔离**：本 workstream 新增的 `packages/brain/src/__tests__/*health*.test.{js,ts}` 由 `packages/brain/vitest.config.js` 的 `include=['src/**/*.{test,spec}.?(c|m)[jt]s?(x)', ...]` 扫描，落在 `packages/brain/` 工作区。合同测试由 `sprints/vitest.config.ts` 限定 `root=sprints` 扫描，互不串扰。本 DoD 文件中所有 vitest 命令显式带 `--config` 防误扫。

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/__tests__/` 下存在文件名匹配 `*health*.test.{js,ts}` 且**字面引用 `/api/brain/health`** 的文件（与已有的 health-monitor 等测试区分）
  Test: node -e "const fs=require('fs'),p=require('path');const dir='packages/brain/src/__tests__';let hit=null;for(const n of fs.readdirSync(dir)){if(!/health.*\.test\.(js|ts|cjs|mjs)$/.test(n))continue;const c=fs.readFileSync(p.join(dir,n),'utf8');if(c.includes('/api/brain/health')){hit=n;break}}if(!hit)process.exit(1)"

- [ ] [ARTIFACT] 该 health 测试文件含 `from 'supertest'` 或 `require('supertest')` 引用
  Test: node -e "const fs=require('fs'),p=require('path');const dir='packages/brain/src/__tests__';let hit=null;for(const n of fs.readdirSync(dir)){if(!/health.*\.test\.(js|ts|cjs|mjs)$/.test(n))continue;const c=fs.readFileSync(p.join(dir,n),'utf8');if(c.includes('/api/brain/health')){hit=p.join(dir,n);break}}if(!hit)process.exit(1);const c=fs.readFileSync(hit,'utf8');if(!(/from\s+['\"]supertest['\"]/.test(c)||/require\(['\"]supertest['\"]\)/.test(c)))process.exit(1)"

- [ ] [ARTIFACT] 该 health 测试文件含至少 3 个 `it(` 块
  Test: node -e "const fs=require('fs'),p=require('path');const dir='packages/brain/src/__tests__';let hit=null;for(const n of fs.readdirSync(dir)){if(!/health.*\.test\.(js|ts|cjs|mjs)$/.test(n))continue;const c=fs.readFileSync(p.join(dir,n),'utf8');if(c.includes('/api/brain/health')){hit=p.join(dir,n);break}}if(!hit)process.exit(1);const c=fs.readFileSync(hit,'utf8');const m=c.match(/\bit\s*\(/g);if(!m||m.length<3)process.exit(1)"

- [ ] [ARTIFACT] 至少一个 markdown 文件（**排除 `sprints/` 目录与 `DEFINITION.md`**）同时包含 `/api/brain/health`、`status`、`uptime_seconds`、`version` 全 4 个 token
  Test: node -e "const fs=require('fs'),p=require('path');const skip=new Set(['node_modules','.git','dist','archive','coverage','.next','sprints']);function*walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name.startsWith('.')&&e.name!=='.')continue;if(skip.has(e.name))continue;const fp=p.join(d,e.name);if(e.isDirectory())yield*walk(fp);else if(e.name.endsWith('.md'))yield fp}}let ok=false;for(const f of walk('.')){if(p.relative('.',f)==='DEFINITION.md')continue;const c=fs.readFileSync(f,'utf8');if(c.includes('/api/brain/health')&&c.includes('status')&&c.includes('uptime_seconds')&&c.includes('version')){ok=true;break}}if(!ok)process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws4/）

见 `sprints/tests/ws4/docs-and-suite.test.ts`，覆盖：
- a documentation file (outside sprints/ and DEFINITION.md) lists /api/brain/health together with all three field names
- packages/brain/src/__tests__/ has a *health*.test.{js,ts} file that references /api/brain/health
- that test file declares at least 3 it() blocks and imports supertest
- running the in-project health test file via vitest exits with code 0

跑测命令（Repo Root）: `npx vitest run --config sprints/vitest.config.ts tests/ws4/`
