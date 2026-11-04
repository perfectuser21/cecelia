import { scanFile } from './task-type-registry.lexical.lib.js';

export const EXECUTOR_HANDLER_SITE = 'ast:program:const:_TASK_ROUTES:handlers';

// 与主守卫共用命中入口；结构身份在回归见红后实现。
export function scanGuardFile(absPath, relativePath) {
  return scanFile(absPath);
}
