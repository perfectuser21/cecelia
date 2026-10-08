## Brain {VERSION} — coding workflow spec 生成后自检 02，锚点标题允许带说明文字

- 真实端到端 c2afa8ba：claude 把规格标题写成 `### S-1 <说明>`，spec 活动只查文件存在就 completed，build 解析不到 S-n 报 spec_ids_missing。
- lib/md-chain.mjs 与 lib/evidence.mjs：锚点标题 `### <ID>` 后允许跟说明文字（空白或冒号分隔）；ID 后紧跟字母/数字/连字符仍不算锚点。
- activities/spec.mjs：生成后自检 02（frontmatter、upstream 覆盖全部 I-n、至少一条 S-n），不合格报 retryable spec_invalid（evidence 带 spec_errors），契约 spec 最多 2 次尝试，claude 重写一次。
