# PRD: CI 硬化第三批 — ESLint --max-warnings 冻结基线

## 背景

Repo-audit 发现 `ci.yml:83 / 86` 两处 ESLint 命令没有 `--max-warnings`，默认 Infinity，warnings 可无限累积。实测：

- **Brain**：244 warnings（0 errors）
- **apps/api**：18 warnings（0 errors）

后果：每个 PR 都可以悄悄加新 warning，没人拦，技术债随时间单调上涨。

## 成功标准

1. `ci.yml:83` brain lint 加 `--max-warnings 244`
2. `ci.yml:86` workspace lint 加 `--max-warnings 18`
3. 当前基线严格匹配：244 / 18
4. 注释说明"只允许下调，不允许上调"的运维规则

## 非目标（YAGNI）

- 不主动修现有 244/18 个 warning（那是独立清理工作，工作量大）
- 不加 `--max-warnings 0`（太严，当前会红一片）
- 不改 ESLint 规则本身
- 不改 `changes` detector 触发条件（继续只在 brain/workspace 变更时跑）

## 下调基线的操作流程

后续任何 PR 如果修了 warning：

1. 本地跑 `cd packages/brain && npx eslint src/ 2>&1 | tail -1` 得到新数字 N
2. PR 里把 `--max-warnings 244` 改成 `--max-warnings N`
3. PR 描述写"warnings 基线从 244 → N"

CI 永远以 ci.yml 里的数字为准；数字只能越改越小。

## 当前 PR 不会触发 ESLint job 的风险

eslint job 现在只在 `brain` 或 `workspace` 变更时触发。本 PR 只改 `.github/workflows/ci.yml`，所以 eslint job 在本 PR **会被 skip**。这是已知事实，不会影响后续 brain/workspace PR 的防护 —— 下次有人改 brain 代码时，CI 会用新的 `--max-warnings 244` 基线验证。

ARTIFACT 层验证通过"ci.yml 含 `--max-warnings 244/18`"的静态检查来保证这次改动真落地。
