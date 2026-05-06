contract_branch: cp-05072418-9066fec7
workstream_index: 1
sprint_dir: sprints

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: tick.js 单位注释补强

**范围**: 仅修改 `packages/brain/src/tick.js`，在 import 块（约 line 53–60）内 `TICK_LOOP_INTERVAL_MS` 行 ±2 行范围里追加一行 `//` 注释，明确说明单位为毫秒（ms）。其余文件、其余常量、import/export 顺序、运行时逻辑一律不动。

**大小**: S

**依赖**: 无

> **Round 2 加固**: 所有依赖 diff 比对的 ARTIFACT 改用 `BASE_SHA` → `origin/main` (fetch) → `git merge-base HEAD main` 三级 fallback，任何一级失败显式报错，禁止 `2>/dev/null` 静默吞掉。
>
> **共享 helper**：`resolve_base()` 在每条 [ARTIFACT] 内联，避免依赖外部脚本文件。

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 是无 BOM 的 UTF-8 文件（防止中文 grep 失配）。
  Test: `bash -c 'HEAD3=$(head -c 3 packages/brain/src/tick.js | od -An -tx1 | tr -d " \n"); [ "$HEAD3" != "efbbbf" ] || { echo "FAIL: tick.js 含 UTF-8 BOM"; exit 1; }; if command -v iconv >/dev/null 2>&1; then iconv -f UTF-8 -t UTF-8 packages/brain/src/tick.js > /dev/null; fi'`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 中 `TICK_LOOP_INTERVAL_MS` 第一处出现位置（必为 import 块，行号 < 100）的 ±2 行窗口内存在一行以 `//` 开头的注释，且该注释同时包含 `TICK_LOOP_INTERVAL_MS` 与 `毫秒` 或 `ms` 或 `MS` 字样。
  Test: `node -e "const fs=require('fs'); const lines=fs.readFileSync('packages/brain/src/tick.js','utf8').split('\n'); const idx=lines.findIndex(l=>/TICK_LOOP_INTERVAL_MS/.test(l)); if(idx<0||idx>=100){console.error('FAIL: 第一处行号 '+idx+' 不在 import 块');process.exit(1)}; const w=lines.slice(Math.max(0,idx-2),idx+3); const ok=w.some(l=>/^\s*\/\//.test(l)&&/(毫秒|ms|MS)/.test(l)&&/TICK_LOOP_INTERVAL_MS/.test(l)); if(!ok){console.error('FAIL: 窗口内未发现说明 TICK_LOOP_INTERVAL_MS 单位的 // 注释');process.exit(1)}"`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 文件末尾的 `export { ... }` 名单仍 re-export `TICK_LOOP_INTERVAL_MS`（未删除该常量的对外导出）。
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!/export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 中从 `./tick-loop.js` 的 import 块内三个常量顺序保持 `TICK_INTERVAL_MINUTES` → `TICK_LOOP_INTERVAL_MS` → `TICK_TIMEOUT_MS`。
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const m=c.match(/from\s+[\"']\.\/tick-loop\.js[\"']/); if(!m)process.exit(1); const block=c.slice(0,m.index); const last=block.lastIndexOf('import'); const ib=c.slice(last,m.index); const a=ib.indexOf('TICK_INTERVAL_MINUTES'); const b=ib.indexOf('TICK_LOOP_INTERVAL_MS'); const d=ib.indexOf('TICK_TIMEOUT_MS'); if(!(a>-1&&b>-1&&d>-1&&a<b&&b<d))process.exit(1)"`

- [ ] [ARTIFACT] `packages/brain/src/tick-loop.js` 与 diff BASE 完全一致（任务范围外文件）。BASE 解析顺序：`$BASE_SHA` → `origin/main` (fetch) → `git merge-base HEAD main`，全部失败显式报错。
  Test: `bash -c 'set -e; resolve_base(){ if [ -n "${BASE_SHA:-}" ]; then echo "$BASE_SHA"; return 0; fi; set +e; git fetch origin main --depth=1; rc=$?; set -e; [ $rc = 0 ] && { echo origin/main; return 0; }; echo "WARN: fetch failed, fallback merge-base" >&2; git rev-parse --verify main >/dev/null 2>&1 && { git merge-base HEAD main; return 0; }; echo "FAIL: 无法解析 BASE" >&2; return 1; }; BASE=$(resolve_base); git diff --quiet "$BASE" -- packages/brain/src/tick-loop.js'`

- [ ] [ARTIFACT] 净 diff：相对 BASE，`packages/brain/` 下仅 `tick.js` 一个文件被改动，且该文件 `+1 / -0`。BASE 解析同上，三级 fallback 显式报错。
  Test: `bash -c 'set -e; resolve_base(){ if [ -n "${BASE_SHA:-}" ]; then echo "$BASE_SHA"; return 0; fi; set +e; git fetch origin main --depth=1; rc=$?; set -e; [ $rc = 0 ] && { echo origin/main; return 0; }; echo "WARN: fetch failed, fallback merge-base" >&2; git rev-parse --verify main >/dev/null 2>&1 && { git merge-base HEAD main; return 0; }; echo "FAIL: 无法解析 BASE" >&2; return 1; }; BASE=$(resolve_base); CH=$(git diff --name-only "$BASE" -- packages/brain/ | sort -u); [ "$CH" = "packages/brain/src/tick.js" ] || { echo "FAIL: 改动文件 [$CH]"; exit 1; }; A=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk "{print \$1}"); D=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk "{print \$2}"); [ "$A" = "1" ] && [ "$D" = "0" ]'`

- [ ] [ARTIFACT] `packages/brain/src/tick.js` 仍是合法 ES Module（`node --check` 通过）。
  Test: `node --check packages/brain/src/tick.js`

- [ ] [ARTIFACT] `sprints/tests/ws1/tick-comment.test.ts` 文件存在，且能被 vitest 枚举（**从仓库根跑**：`packages/brain/vitest.config.js` 不覆盖 `sprints/` 路径；仓库根无 vitest.config，使用默认 include `**/*.{test,spec}.*`，sprints/ 自然被包含）。
  Test: `bash -c 'test -f sprints/tests/ws1/tick-comment.test.ts && timeout 60 npx vitest list sprints/tests/ws1/tick-comment.test.ts 2>&1 | grep -q tick-comment.test.ts'`

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/tick-comment.test.ts`，4 个 `it` 块名单：
- `it('TICK_LOOP_INTERVAL_MS 第一处出现行的 ±2 行窗口内存在含「毫秒|ms」与常量名的 // 注释')`
- `it('文件末尾 export { ... } 名单仍 re-export TICK_LOOP_INTERVAL_MS')`
- `it('import 块内三个常量顺序仍为 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS')`
- `it('tick.js 通过 node --check 静态语法校验')`

Round 1 红证据：第 1 个 `it` fail（注释未加），其余 3 个 pass → Red 信号有效。Green 后 4 个 it 全 pass。
