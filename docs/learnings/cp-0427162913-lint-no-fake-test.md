## Gate 1 — lint-no-fake-test 拦 AI 写假断言（2026-04-27）

### 根本原因

PR #2670/#2671/#2672 中 implementer subagent 给 executor.js / cortex.js / thalamus.js
添加的 stub test 全是 `expect(handler).toBeDefined()` 零行为断言。
这类测试让 coverage 指标显示 100%，但生产代码行为改坏后完全不报错——"假覆盖"。

根因：既有 lint（lint-test-quality / lint-no-mock-only-test）未覆盖"弱断言占 100%"这一模式。

### 下次预防

- [ ] 新增 test 文件若所有 expect 全是弱断言（toBeDefined/toBeNull/toBeUndefined/toEqual(null|undefined)/not.toThrow），CI lint-no-fake-test job 必须 hard fail
- [ ] vi.mock 数 > 5 且 expect < 3 的"走过场测试"同样被 Rule 2 拦截
- [ ] 7 case 自测脚本（lint-no-fake-test.test.sh）随实现文件一起提交，保持规则可回归
- [ ] 真行为断言示例：`const r = await handler({task}); expect(r.ok).toBe(true); expect(r.dispatched).toBe('agent-x')`
- [ ] brain-unit PR 模式改用 vitest --changed，仅跑受影响测试，加速反馈
