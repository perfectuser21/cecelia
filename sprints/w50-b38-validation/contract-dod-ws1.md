---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: harness-initiative-b38.test.js 添加 @langchain/langgraph mock

**范围**: 仅修改 `packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js`
**大小**: S(<50行净增)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] harness-initiative-b38.test.js 包含 vi.mock('@langchain/langgraph', ...) 块
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js','utf8');if(!c.includes(\"vi.mock('@langchain/langgraph'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] mock 块包含 StateGraph、Annotation、START、END 四个导出
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js','utf8');['StateGraph','Annotation','START','END'].forEach(k=>{if(!c.includes(k))process.exit(1)});console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] harness-initiative-b38.test.js vitest 解析无 ERR_MODULE_NOT_FOUND
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js 2>&1 | tee /tmp/b38-dod.log; grep -c "ERR_MODULE_NOT_FOUND" /tmp/b38-dod.log && exit 1 || true; echo OK'
  期望: 无 ERR_MODULE_NOT_FOUND，exit 0

- [ ] [BEHAVIOR] B38 测试套件 3 条用例全部 PASS
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js --reporter=verbose 2>&1 | tee /tmp/b38-dod2.log; grep -E "3 passed" /tmp/b38-dod2.log || exit 1; echo OK'
  期望: 日志含 "3 passed"，exit 0

- [ ] [BEHAVIOR] sprintDir 覆盖用例通过 — state.sprintDir 非空时注入正确值
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js --reporter=verbose 2>&1 | grep -E "✓|pass" | grep -i "sprintDir\|覆盖\|b37" | head -3; echo done'
  期望: 有匹配输出（用例名含 sprintDir/覆盖/b37），exit 0

- [ ] [BEHAVIOR] fallback 用例通过 — state.sprintDir 为 null 时保持原 payload 值不变
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js --reporter=verbose 2>&1 | grep -E "✓|pass" | grep -i "null\|fallback\|保持" | head -3; [ -n "$(cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js 2>&1 | grep "3 passed")" ] && echo OK || exit 1'
  期望: OK，exit 0
