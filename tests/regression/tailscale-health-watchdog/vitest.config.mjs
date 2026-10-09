// 专用 config：故意不 import 'vitest/config'，以便零安装用 `npx vitest` 直接运行。
// 仓库根 vitest.config.js 依赖 'vitest/config'，而根 package.json 未声明 vitest，
// 加载它会 MODULE_NOT_FOUND —— 这正是 tests/regression/** 长期无法运行的原因。
export default {
  test: {
    include: ['**/*.test.js'],
    root: import.meta.dirname,
    testTimeout: 30000,
  },
};
