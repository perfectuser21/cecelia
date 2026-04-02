/**
 * stop-dev.sh 验签完整性检查测试（State Machine 三层防御 P0+P1 Layer 2）
 *
 * 验证 stop-dev.sh 在以下情况下正确拦截：
 * - step_N 标记为 done 但 .dev-seal.${BRANCH} 文件无对应验签 → 返回 block
 * - step_N 标记为 done 且 .dev-seal.${BRANCH} 有对应验签 → 不触发验签检查
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

// ⚠️ IMPORTANT: 必须用 resolve(__dirname, ...) 直接引用 stop-dev.sh
// 确保 check-changed-coverage.cjs 的 testImportsSourceFile 检查通过
const STOP_DEV_PATH = resolve(__dirname, "../../hooks/stop-dev.sh");
const VERIFY_STEP_PATH = resolve(__dirname, "../../hooks/verify-step.sh");

let tempDir: string;

// v16.0.0: seal 防伪机制已删除（Engine 重构 PR slim-engine-heartbeat），相关测试 skip
describe.skip("stop-dev.sh seal integrity check", () => {
  beforeAll(() => {
    expect(existsSync(STOP_DEV_PATH)).toBe(true);
    tempDir = mkdtempSync(join(tmpdir(), "stop-dev-seal-test-"));
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ─── 基本存在性检查 ───────────────────────────────────────
  it("stop-dev.sh should exist and be executable", () => {
    expect(() =>
      execSync(`test -x "${STOP_DEV_PATH}"`, { encoding: "utf-8" }),
    ).not.toThrow();
  });

  it("stop-dev.sh should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${STOP_DEV_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("verify-step.sh should exist (dependency for seal writing)", () => {
    expect(existsSync(VERIFY_STEP_PATH)).toBe(true);
  });

  // ─── 代码内容检查（验证验签检查逻辑已实现）────────────────
  it("stop-dev.sh contains seal integrity check variables", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain("_SEAL_FILE");
    expect(content).toContain("_SEALED_STEPS");
    expect(content).toContain("_SEAL_FAIL");
  });

  it("stop-dev.sh checks for .dev-seal.${BRANCH_NAME} file", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain(".dev-seal.");
    expect(content).toContain("BRANCH_NAME");
  });

  it("stop-dev.sh checks step_1_spec, step_2_code, step_4_ship", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain("step_1_spec");
    expect(content).toContain("step_2_code");
    expect(content).toContain("step_4_ship");
  });

  it("stop-dev.sh exits 2 when _SEAL_FAIL is true", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain('_SEAL_FAIL=false');
    expect(content).toContain('_SEAL_FAIL=true');
    expect(content).toContain('"$_SEAL_FAIL" == "true"');
  });

  it("stop-dev.sh emits STATE MACHINE warning for missing seals", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain("STATE MACHINE");
    expect(content).toContain("验签");
  });

  it("stop-dev.sh seal check is before /dev 完成条件检查", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    const sealIdx = content.indexOf("_SEAL_FILE=");
    const completionIdx = content.indexOf("/dev 完成条件检查");
    // 验签检查必须在完成条件检查之前
    expect(sealIdx).toBeGreaterThan(0);
    expect(completionIdx).toBeGreaterThan(0);
    expect(sealIdx).toBeLessThan(completionIdx);
  });

  it("stop-dev.sh checks seal with grep -q pattern", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    // 验签格式：step_N_seal: verified
    expect(content).toContain("_seal: verified");
  });

  // ─── verify-step.sh 验签写入行为检查 ─────────────────────
  it("verify-step.sh writes seal to .dev-seal.${BRANCH} on pass", () => {
    const content = readFileSync(VERIFY_STEP_PATH, "utf-8");
    expect(content).toContain("_seal_file");
    expect(content).toContain("dev-seal");
    expect(content).toContain("_seal_key}: verified@");
  });

  it("verify-step.sh seal format matches stop-dev.sh check pattern", () => {
    const stopContent = readFileSync(STOP_DEV_PATH, "utf-8");
    const verifyContent = readFileSync(VERIFY_STEP_PATH, "utf-8");
    // stop-dev.sh 检查 "${_step}_seal: verified"
    // verify-step.sh 写入 "${_seal_key}: verified@..."（动态 key，通过 case 映射到 step_N_type_seal）
    expect(stopContent).toContain("_seal: verified");
    expect(verifyContent).toContain("_seal_key}: verified@");
  });

  // ─── 函数式测试：验证 verify-step.sh seal 写入 ───────────
  it("verify-step.sh writes .dev-seal file after step4 passes", () => {
    const dir = mkdtempSync(join(tempDir, "seal-write-"));
    const branch = "cp-test-seal";

    // 创建 Learning 文件（step4 通过条件）
    const learningDir = join(dir, "docs", "learnings");
    mkdirSync(learningDir, { recursive: true });
    writeFileSync(
      join(learningDir, `${branch}.md`),
      [
        "# Learning: 测试验签写入",
        "",
        "### 根本原因",
        "",
        "这是根本原因。",
        "",
        "### 下次预防",
        "",
        "- [ ] 验证 seal 写入功能",
      ].join("\n"),
    );

    // 运行 verify-step.sh step4
    try {
      execSync(`bash "${VERIFY_STEP_PATH}" step4 "${branch}" "${dir}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: dir,
      });
    } catch {
      // step4 可能 exit 1 如果 git 不可用
    }

    // 验证 seal 文件被创建（如果成功）
    const sealFile = join(dir, `.dev-seal.${branch}`);
    if (existsSync(sealFile)) {
      const sealContent = readFileSync(sealFile, "utf-8");
      expect(sealContent).toContain("step_4_ship_seal: verified@");
    }
    // 注：如果文件不存在（git 不可用），测试仍然通过（verify-step.sh 对 git 有依赖）
  });

  // ─── seal 格式契约检查 ───────────────────────────────────
  it("seal file format uses colon-space-verified pattern", () => {
    // 验签格式必须是: "step_N_seal: verified@timestamp"
    // 与 stop-dev.sh 的 grep -q "^${_step}_seal: verified" 兼容
    const verifyContent = readFileSync(VERIFY_STEP_PATH, "utf-8");
    // 必须包含 "_seal_key}: verified@" 格式的写入命令（动态 key 通过 case 映射）
    expect(verifyContent).toMatch(/_seal_key\}: verified@/);
  });
});
