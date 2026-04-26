# Contract DoD — Workstream 1: 新增 build-info Router 并挂载到 server.js

**范围**:
- 新建 `packages/brain/src/routes/build-info.js`：Express Router，GET `/` 返回 `{ git_sha, package_version, built_at }`，`package_version` 从 `packages/brain/package.json` 读取，`built_at` 在模块加载时一次性确定，`git_sha` 按固定优先级 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA` 取第一个非空，全空时回落 `'unknown'`，禁止 runtime 调用 `child_process` / `git rev-parse`。
- 修改 `packages/brain/server.js`：追加 import 与 `app.use('/api/brain/build-info', buildInfoRoutes)` 挂载行；不删除现有路由。

**大小**: S（< 100 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] 新文件 `packages/brain/src/routes/build-info.js` 存在
  Test: node -e "require('fs').accessSync('packages/brain/src/routes/build-info.js')"

- [ ] [ARTIFACT] `build-info.js` 使用 `import { Router } from 'express'` 并以 `export default <name>` 导出（结构与 brain-manifest.js 一致）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/import\s*\{[^}]*Router[^}]*\}\s*from\s*['\"]express['\"]/.test(c))process.exit(1);if(!/export\s+default\s+\w+/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `build-info.js` 注册了 GET `/` 处理器
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/\.get\(\s*['\"]\/['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `build-info.js` 引用了 `package.json` 作为 package_version 来源（禁止硬编码版本字面量 `1.223.0`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(!/package\.json/.test(c))process.exit(1);if(/['\"]1\.223\.0['\"]/.test(c))process.exit(2)"

- [ ] [ARTIFACT] `build-info.js` 静态可见五个 SHA env 变量标识符 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA`（实现固定优先级链所必需，缺一即视为偏离合同）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');for(const k of ['GIT_SHA','GIT_COMMIT','COMMIT_SHA','SOURCE_COMMIT','VERCEL_GIT_COMMIT_SHA']){if(!new RegExp('\\\\b'+k+'\\\\b').test(c)){console.error('missing env identifier:',k);process.exit(1)}}"

- [ ] [ARTIFACT] `build-info.js` 禁止 runtime 调用 `child_process` / `execSync` / `spawnSync`（git 元信息必须由构建流水线注入 env，不在 runtime 跑 `git rev-parse`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/build-info.js','utf8');if(/require\(['\"]child_process['\"]\)|from\s+['\"]child_process['\"]|\bexecSync\b|\bspawnSync\b/.test(c)){console.error('forbidden child_process usage');process.exit(1)}"

- [ ] [ARTIFACT] `server.js` 顶部 import 了 build-info router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+buildInfoRoutes\s+from\s+['\"]\.\/src\/routes\/build-info\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 挂载了 `/api/brain/build-info` 路由到 `buildInfoRoutes`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/build-info['\"]\s*,\s*buildInfoRoutes\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 现有 `/api/brain/manifest` 挂载行未被删除（回归保护，确保不破坏既有 server.js 启动流程）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/manifest['\"]\s*,\s*brainManifestRoutes\s*\)/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/，共 9 个 it()，与 contract-draft.md BEHAVIOR 覆盖列表 1:1 对应）

见 `tests/ws1/build-info.test.js`：

1. GET `/api/brain/build-info` 返回 200 + content-type `application/json`
2. 响应 body 含 own property `git_sha`
3. 响应 body 含 own property `package_version`
4. 响应 body 含 own property `built_at`
5. 响应 body **恰好** 三个 own enumerable keys，不允许多余字段（`Object.keys(body).sort() === ['built_at','git_sha','package_version']`）
6. `package_version` 严格等于 `packages/brain/package.json` 的 `version` 字段值（runtime 读文件比对，非硬编码）
7. `built_at` 是合法且规范化的 ISO 8601 字符串（`new Date(x).toISOString() === x`）
8. `git_sha` 是非空字符串，**即使**清空 `GIT_SHA / GIT_COMMIT / COMMIT_SHA / SOURCE_COMMIT / VERCEL_GIT_COMMIT_SHA` 五个常见 SHA 注入变量
9. `git_sha` 取值遵循固定优先级 `GIT_SHA → GIT_COMMIT → COMMIT_SHA → SOURCE_COMMIT → VERCEL_GIT_COMMIT_SHA → 'unknown'`（5 个 env 变量同时设不同 sentinel，逐个删除最高位、断言次高位接管，全部删除后回落字面量 `'unknown'`）

测试默认隔离 module 缓存：测试文件 `beforeEach(() => vi.resetModules())`，确保每个 it 独立重新评估 build-info.js 模块顶层（重新读 env vars / Date.now()），不被前一个 it 的 env 操控残留污染。
