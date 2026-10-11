## Brain {VERSION} — 同版本号不同 SHA 重建时保留旧镜像 tag（修旧镜像丢 tag 被 prune、recovered 结算无据）

任务 B4（根因单 e2fc7076 / d1ec834d，事故 a80485b3，方案 A 已定）。auto-version bump 前的合并提交与上一次 bump 提交版本号相同（09167e2 与 86b5389 同为 1.417.0），`brain-build.sh` 无条件把 `cecelia-brain:${VERSION}` 与 `latest` 打到新镜像上，旧镜像丢光 tag：容器一换走就成 dangling 被构建末尾 prune 删掉；部署中途死亡时只能人工把 tag 挪回旧镜像才能结算 recovered（决策 a9add058）。

- `scripts/brain-build.sh`：构建前检测 `cecelia-brain:${VERSION}` 已指向 GIT_SHA 不同的镜像时，旧镜像补 `cecelia-brain:prev-${VERSION}-${oldsha12}` 保活，新镜像额外打 `cecelia-brain:${VERSION}-${sha12}`；同 SHA 重建、无旧镜像、换新版本时行为不变。构建后收敛：被顶替的镜像摘掉 `${VERSION}-${sha12}` 别名，只留一个 tag。
- `scripts/brain-image-retention/policy.mjs`：janitor 候选除单一版本 tag 外，也认单一 `prev-${VERSION}-${sha12}` tag，保活镜像过回滚保护期后照常按容量回收（同仓库多 tag 镜像 docker 拒绝按 id 删除，所以必须收敛成单 tag）。
