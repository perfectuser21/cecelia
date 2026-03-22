/**
 * Tests for cleanup-merged-artifacts.yml workflow
 * 验证 prd/task 残留文件自动清理机制的 workflow 结构正确性
 */

import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

const WORKFLOW_PATH = resolve(
  __dirname,
  "../../../../.github/workflows/cleanup-merged-artifacts.yml"
)

describe("cleanup-merged-artifacts.yml", () => {
  let content: string

  beforeEach(() => {
    content = readFileSync(WORKFLOW_PATH, "utf8")
  })

  it("触发条件是 push 到 main 分支", () => {
    expect(content).toContain("push:")
    expect(content).toContain("branches:")
    expect(content).toContain("main")
  })

  it("包含 git rm 清理命令", () => {
    expect(content).toContain("git rm")
  })

  it("清理目标包含 .prd- 和 .task- 两种文件", () => {
    expect(content).toContain(".prd-")
    expect(content).toContain(".task-")
  })

  it("有文件变更时才执行 commit（条件判断）", () => {
    expect(content).toContain("changed=true")
    expect(content).toContain("steps.cleanup.outputs.changed")
  })

  it("自动 commit 使用 chore 前缀", () => {
    expect(content).toContain("chore")
  })

  it("workflow 有 contents: write 权限", () => {
    expect(content).toContain("contents: write")
  })
})
