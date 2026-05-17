# ci-eslint-freeze（2026-04-19）

### 根本原因

`ci.yml:83 / 86` 两处 eslint 命令从未加 `--max-warnings`，默认 Infinity，warnings 可无限累积：brain 累到 244、apps/api 累到 18。每一个 PR 都能悄悄加一条，CI 永远绿，没人知道。

这是 repo-audit 命中的 `lint_too_lenient` 反模式的本源。

### 下次预防

- [ ] 任何新加的 lint / typecheck / format 类命令，默认加"最严"标志（`--max-warnings 0` / `--strict` / `--check`）；如果当前代码过不去，加"冻结基线"数字而不是裸跑
- [ ] 基线数字改动规则：**只降不升**。任何 PR 想上调基线，必须在 PR 描述里解释"为什么这批 warning 允许保留"，让 reviewer 挑战
- [ ] 每月 repo-audit 时检查基线数字是否有人偷偷上调，确认只降不升
- [ ] Brain 244 个 warning 里大多是 `no-unused-vars`，后续可以用自动化工具（`eslint --fix` 或脚本批量加 `_` 前缀）一次性大降基线
