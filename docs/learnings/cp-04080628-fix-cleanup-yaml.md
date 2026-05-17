# Learning: cleanup-merged-artifacts.yml YAML 块标量缩进陷阱

**分支**: cp-04080628-abc1d1bd-2365-4d3c-ac8b-6bb545  
**日期**: 2026-04-08  
**影响**: cleanup workflow 100% 失败（18/18），CI 绿灯率损失约 36%

---

### 根本原因

`cleanup-merged-artifacts.yml` 中 `run: |` 块内的 `git commit -m` 多行消息，其第 2-3 行（中文说明）从**第 0 列**开始，而非 10 列缩进。

YAML 块标量（block scalar）规则：所有内容行必须保持不低于首行缩进级别。零缩进行会**提前结束块标量**，导致后续内容被解析为顶层 YAML，产生语法错误。

GitHub Actions 的表现：
- 无法解析 workflow 文件 → 0 个 job 启动 → "workflow file issue"
- GitHub 对所有分支的推送做 workflow 验证，触发到 cp-* 分支
- 每次 push 都记录一个 failure 运行，严重拖低 CI 绿灯率

### 下次预防

- [ ] 在 `run: |` 块内不要使用多行 git commit -m 消息（多行内容中若有空行或零缩进行，YAML 无法正确解析）
- [ ] 多行 commit 消息改用 bash 变量：`MSG=$(printf "...\n...\n")；git commit -m "$MSG"`
- [ ] `${{ steps.xxx.outputs.yyy }}` 表达式不要内嵌在 run 块的 bash 字符串中——改用 `env:` 字段传递，bash 内用 `$VAR` 访问
- [ ] 新建/修改 workflow 文件后，用 `python3 -c "import yaml; yaml.safe_load(open('xxx.yml'))"` 本地验证 YAML 语法
- [ ] workflow 文件提交后，立即检查 GitHub Actions 是否有 0 jobs 的失败运行（"workflow file issue" 信号）
