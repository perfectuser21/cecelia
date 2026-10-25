### 1.445.63

固定main快照发布器使用独立运输Agent，将headers/body期限对齐既有600秒总signal，避免冷刷新在300秒提前失败。保留原CAS、固定main、digest、双scope验证与请求次数；失败直接销毁连接，成功清理失败也不发布正式产物。
