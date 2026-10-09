'use strict';
/**
 * 子进程超时收尸：先 SIGTERM，宽限期后仍未退出就 SIGKILL。
 * claude -p 会无视 SIGTERM 一直挂着（09-28 实查桥接器下 126 个挂了最长 3 天），只发 SIGTERM 等于不收。
 */
function terminateChild(child, { graceMs = 5000 } = {}) {
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, graceMs);
  if (typeof timer.unref === 'function') timer.unref();
  child.once('exit', () => clearTimeout(timer));
  return timer;
}

module.exports = { terminateChild };
