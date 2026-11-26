# 清退旧 KR/OKR 自动链并补齐发布排空诊断

Task: b556cbb4-4062-4297-8b7c-a6d66c5c8320
GP-Anchor: none(infra)

- [x] 退出旧 KR/OKR 专属脚本与专项测试，保留正式 KR API、对象同步与实际 Ops 收集入口。
  Test: manual:node --test scripts/ci/__tests__/basic-integration-once.test.mjs
- [x] 排空客户端只记录验证后的白名单证据，保留现行协议、身份校验、等待预算与取消行为。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-drain-evidence.test.mjs
- [ ] 集成源码通过完整 Scripts/Ops 与独立 review，正常 PR 严格 CI 合并。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts && node scripts/ci/run-basic-check.mjs ops
- [ ] 后继实际 main CD、native 发布与生产 Node22 验收由 Root 读回，源码合并不能代替生产成功。
  Test: manual:curl --fail http://localhost:5221/api/brain/health && gh run view --log --repo perfectuser21/cecelia
