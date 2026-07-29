# Red 证据 — 刀6 branch-protect gp_anchor 硬校验

```
bash hooks/tests/branch-protect-gp-anchor.test.sh
FAIL: S1 无gp_anchor行被拦 (期望 exit=2 实际 exit=0)
PASS: S2 none(docs)豁免放行
PASS: S3 合法锚+id存在放行
FAIL: S4 id查无被拦 (期望 exit=2 实际 exit=0)
PASS: S5 map全缺fail-open放行
结果: 3 pass / 2 fail
```

S1/S4 红 = hook 尚无 gp_anchor 拦截逻辑（预期红）；S2/S3/S5 是放行断言，实现前后都应绿。
