# Exempt Fixture — gate-allow 显式豁免单条规则

> 永久回归样本：含一条真命中（file-existence-only）+ 一行 gate-allow 豁免；
> 该规则被豁免（不计 fail），豁免留痕在输出里；无其他命中故整体 exit 0。

gate-allow: weak-oracle/file-existence-only 产物是二进制视频文件，存在性即足够（人工确认理由）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 产物文件已生成
  Test: manual:bash -c 'test -f /tmp/out.mp4'
