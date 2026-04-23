# zombie-cleaner P0 fix Learning

## 做了什么
修 `packages/brain/src/zombie-cleaner.js:findTaskIdForWorktree` 文件名不匹配
bug（读 `.dev-mode` / 写 `.dev-mode.${branch}`）。新增 `isWorktreeActive(wtPath)`
扫 `.dev-mode*` 文件 mtime < 24h 判活跃。cleanup 主循环加预检，保留
`findTaskIdForWorktree + activeTasks` 双回退兼容老格式。

## 根本原因
v19.0.0 cwd-as-key 改革时 `worktree-manage.sh` 把 `.dev-mode` 改成
`.dev-mode.${branch}`（按分支名带后缀，便于 cwd 归属识别），但 zombie-cleaner
没跟着改读取逻辑。文件名不匹配 → `readFileSync` 抛 → `return null` →
`activeTasks.has(null)=false` → 所有新格式 /dev worktree 活过 30min 被删。
命案：Phase B2 PR #2568 期间 interactive worktree age=33min 被误杀。

## 下次预防
- [ ] `.dev-mode/.dev-lock` 格式改动需全仓 grep 读取点（zombie-cleaner /
      pipeline-patrol / zombie-sweep 等），不能只改写入点
- [ ] cleanup/gc 脚本不要依赖内容解析（UUID 匹配），用稳定信号（文件存在 +
      mtime）更 robust
- [ ] Brain docker logs 有 "taskId=unknown" 要报警（本 bug 已生效 8+ 小时
      才被人眼看到，17 条误报无人追查）

## 关键决策
**24h 阈值**：interactive /dev 跨天工作合理，30min 太短。复用 Phase B2
`quarantine-active-signal` 同构思路（B2 用 90s 因为是 per-tick 决策；本场景
tick 跑一次就 rm 文件不可逆，必须宽）。

**保留 findTaskIdForWorktree + activeTasks OR 回退**：老格式 `.dev-mode`
（Brain docker agent 内部 worktree-manage.sh 版本可能未升级）仍要兼容。

## vitest mock 陷阱
`vi.clearAllMocks()` 只清 `.mock.calls`/`.mock.results`，**不清 mock 实现和
`mockReturnValueOnce` 队列**。若前一个 test 用了 `mockReturnValueOnce` 但未
消耗完，队列会残留到下一个 test，导致 mock 行为污染。

**正确做法**：跨 test mock 实现隔离用 `vi.resetAllMocks()`（清掉实现+队列），
或在每个 test 开头覆盖所有相关 mock。尤其是有 `mockReturnValueOnce` 链式调用的
describe，必须用 `resetAllMocks`。
