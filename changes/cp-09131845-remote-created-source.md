## Brain {VERSION} — 远程 kernel 派发 createdSource 白名单修复

- fix(brain): _spawnKernelRuntimeRemote 的 createdSource 从不在白名单的 kernel_dispatch_remote 改用既有枚举 kernel_dispatch（铁律 76cb816c 不扩枚举）；此前 createKernelRun 抛 invalid created source 致 dispatch_fail_autoblock 把远程任务打 blocked
