## coding QA 门认 commander 对 CANNOT_VERIFY 的前裁（2026-10-11）

### 根本原因
金丝雀 6 #6291：第 1 轮 QA 对 T-2（Q-2，预览环境没配 token 测不到 401）报 CANNOT_VERIFY，commander 裁「维持规格」并补单测兜底；第 2 轮 QA 照规格又报同一项 CANNOT_VERIFY，QA 门不看前裁直接再升级，会循环到 commander 介入上限上交人。

### 下次预防
- [ ] 升级类型被 commander 裁过后，触发它的门要能读裁决（commander-<pr>.json），不能只靠 commander 每次重裁
- [ ] 测试里 `fs.mkdirSync(..., {recursive:true}) ?? 下一步` 是坑：mkdirSync 新建目录时返回路径字符串，?? 短路，下一步不执行
