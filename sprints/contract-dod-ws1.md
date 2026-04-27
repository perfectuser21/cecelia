# Contract DoD — Workstream 1: PRD Presence Validator

**范围**: 在 `sprints/validators/prd-presence.mjs` 实现 `checkSprintPrdPresence(path)`，返回 `{ok, size?, lines?, reason?}` 形态值，不抛异常。
**大小**: S（< 100 行实现）
**依赖**: 无（图入口）

> **DoD 机检约定**: 所有 Test 命令均为 shell 单行，非 0 退出 = 红。CI 可 `set -e` 串起来跑。

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 文件存在
  Test: test -f sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 字节数 > 0（非空）
  Test: test -s sprints/sprint-prd.md

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 行数 ≥ 50
  Test: bash -c '[ "$(wc -l < sprints/sprint-prd.md)" -ge 50 ]'

- [ ] [ARTIFACT] `sprints/validators/prd-presence.mjs` 文件存在
  Test: test -f sprints/validators/prd-presence.mjs

- [ ] [ARTIFACT] `sprints/validators/prd-presence.mjs` 运行时 export 名为 `checkSprintPrdPresence` 的 function
  Test: node -e "import('./sprints/validators/prd-presence.mjs').then(m=>process.exit(typeof m.checkSprintPrdPresence==='function'?0:1)).catch(()=>process.exit(2))"

- [ ] [ARTIFACT] vitest 能加载 `sprints/tests/` 测试套件（不报 ERR_MODULE_NOT_FOUND 之外的解析错）
  Test: bash -c 'npx vitest run sprints/tests/ --reporter=basic > /tmp/vitest-load.log 2>&1 || true; ! grep -qE "SyntaxError|ParseError|Unexpected token|Transform failed" /tmp/vitest-load.log && grep -qE "Test Files|Tests" /tmp/vitest-load.log'

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/prd-presence.test.ts`，覆盖：
- returns ok=true with size and lines for the real sprint PRD
- returns ok=false with reason=missing when path does not exist, instead of throwing
- returns ok=false with reason=empty when the file exists but is zero bytes
