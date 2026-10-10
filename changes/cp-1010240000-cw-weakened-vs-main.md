## Brain {VERSION} — coding harness：削弱测试守卫只守 main 上已有的测试

- 主理人决策 b057089b。金丝雀 3、4 都卡在同一处：独立裁判判 PR 超范围，修复会话按裁决删掉超范围代码，连带删了 PR 自己为它加的测试，被「不许削弱测试」拦下（test_weakened），合不进。
- weakenedTests 改为对照与 origin/main 的合并基点（先拉最新 main）：只对基点上已存在的测试文件判删除、加 skip/only/todo、断言比 main 上的版本少。PR 自己新加的测试允许在修复时随代码改删，行为仍由真人 QA 加独立裁判兜底。取不到合并基点时退回对照修复前的 head（从严）。
- 测试：CI 修复和 QA 门的测试夹具把被守护的测试放到 main 上，新增「删 PR 自加测试照常推送」用例。
