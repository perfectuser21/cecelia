---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: tick.js 单位注释补强

**范围**: 仅修改 `packages/brain/src/tick.js`，在 import 块（约 line 53–60）内 `TICK_LOOP_INTERVAL_MS` 行 ±2 行范围里追加一行 `//` 注释，明确说明单位为毫秒（ms）。其余文件、其余常量、import/export 顺序、运行时逻辑一律不动。

**大小**: S

**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 中 `TICK_LOOP_INTERVAL_MS` 第一处出现位置（必为 import 块，行号 < 100）的 ±2 行窗口内存在一行以 `//` 开头的注释，且该注释同时包含 `TICK_LOOP_INTERVAL_MS` 与 `毫秒` 或 `ms` 字样。
  Test: `node -e "const fs=require('fs'); const lines=fs.readFileSync('packages/brain/src/tick.js','utf8').split('\n'); const idx=lines.findIndex(l=>/TICK_LOOP_INTERVAL_MS/.test(l)); if(idx<0||idx>=100){process.exit(1)}; const w=lines.slice(Math.max(0,idx-2),idx+3); const ok=w.some(l=>/^\s*\/\//.test(l)&&/(毫秒|ms|MS)/.test(l)&&/TICK_LOOP_INTERVAL_MS/.test(l)); if(!ok)process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 文件末尾的 `export { ... }` 名单仍 re-export `TICK_LOOP_INTERVAL_MS`（未删除该常量的对外导出）。
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!/export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 中从 `./tick-loop.js` 的 import 块内三个常量顺序保持 `TICK_INTERVAL_MINUTES` → `TICK_LOOP_INTERVAL_MS` → `TICK_TIMEOUT_MS`。
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const m=c.match(/from\s+[\"']\.\/tick-loop\.js[\"']/); if(!m)process.exit(1); const block=c.slice(0,m.index); const last=block.lastIndexOf('import'); const ib=c.slice(last,m.index); const a=ib.indexOf('TICK_INTERVAL_MINUTES'); const b=ib.indexOf('TICK_LOOP_INTERVAL_MS'); const d=ib.indexOf('TICK_TIMEOUT_MS'); if(!(a>-1&&b>-1&&d>-1&&a<b&&b<d))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/tick-loop.js` 与 `origin/main` 完全一致（任务范围外文件）。
  Test: `git fetch origin main --depth=1 2>/dev/null; git diff --quiet origin/main -- packages/brain/src/tick-loop.js`

- [ ] [ARTIFACT] 净 diff：相对 `origin/main`，`packages/brain/` 下仅 `tick.js` 一个文件被改动，且该文件 `+1 / -0`。
  Test: `bash -c 'git fetch origin main --depth=1 2>/dev/null; CH=$(git diff --name-only origin/main -- packages/brain/ | sort -u); [ "$CH" = "packages/brain/src/tick.js" ] || exit 1; A=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk "{print \$1}"); D=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk "{print \$2}"); [ "$A" = "1" ] && [ "$D" = "0" ]'`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 仍是合法 ES Module（`node --check` 通过）。
  Test: `node --check packages/brain/src/tick.js`

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/tick-comment.test.ts`，覆盖：
- 在 `TICK_LOOP_INTERVAL_MS` 第一处出现行的 ±2 行窗口内能解析出一条 `//` 单行注释且同时包含 `毫秒|ms` 与 `TICK_LOOP_INTERVAL_MS`
- import 块内三个常量顺序保持 `MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS`
- 文件末尾 `export { ... }` 名单仍含 `TICK_LOOP_INTERVAL_MS`
- `tick.js` 通过 `node --check` 静态语法校验
