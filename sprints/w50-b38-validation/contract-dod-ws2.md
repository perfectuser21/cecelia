---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: b35/b36/b37 同步添加 @langchain/langgraph mock

**范围**: 修改 `harness-initiative-b35.test.js`、`harness-initiative-b36.test.js`、`harness-initiative-b37.test.js`
**大小**: S(<60行净增，3文件)
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] harness-initiative-b35.test.js 包含 vi.mock('@langchain/langgraph', ...) 块
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js','utf8');if(!c.includes(\"vi.mock('@langchain/langgraph'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] harness-initiative-b36.test.js 包含 vi.mock('@langchain/langgraph', ...) 块
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/workflows/__tests__/harness-initiative-b36.test.js','utf8');if(!c.includes(\"vi.mock('@langchain/langgraph'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] harness-initiative-b37.test.js 包含 vi.mock('@langchain/langgraph', ...) 块
  Test: node -e "const c=require('fs').readFileSync('/workspace/packages/brain/src/workflows/__tests__/harness-initiative-b37.test.js','utf8');if(!c.includes(\"vi.mock('@langchain/langgraph'\"))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] harness-initiative-b35.test.js vitest 解析无 ERR_MODULE_NOT_FOUND
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b35.test.js 2>&1 | tee /tmp/b35-dod.log; grep -c "ERR_MODULE_NOT_FOUND" /tmp/b35-dod.log && exit 1 || echo OK'
  期望: exit 0，无 ERR_MODULE_NOT_FOUND

- [ ] [BEHAVIOR] harness-initiative-b36.test.js vitest 解析无 ERR_MODULE_NOT_FOUND
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b36.test.js 2>&1 | tee /tmp/b36-dod.log; grep -c "ERR_MODULE_NOT_FOUND" /tmp/b36-dod.log && exit 1 || echo OK'
  期望: exit 0，无 ERR_MODULE_NOT_FOUND

- [ ] [BEHAVIOR] harness-initiative-b37.test.js vitest 解析无 ERR_MODULE_NOT_FOUND
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b37.test.js 2>&1 | tee /tmp/b37-dod.log; grep -c "ERR_MODULE_NOT_FOUND" /tmp/b37-dod.log && exit 1 || echo OK'
  期望: exit 0，无 ERR_MODULE_NOT_FOUND

- [ ] [BEHAVIOR] b35/b36/b37 批量运行全部通过（无解析错误）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b35.test.js src/workflows/__tests__/harness-initiative-b36.test.js src/workflows/__tests__/harness-initiative-b37.test.js 2>&1 | grep -c "ERR_MODULE_NOT_FOUND" && exit 1 || echo OK'
  期望: exit 0
