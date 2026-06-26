# Learning: harness 独立 release 阶段（staging → release → deploy，产物库当唯一源）

## 背景
主理人指出：staging 验过后应该有一个独立的 release 阶段（冻结+打 tag），再部署到 production。现状 `promote-dashboard.sh` 是"先 deploy 到 5211 → 再顺手打 tag"一锅烩，新版本产物甚至没进 `.dist-releases/`（只有被顶下来的旧版才进库），没有显式 release 阶段。

## 修法
`promote-dashboard.sh` 拆三模式：
- `--release-only`：冻结验过的 staging 产物 → `.dist-releases/<vX>`（不可变）+ 打 git tag vX + 写 manifest，**不动 live/current/brain**。
- `--deploy <vX>`：从 `.dist-releases/<vX>` 原子 cp 换入 live 5211 + 旧版留存 + 写 current + brain-deploy。
- 无参=full=release-only 取 tag → deploy（向后兼容）。

**关键洞察**：`.dist-releases/<tag>` 成为唯一真相源——deploy 与 rollback 都是 `cp .dist-releases/<tag> → live`，对称。release 阶段把验过的产物喂进库，deploy 和 rollback 都从库取。当前线上版本永远在库里（旧实现新版本反而没进库，是隐患，顺手修了）。回档网（rollback-cecelia.sh）零改动——它本来就从 `.dist-releases/<tag>` + manifest 取。

## 下次预防（踩到的坑）
- **bash `set -u` + `$VAR` 紧贴全角字符**：`$RELEASE_TAG（` / `$tag，` / `$MODE）` 会让 nounset 把全角字节误当变量名 → `unbound variable`。**凡 `$VAR` 后面紧跟中文/全角标点，必须 `${VAR}` 界定**。grep 自查：`grep -nP '\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F\}]' file`。
- 改 promote/rollback 这类回档关键路径，必须先跑 `deploy-rollback.test.sh` 证明回档网不破（绿=安全）。CI 自动跑 `packages/engine/tests/integration/*.test.sh`，新行为加一个同目录 .test.sh 即被收。

## checklist
- [ ] release 与 deploy 分离：release 不动 live/current，deploy 从库换入
- [ ] 产物库 .dist-releases/<tag> 是 deploy 与 rollback 的共同源（对称）
- [ ] bash 里 `$VAR` 紧贴全角字符一律 `${VAR}`（set -u 防坑）
- [ ] 改回档路径必跑 deploy-rollback.test.sh 验证不破
