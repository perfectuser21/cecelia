### 根本原因

R64 harness_fix 任务派发时无对应 eval-round-64.md FAIL 文件。功能（active_pipelines 字段）已在 PR #2282 正确实现，三项合同验证全部 PASS，无需代码修改。

psql `-t -A` 返回值含换行符导致 DELETE WHERE id='$TEMP_ID' UUID 解析失败，需用 `tr -d '\n'` 或手动清理。

### 下次预防

- [ ] psql RETURNING id 结果赋值时加 `| tr -d '[:space:]'` 去除换行/空白
- [ ] harness_fix 任务若无 eval-round-N.md 文件且最近多轮均 PASS，直接验证合同三测试后提 PR 即可
