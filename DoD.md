# 完整快照低压缩验收

Task: f2b022ae-61b4-402a-8c93-093ba6828b4f
GP-Anchor: none(infra)

- [ ] 真实导出 shell 使用低压缩完整快照，凭据只进环境，归档 stdout 不受日志污染；先红后绿。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-candidate-host.test.mjs
- [ ] 导出或恢复失败继续拒绝准入；完整 Scripts/Ops 回归通过，workflow/job 数量不变。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] 同快照完整传输恢复对比验证数据/约束/索引一致；独立审查后显式续证，PR/main CI/CD 和生产同 SHA 读回。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
