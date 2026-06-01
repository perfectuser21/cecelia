## harness bridge guard bypass 补强行为回归测试（2026-06-01）

### 根本原因

PR #3222 修复了 dispatcher 误拦 harness_initiative 的 bug，但配套的回归测试只做了静态代码字符串匹配（grep needsBridgeCheck），无法真正验证行为——即使逻辑被改坏（所有任务都检查 bridge），静态测试仍会通过。弱测试给人"有覆盖"的假象。

### 下次预防

- [ ] 回归测试必须验证行为而非源码字符串：mock 依赖 + 调用真实函数 + 断言输出
- [ ] 写完回归测试后，必须临时还原 bug（去掉修复）确认测试会失败，证明它真能抓住回归
- [ ] grep 源码内容的测试只能作为 [ARTIFACT] 辅助，不能作为 [BEHAVIOR] 唯一证据
