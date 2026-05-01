## ZenithJoy Feature Registry — 87 features + 多轮 CI 修复（2026-05-01）

### 根本原因

1. **SQL 引号语法**：Python 正则 `re.sub` 给 smoke_cmd 加 `|| true` 时生成 `''' || true'`（三引号），SQL 字符串提前关闭，`|| true` 跑到 SQL 表达式空间。Migration 无法执行。

2. **Bash 数组语法**：`all-features-smoke.sh` 用了 `${#FAILED_IDS[@]:-0}` — 数组长度不支持默认值写法，是 bash 无效语法。应用 `${#FAILED_IDS[@]}`。

3. **Migration 编号冲突**：main 合入 `251_fix_intent_parse_smoke_cmd.sql` 后，PR 的 `251_zenithjoy_publisher_features.sql` 被 migration runner 跳过（按前缀数字判断已应用）。

4. **nas-backup smoke_cmd 端点错误**：`/api/brain/status` 无 `.status` 字段，用 `/api/brain/health` 的 `.status == "healthy"` 才正确。另外 migration 254（UPDATE）排在 migration 255（INSERT）之前导致更新空表无效，改为 258 放在 255 之后。

### 下次预防

- [ ] 修改 SQL 中的 smoke_cmd 时，**禁止用正则**。用 Python `str.replace()` 精确 literal 替换，替换前后用 `psql -f <BEGIN/ROLLBACK 包裹>` 语法验证
- [ ] SQL migration 写完后必须跑 dry-run：`(echo "BEGIN;"; cat file.sql; echo "ROLLBACK;") | psql -d cecelia -f -`
- [ ] `all-features-smoke.sh` 的 bash 语法修改后，本地用 `bash -n` 校验：`bash -n packages/brain/scripts/smoke/all-features-smoke.sh`
- [ ] 新 migration 编号前先 `ls migrations/ | grep "^<N>_"` 确认无冲突，尤其是 rebase/merge 后
- [ ] UPDATE migration 必须检查目标行是否存在：如果 INSERT 在后，UPDATE 需要放在 INSERT 之后（更高的编号）
