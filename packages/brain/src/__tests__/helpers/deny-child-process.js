// 应用模块的进程边界：只提供 Node child_process 的受控导出，绝不载入真实实现。
// 这不是系统沙箱；调用任一进程 API 都以明确错误终止。
const denied = Object.fromEntries([
  '_forkChild', 'ChildProcess', 'exec', 'execFile', 'execFileSync',
  'execSync', 'fork', 'spawn', 'spawnSync',
].map(name => [name, function denyProcessExecution() {
  throw new Error(`测试禁止 child_process.${name}`);
}]));

export default Object.freeze({ ...denied, default: Object.freeze(denied) });
