#!/usr/bin/env python3
"""
PRD Validation Script - 90-point scoring system

Scores PRD quality using form_score (40) + content_score (60).
Generates .prd-validation-report.json with SHA256 hash for anti-cheat.

Usage:
    python validate-prd.py <prd-file>

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
    Validate PRD form/structure (40 points total)

    Returns:
        dict with form_score and form_issues
    """
    score = 0
    issues = []

    # Check for required sections (5 points each)
    required_sections = {
        '需求来源': 5,
        '功能描述': 5,
        '涉及文件': 5,
        '成功标准': 5,
        '技术方案': 5,
        '边界条件': 5,
        '风险评估': 5,
    }

    for section, points in required_sections.items():
        # Look for section headers (##, ###, or **bold**)
        pattern = rf'(##\s*{re.escape(section)}|###\s*{re.escape(section)}|\*\*{re.escape(section)}\*\*)'
        if re.search(pattern, content, re.MULTILINE):
            score += points
        else:
            issues.append(f"Missing section: {section} (-{points}分)")

    # Check document length (5 points if >= 30 lines excluding frontmatter)
    non_empty_lines = [line for line in lines if line.strip() and not line.strip().startswith('---')]
    if len(non_empty_lines) >= 30:
        score += 5
    else:
        issues.append(f"Document too short: {len(non_empty_lines)} lines (need ≥30) (-5分)")

    return {
        'form_score': score,
        'form_issues': issues
    }


def validate_content(content: str) -> dict:
    """
    Validate PRD content quality (60 points total)

    Uses heuristics to assess:
    - 需求明确性 (15分)
    - 技术方案可行性 (15分)
    - 成功标准可测量性 (15分)
    - 风险识别完整性 (15分)

    Returns:
        dict with content_score and content_issues
    """
    score = 0
    issues = []

    # 1. 需求明确性 (15分)
    # Check for clear problem statement and user story
    clarity_keywords = ['问题', '需求', '用户', '场景', '为什么', '目的']
    clarity_count = sum(1 for kw in clarity_keywords if kw in content)
    clarity_score = min(15, clarity_count * 3)  # 3 points per keyword, max 15
    score += clarity_score
    if clarity_score < 15:
        issues.append(f"需求明确性不足 ({clarity_score}/15分) - 缺少问题陈述关键词")

    # 2. 技术方案可行性 (15分)
    # Check for technical details, implementation approach
    technical_keywords = ['实现', '方案', '架构', '技术', '代码', '文件', '函数', '模块']
    technical_count = sum(1 for kw in technical_keywords if kw in content)
    technical_score = min(15, technical_count * 2)  # 2 points per keyword, max 15
    score += technical_score
    if technical_score < 15:
        issues.append(f"技术方案不够详细 ({technical_score}/15分) - 需要更多技术细节")

    # 3. 成功标准可测量性 (15分)
    # Check for measurable success criteria
    measurable_keywords = ['测试', '验证', '检查', '通过', '失败', '标准', '条件', '要求']
    measurable_count = sum(1 for kw in measurable_keywords if kw in content)

    # Bonus for checkbox format in success criteria
    checkbox_pattern = r'- \[[ x]\]'
    checkbox_count = len(re.findall(checkbox_pattern, content))

    measurable_score = min(15, measurable_count * 2 + checkbox_count)
    score += measurable_score
    if measurable_score < 15:
        issues.append(f"成功标准不够可测量 ({measurable_score}/15分) - 需要明确的验收条件")

    # 4. 风险识别完整性 (15分)
    # Check for risk assessment and mitigation
    risk_keywords = ['风险', '问题', '影响', '缓解', '应对', '边界', '限制', '假设']
    risk_count = sum(1 for kw in risk_keywords if kw in content)

    # Check for risk table or structured risk list
    has_risk_table = '| 风险 |' in content or '风险评估' in content
    risk_score = min(15, risk_count * 2 + (5 if has_risk_table else 0))
    score += risk_score
    if risk_score < 15:
        issues.append(f"风险识别不完整 ({risk_score}/15分) - 需要更全面的风险分析")

    return {
        'content_score': score,
        'content_issues': issues
    }


def validate_prd(prd_file: str) -> dict:
    """
    Main validation function

    Returns:
        dict with validation report
    """
    prd_path = Path(prd_file)

    if not prd_path.exists():
        return {
            'error': f"PRD file not found: {prd_file}",
            'total_score': 0
        }

    # Read file content
    content = prd_path.read_text(encoding='utf-8')
    lines = content.split('\n')

    # Validate form (40 points)
    form_result = validate_form(content, lines)

    # Validate content (60 points)
    content_result = validate_content(content)

    # Calculate total score
    form_score = form_result['form_score']
    content_score = content_result['content_score']
    total_score = form_score + content_score

    # Generate report
    report = {
        'prd_file': str(prd_file),
        'form_score': form_score,
        'content_score': content_score,
        'total_score': total_score,
        'passing': total_score >= 90,
        'form_issues': form_result['form_issues'],
        'content_issues': content_result['content_issues'],
        'content_sha256': calculate_sha256(content),
        'timestamp': datetime.now().isoformat(),
        'validation_version': '1.0.0'
    }

    return report


def main():
    if len(sys.argv) != 2:
        print("Usage: python validate-prd.py <prd-file>", file=sys.stderr)
        sys.exit(2)

    prd_file = sys.argv[1]
    report = validate_prd(prd_file)

    # Check for errors
    if 'error' in report:
        print(f"Error: {report['error']}", file=sys.stderr)
        sys.exit(2)

    # Write report to .prd-validation-report.json
    report_file = '.prd-validation-report.json'
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Print summary
    print(f"PRD Validation Report:")
    print(f"  Form Score: {report['form_score']}/40")
    print(f"  Content Score: {report['content_score']}/60")
    print(f"  Total Score: {report['total_score']}/100")
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
