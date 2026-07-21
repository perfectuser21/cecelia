# 设计：branch-naming CI 门禁给 dependabot/** 分支加白名单

## 背景

`.github/workflows/ci.yml` 的 `branch-naming` job 只放行两类分支：`main/master/develop/staging/release` 基础分支，以及 `^cp-[0-9]{8,10}-[a-z0-9-]+$`（`/dev` 工作流产出的分支）。Dependabot 自动开 PR 用的分支名固定是 `dependabot/npm_and_yarn/xxx`，不在白名单内，必然被拒，进而拖垮 `ci-passed` 总闸。实测两例：PR #4142（axios 升级）、PR #4145（vitest coverage-v8 升级）均卡在这一步。这是结构性问题——只要仓库启用 Dependabot，它产出的每个 PR 都会必然撞上这道闸，无法进入正常评审流程。已记 Notion issue `5d75cdf5-54f8-4a1e-8737-cea34035d657`。

## 目标

让 Dependabot PR 能通过 `branch-naming` 这一关，同时不改变其他任何 CI job 的判断逻辑——依赖冲突、测试失败等真实问题依旧会正常拦截合并，只是不再被"分支名格式"这个和代码正确性无关的检查误伤。

## 方案

当前判断逻辑直接写死在 `ci.yml` 的 `run:` 脚本块里，没法单独跑单测。抽取为独立脚本 `scripts/ci/check-branch-naming.sh`，接收分支名作为第一个参数，逻辑：

1. 匹配 `^(main|master|develop|staging|release)$` → exit 0
2. 匹配 `^dependabot/`（新增）→ exit 0
3. 匹配 `^cp-[0-9]{8,10}-[a-z0-9-]+$` → exit 0
4. 否则 → exit 1，打印现有的错误提示

`ci.yml` 的 `branch-naming` job 步骤改为：
```yaml
- name: 检查分支命名规范
  run: bash scripts/ci/check-branch-naming.sh "${{ github.head_ref }}"
```

考虑过的替代方案：直接在 `ci.yml` 内联加一行 `grep -qE '^dependabot/'` 判断，不抽脚本。放弃原因：内联逻辑没法被 CI 里的 regression test 覆盖到（workflow YAML 本身不会被单测执行），未来这条判断再出错只能靠人工盯 Actions 日志发现，不符合仓库"哨兵必须 proven-to-fire"的规矩。抽脚本这一步是让这条逻辑本身可测的必要前提，不是过度设计。

## 测试

新增 `packages/engine/tests/unit/check-branch-naming.test.sh`，纯 bash，对以下分支名分别断言 pass/fail：
- pass：`main`、`cp-07211200-fix-something`、`dependabot/npm_and_yarn/axios-1.18.0`、`dependabot/npm_and_yarn/packages/engine/多包组名`
- fail：`random-feature-branch`、`feature/something`

挂点：`ci.yml` 的 `engine-tests-shell` job（v23 PR-3 起）自动 glob `packages/engine/tests/unit/*.test.sh`，新文件放进这个目录即自动接入 CI，不需要改 `ci.yml` 的 job 定义本身。

TDD 顺序：
- commit-1：抽取脚本（保持旧行为，不含 dependabot 白名单）+ 新增测试（含 dependabot 分支断言 pass）→ 测试对 dependabot 用例 FAIL，验证测试本身有效
- commit-2：脚本加 `^dependabot/` 白名单分支 → 测试全 PASS

## 影响范围

仅 CI 配置层面，不涉及生产代码/运行时逻辑。不改变 `cp-*`/基础分支的既有判断行为。其他所有 CI job（测试、lint、依赖审计）对 Dependabot PR 依旧照常运行，不做任何豁免。
