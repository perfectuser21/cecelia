# Contract DoD — Workstream 1: Pre-flight 校验模块 + 配置 + 派发集成 + 文档

**范围**:
- 新增 `packages/brain/src/preflight.js`（含 `checkInitiativeDescription` / `buildPreflightFailureResult` / `getMinDescriptionLength` / `DEFAULT_MIN_DESCRIPTION_LENGTH` 命名导出）
- `packages/brain/src/dispatcher.js` 集成 preflight：失败时把 task 标 `rejected_preflight`，写入 `buildPreflightFailureResult(...)` 到 `result`，不创建下游子任务
- `packages/brain/.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 记录新校验点

**大小**: S（< 150 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/preflight.js` 文件存在
  Test: node -e "require('fs').accessSync('packages/brain/src/preflight.js')"

- [ ] [ARTIFACT] `preflight.js` 导出命名导出 `checkInitiativeDescription`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/export\s+(function|const)\s+checkInitiativeDescription\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `preflight.js` 导出命名导出 `buildPreflightFailureResult`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/export\s+(function|const)\s+buildPreflightFailureResult\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `preflight.js` 定义 `DEFAULT_MIN_DESCRIPTION_LENGTH = 60`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/DEFAULT_MIN_DESCRIPTION_LENGTH\s*=\s*60\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `preflight.js` 引用环境变量名 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/preflight.js','utf8');if(!/INITIATIVE_MIN_DESCRIPTION_LENGTH/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/dispatcher.js` 含 `from './preflight.js'` 静态 ESM import
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/from\s+['\"]\.\/preflight\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/dispatcher.js` 文件含字面量 `rejected_preflight`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!c.includes('rejected_preflight'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/.env.example','utf8');if(!/INITIATIVE_MIN_DESCRIPTION_LENGTH/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `DEFINITION.md` 记录 preflight 校验点（大小写不敏感）
  Test: node -e "const c=require('fs').readFileSync('DEFINITION.md','utf8');if(!/preflight/i.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/preflight.test.ts）

见 `tests/ws1/preflight.test.ts`，覆盖：
- 阈值边界（等于 / 大于 / 小于）
- 空字符串 / 纯空白 / null / undefined 输入
- Unicode code-point 字符计数（CJK、emoji surrogate pair）
- options.threshold 覆盖环境变量
- 环境变量 INITIATIVE_MIN_DESCRIPTION_LENGTH 实时读取（无缓存）
- 默认 60 fallback（缺失 / 非数 / 非正）
- 同输入幂等
- buildPreflightFailureResult 返回结构（preflight_failure_reason.reason/actualLength/threshold）
