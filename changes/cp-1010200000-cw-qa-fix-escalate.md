## Brain {VERSION} — coding harness：QA 修复没推上去立刻升级，不再静默挂住

- 金丝雀 3（PR #6220）实测：裁判判 product_failure 后，修复会话删掉了 PR 自己加的超范围测试，被「不许削弱测试」守卫拦下（test_weakened），没有推送。head 不变，下一轮 QA 门按「同 head 已验过」直接跳过，也不升级，PR 静默挂住，违反旧 harness「修复失败必须终局上报」。
- QA FAIL 和裁判 product_failure 两条修复路径：结果不是 pushed（test_weakened、no_commit、claude_failed 等）就立刻升级 qa_fix_failed（P1 + Brain escalations），带上原因与轮次，交 coding commander 裁决。
