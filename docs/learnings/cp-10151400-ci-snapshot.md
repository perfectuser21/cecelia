## 固定 main 快照发布与提供方身份（2026-10-15）

### 根本原因

HTTP 失败输出被 shell 重定向到正式 head.json，随后 always 上传，把 CAS 冲突错误体伪装成固定 SHA 快照。父 scope 的 verified 不能代表 admission companion 来源完整；只刷新父 scope 会长期留下 factory 缺口。
新下载步骤使用固定 base 工具，不能假设 base 已有本 PR 新增的 helper。提供方资格取 snapshot-main job 成功，整个 main run 的后续 gate 失败不能否定已经成功发布的独立证据。

### 下次预防

- [x] snapshotpublication HTTP 错误只进独立诊断目录，正式产物须精确身份、摘要和所需 scope 完整核验后原子发布，正式上传只在成功时执行。
- [x] snapshotcas 只复用 main 未漂移且精确 SHA 来源已完整核验的并发赢家，未知冲突与 MAIN_MOVED 保持失败；不放宽中央 CAS、不拿 latest 补历史。
- [x] snapshotbootstrap 真实执行 provider HTTP 与 consumer 下载 shell，并验证固定旧 base 不含新 helper 时仍可工作；提供方 job 成功和 SHA、仓库、分支、run 来源必须分别校验。
