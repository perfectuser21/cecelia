## v2 P2 PR3 account-rotation Middleware 抽出（2026-04-23）

### 根本原因

v2 P2 第 3 PR，按 spec §5.2 把 `resolveAccountForOpts` 从 `docker-executor.js` 搬到 `packages/brain/src/spawn/middleware/account-rotation.js` 并 rename 为 `resolveAccount`。核心技术选择：**保留 re-export 兼容层** `export { resolveAccount as resolveAccountForOpts }`，避免 break 13 处外部 caller（含 4 处老单测 + executor.js 注释）。零行为改动。

和 PR2 不同的是，这次 commit 顺序从一开始就 bisect-safe —— 先 feat 建新 file（docker-executor 仍保有原函数），再 refactor 同步删+加 re-export+改调用点一个 commit 原子完成。没有 PR2 那种"import 未 export 函数"的中间状态。Learning 里有教训在先，这次落实到位。

### 下次预防

- [ ] **rename 函数时默认加 re-export 兼容层**：业务代码改名后外部 caller 要么一次全改（blast radius 大 + 风险高），要么留 re-export（零风险过渡）。默认选后者，等 v2 11 PR 全部落地后一次性清旧名即可。这次 PR3 是正确示范，下次 rename 不要又想简化直接删
- [ ] **refactor commit = 原子切换**：`docker-executor.js` 这次的 refactor commit 里同时做了 3 件事（删老 export + 加 re-export + 改调用点）。这是**正确的**原子性——中间任何一步拆 commit 都会有"老名不能 import / 新名未导出"的 bisect 盲区。未来 rename/move 操作都按这个模板：**在一个 commit 里同时 flip source-of-truth 和兼容层**
- [ ] **deps 注入设计保留**：`resolveAccount(opts, { deps })` 的 ctx.deps 测试注入模式从 resolveAccountForOpts 完整继承。这个设计让 middleware 可以脱离 account-usage.js 单测，不用 vi.mock。后续 middleware（cascade / cap-marking / retry-circuit）都按这个模板写，别自己发明 DI 风格
