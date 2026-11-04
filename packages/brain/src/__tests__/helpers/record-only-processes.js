// 供隔离测试复用；每次越界先记录再抛错，绝不执行真实命令。
export function recordOnlyProcesses(record) {
  return Object.fromEntries(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].map(name => [name, (...args) => {
    record(name, ...args); throw Error('测试禁止宿主进程');
  }]));
}
