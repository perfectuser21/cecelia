# changes/ — DEFINITION 条目碎片(并行零冲突发版)

## 为什么

多个 PR 并行改 brain 时,过去每个 PR 都要自带版本五件套 bump + 在 DEFINITION.md 同一位置插条目
——每合一个,其他所有 PR 全部冲突,O(n²) 人肉 rebase(09-06 四舰队五连撞案)。

新规:**PR 不碰版本五件套**(packages/brain/package.json、packages/brain/package-lock.json、
根 package-lock.json、.brain-versions、DEFINITION.md 版本行)。
条目写进本目录一个碎片文件——文件名唯一 = 并行永不冲突。
合并后 `auto-version.yml` 调 `packages/brain/scripts/auto-version-apply.mjs` 统一
bump + 把碎片转成 DEFINITION 条目 + 删碎片。

## 怎么写

文件名:`<分支名>.md`(如 `cp-09061601-auto-rebase-bump.md`)。

内容 = 一段 DEFINITION 条目,版本号用 `{VERSION}` 占位(bot 分配真实版本号):

```markdown
## Brain {VERSION} — <一句话标题>

- <条目内容>
```

## 规则

- 一个 PR 一个碎片;多碎片按文件名序各占一个版本号
- 本 README 不算碎片,永不被消费
- 版本号语义(major/minor/patch)由合并 commit 标题的 conventional 前缀决定(feat!/feat/fix);
  chore/docs 合并若携带碎片按 patch 处理
- bot 每次基于最新 main 重算全部碎片,旧的未合并 auto-version-bump-* PR 会被超越式关闭
