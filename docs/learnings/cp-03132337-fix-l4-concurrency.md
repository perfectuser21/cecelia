# Learning: L4 并发限制修复

**PR**: #934
**日期**: 2026-03-13

## 根本原因

`ci-l4-runtime.yml` 用 `concurrency: group: l4-runtime-mac` 全局串行所有 L4 run。根本原因是 PostgreSQL 端口硬编码（5432/5433/5434）——多个 L4 并发时同端口冲突，当时用全局 mutex 规避，但代价是所有 PR 的 L4 必须排队，吞吐量降至 1 个 L4/次。

## 修复方案

用 `GITHUB_RUN_ID % 100` 计算每个 run 独占的端口区间（5500~5797），pgdata 目录也按 run_id 隔离。去掉 mutex 后 xian-mac-m1（16GB/8核）支持 2 个 L4 并发（各 3 shard，约 10GB/6核）。

## 下次预防

- [ ] 新增 PostgreSQL 测试时，端口必须从 `GITHUB_RUN_ID` 或 `GITHUB_RUN_NUMBER` 派生，禁止硬编码
- [ ] runner 数量 = 预期并发 L4 数 × 3 shard，Mac mini M1 16GB 上限 = 6 runner（2 并发）
- [ ] DoD Test 禁止用 `gh api`（CI 无认证），用 grep 本地文件代替

## 安装陷阱

- tar 包损坏时直接 `rsync` 复制已解压的 runner-1，不要重新解压
- `.runner_migrated` 残留会让 `config.sh` 报"already configured"，删除后重新注册即可
- 新增 runner 后必须手动加 `crontab @reboot` 条目，否则重启后不自动启动
