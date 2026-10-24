## 文档 QA 静态来源补全（2026-10-24）

### 根本原因
本次诊断在固定 b0e004 Git 输入中发现：测试虽被 selector 选中，生产 helper 与数据 fixture 没有进入来源消费图。新 reader 仅登记固定修订的静态导入依赖；本次独审又发现 bare 包深路径与 createRequire 别名被误接受，已保留失败测试及旧审查。

### 下次预防
- [x] 本次以真实固定 fixture、未知路径及 loader 反例建立回归；最终 93 项 runtime/doc 测试与独立增量审查通过。
- [x] 本次保留无新 schema 的旧图与完整源码封套，只把新增边表述为静态依赖；PR6636 的正式 CI、合并与生产验证尚未完成，未计端到端验收成功。

本文件是任务 427d7e49-27c5-4612-b115-9214f03d47f9 的本次开发事件附件，actor=codex-headed-cw-reliability；不替代 Brain 任务真身或冻结 C01–C12 验收。
