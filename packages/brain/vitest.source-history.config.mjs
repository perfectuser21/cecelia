// 显式历史只读兼容回放；不进入默认Brain单元测试，也不授予当前发布资格。
import brain from './vitest.config.js';
export default {...brain,test:{...brain.test,include:['src/lib/__tests__/*.history.mjs']}};
