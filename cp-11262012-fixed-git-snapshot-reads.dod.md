# 固定发布来源读取验收

Task: 0295d5e7-6983-4a08-a3f2-0c80c0763148
GP-Anchor: none(infra)

- [x] 同一发布快照的多个定义与并发实现绑定复用已经核验的 Git 对象。顺序与并发模式产生相同发布证明。
  Test: manual:npm test --workspace packages/brain -- src/workflow-authoring/release-proof.test.js
- [x] 新一轮重新读证。文件模式、凭据、取消和逐定义总字节仍按原合同检查。
  Test: manual:npm test --workspace packages/brain -- src/workflow-authoring/release-proof.test.js src/workflow-authoring/fixed-git-source.test.js src/workflow-authoring/freeze.test.js
- [x] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
