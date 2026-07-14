# 小改动 PrepPRD：ZenithJoy staging(5201) LaunchDaemon 迁移固化

## 改什么
1) zenithjoy仓 deploy-lib.sh：ensure_staging_plist() 默认输出路径从 ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist
   改成 /Library/LaunchDaemons/，加 UserName=administrator，写完后 sudo launchctl bootstrap system 装载。
   infrastructure/launchagents/com.zenithjoy.api.staging.plist 模板同步加 UserName，目录挪到 infrastructure/launchdaemons/。
2) cecelia仓（本worktree）packages/brain/src/launchd-patrol.js：MUST_LISTEN_PORTS 加 {port:5201,name:'zenithjoy-api-staging'}。

## 为什么改
现场实测确认 staging 一直放 LaunchAgents（gui/501域本机永不加载），与 prod 502 三天同根因。
deploy-lib.sh 每次重新部署会把 plist 重写回错误路径，不改代码修复撑不到下次部署。

## 关联上下文
- 相关历史决策：2026-07-11 zenithjoy-api-launchd-outage 已根治先例（prod 5200 同款迁移）
- PR#3880（cecelia dev.yml 同类 docker 项目名隔离修复，同session）

## 影响范围
只影响 ZenithJoy staging(5201) 部署路径和 Cecelia 巡检哨兵，不碰生产(5200)逻辑。

## 验收标准（本PR，cecelia侧）
- [ ] launchd-patrol.js MUST_LISTEN_PORTS 加 5201 监控
- [ ] CI 全绿

（zenithjoy仓 deploy-lib.sh 修复另开一次 /dev，在 zenithjoy 仓执行）
