# DoD

## [ARTIFACT] Files
- [x] `packages/brain/src/langfuse-reporter.js` 存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/langfuse-reporter.js')"`
- [x] `frontend/src/features/core/brain/pages/LangfuseObservability.tsx` 存在
  - Test: `manual:node -e "require('fs').accessSync('frontend/src/features/core/brain/pages/LangfuseObservability.tsx')"`
- [x] 单元测试 `packages/brain/src/__tests__/langfuse-reporter.test.js` 存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/langfuse-reporter.test.js')"`

## [BEHAVIOR] 运行时行为
- [x] langfuse-reporter 在 env 缺失时 isEnabled() 返回 false（不抛错）
  - Test: `packages/brain/src/__tests__/langfuse-reporter.test.js`
- [x] langfuse-reporter 在 env 完整时构造含 trace-create + generation-create 的合法 payload
  - Test: `packages/brain/src/__tests__/langfuse-reporter.test.js`
- [x] llm-caller.js import 并在成功/失败路径调用 reportCall（非阻塞）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/llm-caller.js','utf8');if(!c.includes('langfuse-reporter'))process.exit(1);if(!c.includes('reportCall'))process.exit(1)"`
- [x] brain feature 注册 /llm-observability 路由指向 LangfuseObservability 组件
  - Test: `manual:node -e "const c=require('fs').readFileSync('frontend/src/features/core/brain/index.ts','utf8');if(!c.includes('LangfuseObservability'))process.exit(1);if(!c.includes('/llm-observability'))process.exit(1)"`
