# DoD

- [x] [BEHAVIOR] 旧 CI 来源保持有效，完整未来 typed CI 来源与实际注册调用链可证明，任一成员篡改拒绝并清空绑定。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/existing-ops-source-impact.test.js src/lib/__tests__/existing-ops-workspace-source.test.js
- [x] [BEHAVIOR] 未来夹具只读固定 Git 数据，摘要变化及不存在路径拒绝，既有八项 Git 合同保留。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [x] [BEHAVIOR] 现行旧 snapshot 与新来源模块仅按完整只读 cohort 接受，历史版本保留，混搭拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
- [x] [BEHAVIOR] 旧 CI 与 Impact 工作流字节保持受保护 A 原件，未提前切换运行门禁。
  Test: manual:node --input-type=module -e "import{readFileSync as r}from'node:fs';import{createHash as h}from'node:crypto';import{strict as a}from'node:assert';for(const[p,s]of[['ci.yml','91eb26e207d3f15cf810fe1dec4e9137d0f31d1c8004f7938ded7cb7112335e2'],['implementation-impact.yml','4e59206bd6dd08b77ea3a59e0feb44a2371ffc0fa9139b81f67e64a0169a9cf9']])a.equal(h('sha256').update(r('.github/workflows/'+p)).digest('hex'),s)"
