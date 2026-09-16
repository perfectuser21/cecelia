## Brain {VERSION} — 触达线活性告警 + memlog 观测线修复

- 守卫加第五腿：读 xian-m4 outreach.log 判活性，连续空转（话术缺失/发送失败且无出单）→ P1 告警（3h debounce）。09-15 话术全「停用」致 22 小时零触达无人知晓
- 修 memlog：docker top 缺 pid 字段被 daemon 拒绝，泄漏甄别观测线一直空跑
