# feature-registry contract_url 迁移到 ZenithJoy（2026-05-05）

## 任务

`packages/engine/feature-registry.yml` `features.stop-hook.contract_url` 从月升 workspace page (`35753f41`) 切换到 ZenithJoy 新 SSOT page (`357c40c2-ba63-81b8`)。

### 根本原因

PR #2780 把 stop-hook 注册为正式 feature 时，ZenithJoy workspace 还没建对应 contract page，临时用了月升 workspace 的半年史 page 作为 `contract_url`。月升后续 frozen，新 SSOT 必须指向 ZenithJoy 才合规。

本质：feature 注册 + Notion contract page 创建是两个并行动作，时序导致首次注册时只有月升 page 可指。

## 修法

1. ZenithJoy `cecelia` page 下创建简洁版 Stop Hook Contract page（含 18 invariant + 测试 + 14 闭环段）
2. 月升 page 顶部加 `FROZEN — 已迁移到 ZenithJoy` 标记，保留作为历史快照
3. `feature-registry.yml` `contract_url` 切到 ZenithJoy URL，新增 `contract_url_legacy` 字段保留月升指针
4. integrity L18 grep 加 ZenithJoy page id token (`357c40c2[-]?ba63[-]?81b8`) 守门
5. engine 8 处版本 bump 18.22.2 → 18.22.3 (patch — doc-only)

### 下次预防

- [ ] feature-registry 新增 feature entry 时，必须确认 `contract_url` 指向**当前活跃 workspace** 的 page，不要临时用旧 workspace 的指针
- [ ] integrity grep 应该 grep **具体 page id token**（区分新旧），不要只 grep `contract_url:.*notion`（任何 notion URL 都过）
- [ ] Notion workspace 迁移时，先在新 workspace 建对应 page → 再改 repo 引用 → 最后给旧 page 加 frozen 标记（顺序很重要，否则 SSOT 短暂指空）
- [ ] grep page id 时考虑两种格式（含/不含连字符）— Notion URL 中 page id 无连字符，repo grep token 加 `[-]?` 兼容

## 引用

- ZenithJoy contract: https://www.notion.so/Stop-Hook-Contract-v18-22-2-357c40c2ba6381b893c7e251707d1252
- 月升 frozen: https://www.notion.so/35753f413ec581d9b607f61e4e90ce0b
- PR #2780: stop-hook 首次注册到 feature-registry
