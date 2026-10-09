# Handoff — 2026-09-12 · Brain CPU压力信号Brain自身用量修复(PR#5290收尾)

task_id: unknown（本次未预注册 Brain task，直接走 systematic-debugging → engine-worktree 修复路径）
verdict: PASS

## 一句话

追查issue 2fcd657c(task dispatch从不派发)时又挖到第二个独立bug：Brain的CPU压力信号读的是宿主机全局`/proc/stat`而非自身进程用量，us-vps上同机openclaw-gateway等容器占CPU时把Brain自己也拖累判定`pool_c_full`，全局拒绝派发所有task。已修复+生产验证。

## 完成了什么（done）

- 用systematic-debugging完整走Phase1-4：docker exec对比容器内外`/proc/stat`字节级几乎相同，证实Docker不隔离/proc/stat；`docker stats`显示Brain容器自己仅0.11% CPU却因宿主机整体load average(2核跑到2.8~2.95)被判halt
- PR #5290（已合并，Brain 1.286.4→1.286.5）：`platform-utils.js`新增`sampleBrainCpuUsage()`(process.cpuUsage()测自身，不受同机容器影响)+`evaluateCpuHealth()`，同memory pivot(2026-04-18)思路——系统级CPU高但Brain自身CPU低时降级为warn不halt；`executor.js`接入
- CI一次失败(brain-unit shard 2)：定位到11个测试文件用纯字面量mock了`platform-utils.js`缺新导出，导致`checkServerResources()`内部抛`undefined is not a function`被吞掉、表现为下游spy未被调用——逐个文件补齐mock，12个文件76 passed | 11 skipped全绿后合并
- 生产已应用：us-vps磁盘一度打满(97%)导致镜像build两次失败(no space left on device)，清理旧baseline镜像+stale容器后腾出空间，build成功→打新基线tag`baseline-20260912-pre-1.286.5`→影子测试(15222端口，验证`brain_cpu_pct`/`cpu_health_action`字段正确工作，此时因两个Brain实例同机竞争CPU、Brain自身确实忙，正确保持halt)→正式切换→**生产容器内直接验证**：`dispatch_allowed:true`、`task_pool.available:2`(此前一直是0)
- issue `2fcd657c`已更新：容量恢复后task feef7d3f仍不被选中，排除容量不足是原因，问题100%收窄到dispatcher候选任务筛选逻辑本身

## 没做的 / 明确排除（not_done）

- **task feef7d3f仍未真正跑起来**：这是issue `2fcd657c`的范围，本次只是提供了更强证据（排除容量因素），未深挖dispatcher筛选逻辑本身
- 不改Dockerfile的`ENV HOME`(已在PR#5287处理，不重复)
- 不批量审计其余~17个直接调`os.homedir()`的文件是否也有隐藏问题
- us-vps磁盘长期偏紧(80%+常态)，本次只做了应急清理(删旧baseline+stale容器)，没有做磁盘容量的长期治理

## 下一步（next_steps）

1. 深挖issue `2fcd657c`：读Brain进程实时日志，观察task feef7d3f在tick窗口内是否进入候选集合
2. 考虑us-vps磁盘长期治理(镜像/日志轮转策略)，避免每次build都要临时腾地方
3. 若2fcd657c解决，task feef7d3f跑完后可关闭golden_path `199ae170`的最后一个悬空环节

## 数据源（data_sources）

- decision `ace20d89`（CPU压力根因说明）
- issue `2fcd657c`（已更新，容量非根因的强证据）
- PR #5290（perfectuser21/cecelia，已合并）
- us-vps现状：`cecelia-node-brain`容器跑`cecelia-brain:1.286.5`，基线回滚镜像`baseline-20260912-pre-1.286.5`

## 产物（artifacts）

- PR: #5290（已合并）
- 相关memory：（本次未额外写新memory文件，沿用`brain-linux-deploy-pipeline-gap.md`系列的既有记录风格，下次session可补充）
