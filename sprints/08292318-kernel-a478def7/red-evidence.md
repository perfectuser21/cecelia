# Red 证据 — r73 合同重开纪元派全新 generator

冻结合同测试 `sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js`
在实现前（derive.js 未改）对未修改基线运行结果：

```
 FAIL  B-01 重开后新合同批准 + no_pr → spawn:generator
   AssertionError: expected 'spawn:generator-fix' to be 'spawn:generator'
 FAIL  B-04 纪元隔离：重开纪元起点之前的 spawn:generator 不算「重开后已派」
   AssertionError: expected 'spawn:generator-fix' to be 'spawn:generator'
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

- B-02（有界回落 fix）、B-03（无 reopen 仍 fix）实现前已绿——现行 no_pr → spawn:generator-fix 语义。
- B-01 / B-04 红：现状把合同重开纪元内的 no_pr 误路由到 generator-fix（复撞 WORKSPACE_RESOLUTION_FAILED）。
- 永久回归副本 `tests/gp/f1/step3-contract-reopen-fresh-generator.test.js` 同源同断言，实现前同样红。
