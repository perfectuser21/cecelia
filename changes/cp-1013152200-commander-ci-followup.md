## Brain {VERSION} — CI 固定历史与 staging 宿主路径

- DoD 动态审计获取完整 Git 历史；原 handler 清单按真实源码位置校正，固定基线审计与零新增名单守卫继续生效。
- staging 凭据文件默认遵循 HOST_HOME/HOME，显式覆盖优先；Linux/Mac 实际 shell 路径回归不读写真实凭据。
