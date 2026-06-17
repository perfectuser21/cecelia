# Comment-Or-True Fixture — 注释行不应参与作弊扫描（缺陷 A）

> 永久回归样本（生产 run da418741，ci-defense-r2 合同）：
> 纯注释行（首个非空白字符为 `#`）里出现 `|| true` 等字样，只是写给人看的说明，
> 不是验收脚本 → gate 不应对它跑 cheat/weak-oracle 规则。
> 真正的验收脚本（负向测试 + grep 断言）干净 → 整体应 ok=true。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 缺合同时 gate 应非零退出（负向测试 + 注释说明）
  Test: 见下方验收脚本

```bash
# 校验 contract gate 对预期失败命令的处理
node scripts/contract-gate-check.mjs "$TMPDIR" 2>/dev/null && { echo "FAIL: 缺合同应 exit 1"; exit 1; } || true
# 必须非零退出（上面 || true 是因为要捕获 log；用 echo 验返回）
echo "$RESULT" | grep -q "missing contract"
```
