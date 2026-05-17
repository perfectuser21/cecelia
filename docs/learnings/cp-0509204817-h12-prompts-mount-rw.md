# Learning: H12 — cecelia-prompts mount ro→rw

**PR**: cp-0509204817-h12-prompts-mount-rw
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-2

## 现象

W8 v13（task 5b2d5c21）11 nodes terminal_fail：sub_task generator 容器 spawn 真起（H11 修对了），但 evaluate 4 次 FAIL → terminal_fail。sub-graph state pr_url=null / generator_output="completed"。文件系统 `/Users/administrator/claude-output/cecelia-prompts/ws1.stdout` 不存在（H7 应该写但没写）。

### 根本原因

H7 (PR #2852) 改 entrypoint.sh `tee "$STDOUT_FILE"` 写 `/tmp/cecelia-prompts/${TASK_ID}.stdout`，但 docker-executor.js:314 mount 该目录成 `:ro` (read-only)。容器内 tee 写到 ro mount 失败，被 `2>&1 | tee` 的 stderr 合并吞掉，PIPESTATUS[0] 取 claude exit code（非 tee 失败码），entrypoint.sh 不知道写失败 → callback body stdout 恒空 → brain 永远拿不到 generator 真产出（PR URL / commit hash）→ evaluator 找不到产物 → 死循环 FAIL。

H7 unit test 用 mkdtemp 临时目录跑 mock claude，没 :ro 约束 → 测试 PASS 但生产挂。

哲学层根因：**配置（mount mode）是 contract 的一部分**，但 H7 PR 没把 mount 配置纳入修法考量，单靠 entrypoint.sh tee 不足够。Stage 2 contract enforcement layer 应在 brain side 主动验证 stdout 文件真被写（read STDOUT_FILE 后检查非空），而不是被动信 callback body。

### 下次预防

- [ ] 任何"容器写 host 路径"的修法（H7 类型），必须同步检查 docker mount mode 是否 :rw
- [ ] H7 类 unit test 需在 :ro 约束下也跑一次（or 加 docker integration smoke）— mkdtemp 不复现真容器约束
- [ ] PR review 凡涉及 entrypoint.sh / 容器内写文件，必须 grep `:ro` mount 字段确认无冲突
- [ ] 长期：cecelia-prompts mount 容器写 *.stdout 是约定，brain 应在 callback 收到后主动 fs.statSync(STDOUT_FILE) 检查非空，发现空时 retry / alert
