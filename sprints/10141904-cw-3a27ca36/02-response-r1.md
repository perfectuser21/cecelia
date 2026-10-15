### R-1
处理: 采纳
说明: `install.sh` 将 `CODING_WF_USER_HOME` 赋给 `USER_HOME`，由此生成 `LOG_FILE`；plist 模板把该路径写入 `StandardOutPath` 和 `StandardErrorPath`。S-1 补充自定义 home 安装参数，S-2 改为从安装时的 home 或已安装 plist 定位主日志，Q-3 增加 `/Volumes/runner-home` 的人工文档对照案例。运维人员能找到实际日志；验证时将案例推导结果 `/Volumes/runner-home/Library/Logs/coding-workflow-runner.log` 与安装器和 plist 模板核对，不执行安装。
