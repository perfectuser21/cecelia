## 预览主机没有发布流程 + plist 明文部署令牌（2026-10-12）

### 根本原因
- MMV 上 preview-agent（launchd plist）与 preview-reaper（crontab）的路径写死在 10-02 手工建的快照 cecelia-preview-releases/fleet-65ab15f4d6（9c5663d39）。仓库里没有任何脚本负责「把预览主机切到新代码」，于是 #6155（闲置回收）、#6320（reaper 台账库）合进 main 后都没到预览主机，僵尸预览占满 6 个名额，新 PR 预览 503 too_many_active。
- preview-agent-install.sh 把环境里的 DEPLOY_TOKEN 原样写进 plist 的 EnvironmentVariables，preview-agent.mjs 又只认环境变量，令牌只能放 plist，常年明文躺在 ~/Library/LaunchAgents。runner 早就改成运行时读 ~/.credentials/cecelia-deploy-token.env，代理没跟上。
- routes/preview.js 的 checkDeployToken 在 process.env.DEPLOY_TOKEN 为空时直接放行（dev 模式）。所以改成读文件时，必须在开始监听前把令牌写回进程环境，否则等于关掉鉴权。

### 下次预防
- [ ] 执行机上常驻的东西（launchd/crontab）必须配一个发布脚本：默认 dry-run，--apply 有备份、验活（health 报 git_sha）、失败自动回滚。「main 上修了」不等于「执行机上生效」，验收要看 health.git_sha
- [ ] 凭据只放 ~/.credentials（600），服务配置里只写文件路径；令牌原文只放不可枚举属性，日志用来源描述，探活用 node 进程内发请求，不进 argv
- [ ] 改鉴权来源前，先确认下游的「缺值」语义：缺值是拒绝还是放行。放行语义下，加载失败必须让进程起不来
- [ ] 清理旧发布快照前确认没被引用：预览 worktree 挂在快照的 .git/worktrees 上，预览依赖 node_modules 软链指向快照
