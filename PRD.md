# PRD: 给 archive-learnings.yml 加注释强制 GHA 重新解析 triggers

## 背景

PR #2450 改了 archive-learnings.yml 的 Commit 步骤（从 push main 改成开 PR）。合并进 main 后，GHA API 仍然报 `422: Workflow does not have 'workflow_dispatch' trigger`，实际文件有。这是 GHA 已知元数据缓存 bug。

尝试过：disable/enable workflow、API 用 file path vs id、用 sha vs ref=main。全部 422。

## 成功标准

1. 合并后 `gh workflow run archive-learnings.yml --ref main` 成功（不再 422）
2. 触发后 workflow 跑通，开出归档 PR（cp-archive-* 分支，harness 标签）
3. 归档 PR 过 CI 后 auto-merge 自动合入

## 策略

改动极小：给 archive-learnings.yml 头部加一行版本注释 `# v1.1 (2026-04-20): 从 bot 直推 main 改成开 PR`。push → PR → merge 会触发 GHA 重新 parse 工作流文件，元数据缓存刷新。

## 非目标

- 不改 workflow 逻辑本身
- 不修 ruleset、不加 bypass
