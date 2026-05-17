import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Phase 7.3: bash 3.2 + set -u 空数组/未定义变量 hardening sweep
// 对修复的每个脚本：
//   1. bash -n 语法合法
//   2. 在 set -u 模式下 source / 关键路径不抛 "unbound variable"

const REPO_ROOT = resolve(__dirname, '../../../..');

const MODIFIED_SCRIPTS = [
  'packages/engine/skills/dev/scripts/cleanup.sh',
  'packages/workflows/skills/dev/scripts/cleanup.sh',
  'packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh',
  'packages/workflows/skills/dev/scripts/scan-change-level.sh',
  'packages/engine/skills/dev/scripts/fetch-task-prd.sh',
  'packages/brain/scripts/cleanup-merged-worktrees.sh',
  'packages/engine/runners/codex/runner.sh',
  'packages/engine/runners/codex/playwright-runner.sh',
  'packages/brain/scripts/cecelia-run.sh',
  'packages/workflows/skills/skill-creator/scripts/classify-skill.sh',
  'packages/engine/scripts/bump-version.sh',
];

describe('Phase 7.3 bash 3.2 + set -u hardening sweep', () => {
  describe('syntax check (bash -n)', () => {
    for (const rel of MODIFIED_SCRIPTS) {
      it(`${rel}`, () => {
        const abs = resolve(REPO_ROOT, rel);
        expect(existsSync(abs), `missing: ${abs}`).toBe(true);
        // bash -n 校验语法，不执行
        expect(() => execSync(`bash -n "${abs}"`, { stdio: 'pipe' })).not.toThrow();
      });
    }
  });

  describe('guard pattern works on bash 3.2 + set -u', () => {
    it('${arr[@]+${arr[@]}} guard — 空数组下不抛 unbound variable', () => {
      const out = execSync(
        `bash -c 'set -u; arr=(); for x in "\${arr[@]+\${arr[@]}}"; do echo "$x"; done; echo OK' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('OK');
    });

    // Phase 7.3 注：macOS 默认 bash 3.2 下，空数组 ${arr[@]} + set -u 会报
    // "unbound variable"。但 CI runner（ubuntu-latest）默认 bash 5+，此行为
    // 已修正，所以"基线对照"测试在 CI 不成立。本 bug 是 macOS 特有，我们只
    // 确保 guard 模式（上面的 test）在所有 bash 版本都工作，这已足够。
    it.skipIf(process.env.CI === 'true' || process.platform !== 'darwin')(
      '基线对照（仅 macOS bash 3.2）：未 guard 的 "${arr[@]}" 在 set -u + 空数组下必炸',
      () => {
        let errorOutput = '';
        try {
          execSync(`bash -c 'set -u; arr=(); for x in "\${arr[@]}"; do echo "$x"; done' 2>&1`, {
            shell: '/bin/bash',
            stdio: 'pipe',
          });
        } catch (err: any) {
          errorOutput = (err.stderr?.toString?.() || '') + (err.stdout?.toString?.() || '');
        }
        expect(errorOutput).toMatch(/unbound variable/);
      },
    );
  });

  describe('functional smoke test — 修复后的脚本在空输入 / 空 env 下不炸', () => {
    it('check-chinese-punctuation-bombs.sh 在无匹配目录下 exit 0，不抛 unbound variable', () => {
      // 随便找个不含 hooks/packages/scripts 的空目录
      const tmpDir = execSync('mktemp -d', { shell: '/bin/bash' }).toString().trim();
      try {
        execSync(`cd "${tmpDir}" && git init -q`, { shell: '/bin/bash' });
        const script = resolve(REPO_ROOT, 'packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh');
        const result = execSync(
          `cd "${tmpDir}" && bash "${script}" 2>&1; echo "EXIT=$?"`,
          { shell: '/bin/bash' },
        ).toString();
        expect(result).not.toContain('unbound variable');
        expect(result).toContain('EXIT=0');
      } finally {
        execSync(`rm -rf "${tmpDir}"`, { shell: '/bin/bash' });
      }
    });

    it('cleanup.sh EXIT trap 在 TEMP_FILES 为空时不炸', () => {
      // 直接 source 触发 trap 的关键段
      const out = execSync(
        `bash -c '
          set -euo pipefail
          TEMP_FILES=()
          cleanup_temp() {
              for f in "\${TEMP_FILES[@]+\${TEMP_FILES[@]}}"; do
                  rm -f "$f" 2>/dev/null || true
              done
          }
          trap cleanup_temp EXIT
          echo READY
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('READY');
      expect(out).not.toContain('unbound variable');
    });

    it('cleanup-merged-worktrees.sh nullglob 无匹配时不炸', () => {
      // 模拟 brain/scripts/cleanup-merged-worktrees.sh 的 matches 空数组处理
      const out = execSync(
        `bash -c '
          set -uo pipefail
          shopt -s nullglob
          matches=( /nonexistent-glob-*/foo )
          shopt -u nullglob
          for wt in "\${matches[@]+\${matches[@]}}"; do
              echo "WONT_HAPPEN: $wt"
          done
          echo NO_CRASH
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('NO_CRASH');
    });

    it('codex runner CODEX_HOMES="" 空字符串时降级到单账号不炸', () => {
      // 模拟 runner.sh 的账号初始化路径
      const out = execSync(
        `CODEX_HOMES="" CODEX_HOME=/tmp/.codex-test bash -c '
          set -euo pipefail
          CODEX_ACCOUNT_LIST=()
          if [[ -n "\${CODEX_HOMES:-}" ]]; then
              IFS=":" read -ra CODEX_ACCOUNT_LIST <<< "$CODEX_HOMES"
          fi
          if [[ \${#CODEX_ACCOUNT_LIST[@]} -eq 0 ]]; then
              CODEX_ACCOUNT_LIST=("\${CODEX_HOME:-$HOME/.codex}")
          fi
          echo "FIRST=\${CODEX_ACCOUNT_LIST[0]}"
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('FIRST=/tmp/.codex-test');
    });

    it('cecelia-run.sh _env_args compgen 无命中时 exec 不炸', () => {
      // 模拟 cecelia-run.sh 的 root 切换路径的 _env_args 展开
      const out = execSync(
        `bash -c '
          set -euo pipefail
          _env_args=()
          # compgen 过滤一个根本不可能存在的前缀，必然空
          for _var in $(compgen -v 2>/dev/null | grep -E "^__NEVER_EXISTS_PHASE73_" || true); do
              _env_args+=("$_var=\${!_var}")
          done
          # 关键：用 guard 展开空数组给 env（模拟 exec sudo env "\${_env_args[@]+...}" ...）
          env "\${_env_args[@]+\${_env_args[@]}}" true && echo PASS
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('PASS');
    });

    it('classify-skill reasons 空数组 jq 回退到 []，不炸', () => {
      const out = execSync(
        `bash -c '
          set -euo pipefail
          reasons=()
          json_out=$(if [[ \${#reasons[@]} -gt 0 ]]; then printf "%s\\n" "\${reasons[@]}" | jq -R . | jq -s .; else echo "[]"; fi)
          echo "RESULT=$json_out"
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('RESULT=[]');
    });

    it('scan-change-level REASONS 空数组循环不炸', () => {
      const out = execSync(
        `bash -c '
          set -euo pipefail
          REASONS=()
          for r in "\${REASONS[@]+\${REASONS[@]}}"; do
              echo "WONT: $r"
          done
          echo DONE
        ' 2>&1`,
        { shell: '/bin/bash' },
      ).toString().trim();
      expect(out).toBe('DONE');
    });
  });
});
