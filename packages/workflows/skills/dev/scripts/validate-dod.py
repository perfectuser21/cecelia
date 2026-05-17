#!/usr/bin/env python3
"""
DoD Validation Script - 90-point scoring system

Scores DoD quality using form_score (40) + content_score (60).
Generates .dod-validation-report.json with SHA256 hash for anti-cheat.

Usage:
    python validate-dod.py <dod-file>

Exit codes:
    0 - Score >= 90 (pass)
    1 - Score < 90 (fail)
    2 - Error (file not found, invalid format, etc.)
"""

import sys
import json
import hashlib
import re
from datetime import datetime
from pathlib import Path


def calculate_sha256(content: str) -> str:
    """Calculate SHA256 hash of content"""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def validate_form(content: str, lines: list) -> dict:
    """
    Validate DoD form/structure (40 points total)

    Returns:
        dict with form_score and form_issues
    """
    score = 0
    issues = []

    # Count checklist items (- [ ] or - [x])
    checkbox_pattern = r'^- \[[ x]\]'
    checklist_items = [line for line in lines if re.match(checkbox_pattern, line.strip())]
    checklist_count = len(checklist_items)

    # 1. Checklist count >= 5 (10 points)
    if checklist_count >= 5:
        score += 10
    else:
        issues.append(f"Too few checklist items: {checklist_count} (need ≥5) (-10分)")

    # 2. Each item has [ ] format (10 points)
    # Already checked above - if we have items, they have format
    if checklist_count > 0:
        score += 10
    else:
        issues.append("No valid checklist format found (-10分)")

    # 3. Each item has Test field (10 points)
    # Check for "Test:" in checklist items
    items_with_test = 0
    for i, line in enumerate(lines):
        if re.match(checkbox_pattern, line.strip()):
            # Look ahead for "Test:" within next 3 lines
            for j in range(i, min(i + 3, len(lines))):
                if 'Test:' in lines[j] or '- Test:' in lines[j]:
                    items_with_test += 1
                    break

    # Score proportional to coverage (min 50% to get points)
    if checklist_count > 0:
        test_coverage = items_with_test / checklist_count
        if test_coverage >= 0.5:
            score += int(10 * test_coverage)
        else:
            issues.append(f"Test field coverage too low: {test_coverage:.0%} (need ≥50%) (-10分)")

    # 4. Document length >= 20 lines (10 points)
    non_empty_lines = [line for line in lines if line.strip() and not line.strip().startswith('---')]
    if len(non_empty_lines) >= 20:
        score += 10
    else:
        issues.append(f"Document too short: {len(non_empty_lines)} lines (need ≥20) (-10分)")

    return {
        'form_score': score,
        'form_issues': issues,
        'checklist_count': checklist_count,
        'items_with_test': items_with_test
    }


def validate_content(content: str, checklist_count: int) -> dict:
    """
    Validate DoD content quality (60 points total)

    Uses heuristics to assess:
    - DoD 条目明确性 (20分)
    - Test 字段可执行性 (20分)
    - 覆盖面完整性 (20分)

    Returns:
        dict with content_score and content_issues
    """
    score = 0
    issues = []

    # 1. DoD 条目明确性 (20分)
    # Check for clear, actionable DoD items
    clarity_keywords = ['实现', '完成', '通过', '验证', '检查', '测试', '确保']
    clarity_matches = sum(1 for kw in clarity_keywords if kw in content)
    clarity_score = min(20, clarity_matches * 3)  # 3 points per keyword
    score += clarity_score
    if clarity_score < 20:
        issues.append(f"DoD 条目不够明确 ({clarity_score}/20分) - 需要更明确的动作动词")

    # 2. Test 字段可执行性 (20分)
    # Check for executable test commands
    test_keywords = ['bash', 'python', 'npm', 'git', 'grep', 'test', 'run', 'check']
    test_matches = sum(1 for kw in test_keywords if kw in content)

    # Bonus for actual command snippets (`` or ```)
    code_blocks = len(re.findall(r'`[^`]+`', content))
    test_score = min(20, test_matches * 2 + code_blocks)
    score += test_score
    if test_score < 20:
        issues.append(f"Test 字段不够可执行 ({test_score}/20分) - 需要具体的测试命令")

    # 3. 覆盖面完整性 (20分)
    # Check for diverse coverage areas
    coverage_keywords = {
        '功能': ['功能', '特性', 'feature'],
        '测试': ['测试', 'test', '单元测试'],
        '性能': ['性能', 'performance', '时间'],
        '文档': ['文档', 'doc', 'README'],
        'CI': ['CI', 'DevGate', '版本', 'version'],
    }

    coverage_areas = 0
    for area, keywords in coverage_keywords.items():
        if any(kw in content for kw in keywords):
            coverage_areas += 1

    coverage_score = coverage_areas * 4  # 4 points per area, max 20
    score += coverage_score
    if coverage_score < 20:
        issues.append(f"覆盖面不够完整 ({coverage_score}/20分) - 需要覆盖更多方面")

    return {
        'content_score': score,
        'content_issues': issues
    }


def validate_dod(dod_file: str) -> dict:
    """
    Main validation function

    Returns:
        dict with validation report
    """
    dod_path = Path(dod_file)

    if not dod_path.exists():
        return {
            'error': f"DoD file not found: {dod_file}",
            'total_score': 0
        }

    # Read file content
    content = dod_path.read_text(encoding='utf-8')
    lines = content.split('\n')

    # Validate form (40 points)
    form_result = validate_form(content, lines)

    # Validate content (60 points)
    content_result = validate_content(content, form_result['checklist_count'])

    # Calculate total score
    form_score = form_result['form_score']
    content_score = content_result['content_score']
    total_score = form_score + content_score

    # Generate report
    report = {
        'dod_file': str(dod_file),
        'form_score': form_score,
        'content_score': content_score,
        'total_score': total_score,
        'passing': total_score >= 90,
        'checklist_count': form_result['checklist_count'],
        'items_with_test': form_result['items_with_test'],
        'form_issues': form_result['form_issues'],
        'content_issues': content_result['content_issues'],
        'content_sha256': calculate_sha256(content),
        'timestamp': datetime.now().isoformat(),
        'validation_version': '1.0.0'
    }

    return report


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate-dod.py <dod-file>", file=sys.stderr)
        sys.exit(2)

    dod_file = sys.argv[1]
    report = validate_dod(dod_file)

    # Check for errors
    if 'error' in report:
        print(f"Error: {report['error']}", file=sys.stderr)
        sys.exit(2)

    # Write report to .dod-validation-report.json
    report_file = '.dod-validation-report.json'
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"DoD Validation Report:")
    print(f"  Form Score: {report['form_score']}/40")
    print(f"  Content Score: {report['content_score']}/60")
    print(f"  Total Score: {report['total_score']}/100")
    print(f"  Checklist Items: {report['checklist_count']}")
    print(f"  Items with Test: {report['items_with_test']}")
    print(f"  Status: {'✅ PASS' if report['passing'] else '❌ FAIL'}")

    if not report['passing']:
        print(f"\nIssues to fix:")
        for issue in report['form_issues'] + report['content_issues']:
            print(f"  - {issue}")

    print(f"\nReport saved to: {report_file}")

    # Exit code
    sys.exit(0 if report['passing'] else 1)


if __name__ == '__main__':
    main()
