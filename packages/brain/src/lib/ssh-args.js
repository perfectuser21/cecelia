/**
 * ssh-args.js
 *
 * ssh 直派公共参数（execFile 数组形式，本地不经 shell——CodeQL
 * js/command-line-injection 面）。
 *
 * 终审 I6：原定义在 `notion-push-sync.js`，`executor-contracts.js`（六类执行者
 * 探活合同的底座模块）为了复用它 import 了一整个 `notion-push-sync.js`（Notion
 * API/DB pool/OPS 表读写等一整条重依赖链），造成分层倒置——一个通用的探活底座
 * 反过来依赖一个具体的业务集成模块，且为将来任何"notion-push-sync.js 需要从
 * executor-contracts.js 拿点什么"埋下循环 import 的隐患。把这个纯常量数组抽到
 * 这个中立模块（不依赖任何业务模块），`notion-push-sync.js` 与
 * `executor-contracts.js` 都改成从这里 import，值原样不变。
 */
export const SSH_BASE_ARGS = Object.freeze([
  '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=no',
]);
