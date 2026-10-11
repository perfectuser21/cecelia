## 同版本号不同 SHA 重建时保留旧镜像 tag（2026-10-12）

### 根本原因
auto-version bump 之前的合并提交和上一次 bump 提交版本号相同，`brain-build.sh` 却按版本号无条件打 `cecelia-brain:${VERSION}` 与 `latest`，把旧镜像的 tag 全部抢走。旧镜像失去身份：容器一换走就是 dangling，被同一脚本末尾的 `docker image prune --filter dangling=true` 删掉，回滚目标丢失；a80485b3 部署中途死亡时容器还跑在旧镜像上，ledger 的 recovered 核验要看版本 tag，只能人工把 1.417.0/latest 挪回旧镜像（决策 a9add058）。版本号不是镜像身份，GIT_SHA/镜像 id 才是。

### 下次预防
- [ ] 按"可变名字"（版本号、latest）打 tag 前先看名字当前指向谁，身份不同就给旧对象留一个能活下来的名字
- [ ] 给镜像加保活/别名 tag 前先查清清理方怎么删：janitor 按镜像 id 删除，同仓库多 tag 时 docker 拒删（实测 `referenced in multiple repositories`），所以别名必须在镜像被顶替时收敛回单 tag，且 janitor 要认新的单 tag 形态，否则"保活"变"永久泄漏"
- [ ] 部署脚本测试用假 docker（文件模拟 tag→id）+ 本地 bare 仓库驱动真脚本；临时仓库 commit/push 要带 `-c core.hooksPath=/dev/null`，否则全局 pre-commit 钩子以 main 分支为由拦截
