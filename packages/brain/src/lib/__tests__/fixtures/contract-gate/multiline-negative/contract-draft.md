# Multiline-Negative Fixture — 反斜杠续行的负向测试（#3351 逻辑行模式回归）

> 永久回归样本：负向测试惯用法 `cmd && { echo FAIL; exit N; } || true` 跨反斜杠续行。
> 逻辑行归一后 isNegativeFailAssertion 仍正确识别整段为负向结构（预期失败的合法承接），
> 不应误报 cheat/or-true。验证 #3351 的负向豁免在多行场景依然生效。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] gate 缺合同时应 fail-closed（exit 非 0），负向验证它确实非零退出
  Test:
```bash
node scripts/contract-gate-check.mjs "$TMPDIR" 2>/dev/null \
  && { echo "FAIL: 缺合同应 exit 1 但 exit 0"; rm -rf "$TMPDIR"; exit 1; } \
  || true
```
