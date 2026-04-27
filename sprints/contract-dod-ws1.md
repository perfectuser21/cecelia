# Contract DoD — Workstream 1: Pre-flight 校验模块 + 配置 + 派发集成 + 文档

**范围**:
- 新增 `packages/brain/src/preflight.js`，命名导出 4 项：
  - `checkInitiativeDescription(description, options?)` — 校验函数
  - `buildPreflightFailureResult(description, options?)` — 失败回写对象工厂
  - `getMinDescriptionLength()` — 阈值解析（env / default）
  - `DEFAULT_MIN_DESCRIPTION_LENGTH = 60` — 默认阈值常量
- `packages/brain/src/dispatcher.js` 集成 preflight：失败时把 task 标 `rejected_preflight`，写入 `buildPreflightFailureResult(...)` 到 `result`，不创建下游子任务
- `packages/brain/.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 记录新校验点

**大小**: S（< 150 行）
**依赖**: 无

## ARTIFACT 条目

> 每条 Test 字段都是单行可粘贴命令，exit-code = 0 表示通过。
> 走 CI 白名单允许的前缀：`bash -c '…'` / `node -e "…"`。

- [ ] [ARTIFACT] `packages/brain/src/preflight.js` 文件存在
  Test: bash -c 'test -f packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 命名导出 `checkInitiativeDescription`
  Test: bash -c 'grep -cE "^export[[:space:]]+(function|const|async[[:space:]]+function)[[:space:]]+checkInitiativeDescription([[:space:]]|\(|=)" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 命名导出 `buildPreflightFailureResult`
  Test: bash -c 'grep -cE "^export[[:space:]]+(function|const|async[[:space:]]+function)[[:space:]]+buildPreflightFailureResult([[:space:]]|\(|=)" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 命名导出 `getMinDescriptionLength`
  Test: bash -c 'grep -cE "^export[[:space:]]+(function|const|async[[:space:]]+function)[[:space:]]+getMinDescriptionLength([[:space:]]|\(|=)" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 命名导出常量 `DEFAULT_MIN_DESCRIPTION_LENGTH`
  Test: bash -c 'grep -cE "^export[[:space:]]+const[[:space:]]+DEFAULT_MIN_DESCRIPTION_LENGTH([[:space:]]|=)" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 字面量赋值 `DEFAULT_MIN_DESCRIPTION_LENGTH = 60`
  Test: bash -c 'grep -cF "DEFAULT_MIN_DESCRIPTION_LENGTH = 60" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `preflight.js` 引用环境变量名 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
  Test: bash -c 'grep -cF "INITIATIVE_MIN_DESCRIPTION_LENGTH" packages/brain/src/preflight.js'

- [ ] [ARTIFACT] `packages/brain/src/dispatcher.js` 含 `from './preflight.js'` 形式的静态 ESM import（单/双引号皆可）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(!/from\s+['\"]\.\/preflight\.js['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/dispatcher.js` 文件含字面量 `rejected_preflight`
  Test: bash -c 'grep -cF "rejected_preflight" packages/brain/src/dispatcher.js'

- [ ] [ARTIFACT] `packages/brain/.env.example` 声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
  Test: bash -c 'grep -cF "INITIATIVE_MIN_DESCRIPTION_LENGTH" packages/brain/.env.example'

- [ ] [ARTIFACT] `DEFINITION.md` 记录 preflight 校验点（大小写不敏感）
  Test: bash -c 'grep -ciF "preflight" DEFINITION.md'

## BEHAVIOR 索引（实际测试在 tests/ws1/preflight.test.ts）

见 `tests/ws1/preflight.test.ts`，共 **21 个 it() = Feature 1 (16) + Feature 2 (5)**：

**Feature 1 — 校验函数行为（16 个 it）**：
- 阈值边界（等于 / 大于 / 小于）→ 3
- 空字符串 / 纯空白 / null / undefined 输入 → 4
- Unicode code-point 计数（CJK 60/59、emoji surrogate pair）→ 3
- options.threshold 覆盖环境变量 → 1
- 环境变量 `INITIATIVE_MIN_DESCRIPTION_LENGTH` 实时读取（无缓存）→ 1
- 默认 60 fallback（缺失 / 非数 / 非正）→ 3
- 同输入幂等（无副作用）→ 1

**Feature 2 — 失败回写结构（5 个 it）**：
- `buildPreflightFailureResult` 返回带 `preflight_failure_reason` 的 plain object → 1
- `preflight_failure_reason.reason` 类型为 string、长度 ≥ 10 → 1
- `preflight_failure_reason.actualLength` 等于 trim 后 code-point 数 → 1
- `preflight_failure_reason.threshold` 反映生效阈值（env / option）→ 1
- 对 null / undefined description 不抛 → 1
