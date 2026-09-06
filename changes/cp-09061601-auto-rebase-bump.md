## Brain {VERSION} — 版本发布碎片化(并行血管 P3)

- PR 不再自带版本五件套 bump;DEFINITION 条目写 `changes/<分支>.md` 碎片({VERSION} 占位),并行零冲突
- auto-version bot 合并后统一应用:新增 `packages/brain/scripts/auto-version-apply.mjs`(五件套+根 lock workspace 条目同步+碎片消费),超越式关闭过时 bot PR
- 根因案卷:09-06 四舰队版本五连撞(O(n²) 人肉 rebase);根 lock 失同步 npm10 edgesOut 案回归防线并入
