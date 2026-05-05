# Learning — Stop Hook 注册为正式 feature（2026-05-05）

分支：cp-0505164349-stop-hook-feature-register
版本：Engine 18.22.1 → 18.22.2
本 PR：第 14 段（feature 文档化）

## 故障

Alex 自审："stop hook 应该算个 feature，应该 register 进 feature-registry，但我们没有"。

实际确认：
- `packages/engine/feature-registry.yml` 只有 `changelog:` 段
- 13 段闭环 + 14 个 invariant + 70+ 测试 + Notion contract — 这么大体量的 feature 没作为整体被 registry 记录
- 每次改动追加一条 changelog 是"碎片化历史"，缺一份"feature 全景 entry"

## 根本原因

历史上 feature-registry.yml 设计是"每次改动追加 changelog"模式（v1.0.0），没考虑"完整 feature 注册"维度。memory 提到 v14 计划过 system-registry 两层结构 + features/xxx.yml 但没落地。

## 本次解法

feature-registry.yml `version` bump 1.0.0 → 1.1.0，加 `features:` 段。第一个 feature 注册：

```yaml
features:
  - id: stop-hook
    name: Stop Hook（/dev 流程守门）
    status: stable
    since: "2026-04-21"
    description: ...
    entry_points: [stop-dev.sh, dev-mode-tool-guard.sh]
    key_files: [5 个核心文件]
    state_files: [.cecelia/dev-active 等]
    contract_url: https://notion.so/...
    invariants_count: 17
    state_machine.stages: [P1-P7 + P0]
    test_coverage: {unit: 32, integration: 32, smoke: 21, e2e: 12, integrity: 18}
    closure_segments: [14 段 PR 链接]
    deprecated_invariants: [4 条已被新架构替代的]
```

integrity L18 grep 验证 `id: stop-hook` + `name: Stop Hook` + `contract_url:.*notion` 三项。

## 下次预防

- [ ] 任何稳定 feature（≥ 3 段闭环 / ≥ 10 测试 / 有 contract）必须加到 features: 段，不只 changelog
- [ ] integrity 元测试 grep 验证关键 feature 注册存在
- [ ] feature entry 必须含 contract_url（Notion / repo md）+ closure_segments（PR 链接）+ state_machine（如有）

## 验证证据

- features 段含 stop-hook entry（含 13 段闭环 + 14 invariant + Notion contract）
- integrity 19 case 全过（L18 验证 feature 注册）
- engine 8 处版本 18.22.2

## 顺手发现的老 bug（不修，留下个 PR）

`feature-registry.yml` 老 changelog 段含 `\${VAR}` 字符串（line 283 等），yaml parser 报 "unknown escape character"。下游 lint 用 grep 没抓到。下个 PR 用单引号 `'...'` 包字符串避 yaml escape，或 sed 修 `\${` → `${`。

## Stop Hook 完整闭环（14 段）

| 段 | PR | 内容 |
|---|---|---|
| 1-12 | #2503-#2777 | cwd-as-key + Ralph Loop + 7 阶段 + 4 P0 |
| 13 | #2779 | 4 P1 修 |
| **14** | **本 PR** | **feature 注册（feature-registry features 段）** |

stop hook 这条线上 14 段闭环 + feature 文档化全部完成。
