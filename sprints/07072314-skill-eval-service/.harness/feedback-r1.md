# GAN 第 1 轮 Reviewer Feedback（7.5/10，REVISION）

## P0 阻断
1. 补充缺失测试文件：tests/invariant-03-quota-precheck.test.js 和 tests/invariant-09-config-injection.test.js（DoD 铁律覆盖表引用了这两个文件但不存在）
2. 在 FR01 DB schema 中显式定义 `pending_reason` 字段（INV-03 断言依赖此字段，contract-draft 未定义）
3. E2E fixture 文件说明：在 E2E 验收命令序列前补充 ~/incoming/日报skill-v1.2-7.7.zip 的来源（哪台机器存放/如何生成）

## P1 质量
4. "硬校验五件套"名实对齐：实际有6项，改名为"六件套"或删减回5项
5. 补充 tests/fr-upload-flow.test.js，验证 token→硬校验→hash去重→建task 全链路顺序
6. INV-10 升级标记统一为 { escalated: true, level: 'P0' }，删除"或@all"歧义
7. INV-02 manual:bash 内嵌前置 setup（INSERT 20 条 pending 后再 curl 验证背压）

## P2 改善
8. 明确 /api/brain/quota/status 端点归属（加入 FR 列表作为 FR14，或加注明"本Sprint实现目标"）
9. INV-07 测试补充 mock 模式（nock/msw mock HTTP 层，使 Basic Auth 在 CI 中可自动验证）
10. E2E 末尾加"CI 全绿"步骤（gh run view --exit-status 或等价检查，对齐 PRD 第7条）
