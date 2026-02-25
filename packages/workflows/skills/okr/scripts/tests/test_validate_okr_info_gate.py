#!/usr/bin/env python3
"""
Unit tests for check_information_gate() in validate-okr.py

Tests all 11 scenarios covering:
- Happy path (all fields present, correct sources)
- Missing required field
- Placeholder values
- Empty list
- 'assumed' source
- Missing _source field
- Short current_state
- Layers with no required fields
"""

import sys
import os

# Add parent directory to path so we can import validate-okr
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# validate-okr has a hyphen, so we need importlib
import importlib.util
spec = importlib.util.spec_from_file_location(
    "validate_okr",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "validate-okr.py")
)
validate_okr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate_okr)

check_information_gate = validate_okr.check_information_gate

# ==================== 测试数据构造工具 ====================

def make_kr_data(**overrides):
    """构造一个合格的 KR layer data，可以通过 overrides 替换或删除字段"""
    base = {
        "identified_layer": "kr",
        "metric_from": 60,
        "metric_from_source": "user_confirmed",
        "metric_to": 85,
        "metric_to_source": "user_confirmed",
        "measurement_method": "每日统计任务完成率",
        "measurement_method_source": "user_confirmed",
        "repos_involved": ["cecelia-core", "cecelia-brain"],
        "repos_involved_source": "ai_explored",
    }
    base.update(overrides)
    # 支持通过传入 _DELETE_ 来删除字段
    return {k: v for k, v in base.items() if v != "_DELETE_"}


def make_project_data(**overrides):
    """构造一个合格的 Project layer data"""
    base = {
        "identified_layer": "project",
        "current_state": "Brain 目前没有 code_review 任务类型的 callback handler，"
                         "executor.js 里只有 runQA/fixBug/refactor 三种路由，"
                         "review 类型的任务会进入 fallback 分支返回 404。",
        "current_state_source": "ai_explored",
        "repos": ["/home/xx/perfect21/cecelia/core"],
        "repos_source": "ai_explored",
        "out_of_scope": "不包含 Dashboard 展示层的修改",
        "out_of_scope_source": "user_confirmed",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v != "_DELETE_"}


def make_initiative_data(**overrides):
    """构造一个合格的 Initiative layer data"""
    base = {
        "identified_layer": "initiative",
        "target_repo": "/home/xx/perfect21/cecelia/core",
        "target_repo_source": "ai_explored",
        "current_implementation": "routes.js 目前处理 task_type=review 但不处理 code_review",
        "current_implementation_source": "ai_explored",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v != "_DELETE_"}


# ==================== 测试函数 ====================

def test_01_kr_all_valid():
    """TC01: Layer kr — 全部字段齐全，source=user_confirmed → 通过"""
    data = make_kr_data()
    result = check_information_gate(data)
    assert not result['violated'], f"应该通过，但违规: {result['violations']}"
    assert result['layer'] == 'kr'
    assert result['fields_checked'] == 4
    print("TC01 PASS: kr all valid")


def test_02_kr_missing_metric_from():
    """TC02: Layer kr — metric_from 缺失 → violated=True"""
    data = make_kr_data(metric_from="_DELETE_", metric_from_source="_DELETE_")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("metric_from" in v and "缺少" in v for v in result['violations']), \
        f"应该包含 metric_from 缺失错误，实际: {result['violations']}"
    print("TC02 PASS: kr missing metric_from")


def test_03_kr_metric_to_placeholder():
    """TC03: Layer kr — metric_to='未知' → violated=True"""
    data = make_kr_data(metric_to="未知")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("metric_to" in v and "值无效" in v for v in result['violations']), \
        f"应该包含 metric_to 值无效错误，实际: {result['violations']}"
    print("TC03 PASS: kr metric_to placeholder")


def test_04_kr_repos_involved_empty_list():
    """TC04: Layer kr — repos_involved=[] → violated=True"""
    data = make_kr_data(repos_involved=[])
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("repos_involved" in v and "空列表" in v for v in result['violations']), \
        f"应该包含空列表错误，实际: {result['violations']}"
    print("TC04 PASS: kr repos_involved empty list")


def test_05_kr_source_assumed():
    """TC05: Layer kr — metric_from_source='assumed' → violated=True"""
    data = make_kr_data(metric_from_source="assumed")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("metric_from" in v and "assumed" in v for v in result['violations']), \
        f"应该包含 assumed 来源错误，实际: {result['violations']}"
    print("TC05 PASS: kr source assumed")


def test_06_kr_source_missing():
    """TC06: Layer kr — metric_from_source 缺失 → violated=True"""
    data = make_kr_data(metric_from_source="_DELETE_")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("metric_from_source" in v and "缺少" in v for v in result['violations']), \
        f"应该包含来源字段缺失错误，实际: {result['violations']}"
    print("TC06 PASS: kr source field missing")


def test_07_project_current_state_too_short():
    """TC07: Layer project — current_state 少于50字 → violated=True"""
    data = make_project_data(current_state="太短了")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("current_state" in v and "太短" in v for v in result['violations']), \
        f"应该包含 current_state 太短错误，实际: {result['violations']}"
    print("TC07 PASS: project current_state too short")


def test_08_project_out_of_scope_source_assumed():
    """TC08: Layer project — out_of_scope_source='assumed' → violated=True"""
    data = make_project_data(out_of_scope_source="assumed")
    result = check_information_gate(data)
    assert result['violated'], "应该违规"
    assert any("out_of_scope" in v and "assumed" in v for v in result['violations']), \
        f"应该包含 out_of_scope assumed 错误，实际: {result['violations']}"
    print("TC08 PASS: project out_of_scope source assumed")


def test_09_initiative_all_valid_ai_explored():
    """TC09: Layer initiative — 全部字段 source=ai_explored → 通过"""
    data = make_initiative_data()
    result = check_information_gate(data)
    assert not result['violated'], f"应该通过，但违规: {result['violations']}"
    assert result['layer'] == 'initiative'
    assert result['fields_checked'] == 2
    print("TC09 PASS: initiative all valid with ai_explored")


def test_10_unknown_layer_no_check():
    """TC10: identified_layer='global_okr'（无必填字段）→ 通过（不检查）"""
    data = {
        "identified_layer": "global_okr",
        "some_field": "some_value",
    }
    result = check_information_gate(data)
    assert not result['violated'], f"未知层级应该通过，但违规: {result['violations']}"
    assert result['fields_checked'] == 0
    print("TC10 PASS: unknown layer skips check")


def test_11_no_identified_layer():
    """TC11: 无 identified_layer → 通过（不检查）"""
    data = {
        "objective": "提升系统稳定性",
        "key_results": [],
    }
    result = check_information_gate(data)
    assert not result['violated'], f"无层级应该通过，但违规: {result['violations']}"
    assert result['fields_checked'] == 0
    print("TC11 PASS: no identified_layer skips check")


# ==================== 额外边界测试 ====================

def test_12_kr_null_value():
    """额外: metric_from=None → violated=True"""
    data = make_kr_data(metric_from=None)
    result = check_information_gate(data)
    assert result['violated'], "None 值应该违规"
    assert any("metric_from" in v and "值无效" in v for v in result['violations'])
    print("TC12 PASS: None value detected")


def test_13_kr_empty_string_value():
    """额外: measurement_method='' → violated=True"""
    data = make_kr_data(measurement_method="")
    result = check_information_gate(data)
    assert result['violated'], "空字符串应该违规"
    print("TC13 PASS: empty string detected")


def test_14_kr_invalid_source():
    """额外: metric_from_source='guessed' → violated=True"""
    data = make_kr_data(metric_from_source="guessed")
    result = check_information_gate(data)
    assert result['violated'], "无效 source 应该违规"
    assert any("guessed" in v for v in result['violations']), \
        f"应该包含 guessed 错误，实际: {result['violations']}"
    print("TC14 PASS: invalid source value detected")


def test_15_project_all_valid():
    """额外: Layer project — 全部字段有效 → 通过"""
    data = make_project_data()
    result = check_information_gate(data)
    assert not result['violated'], f"应该通过，但违规: {result['violations']}"
    assert result['fields_checked'] == 3
    print("TC15 PASS: project all valid")


# ==================== 运行所有测试 ====================

if __name__ == '__main__':
    tests = [
        test_01_kr_all_valid,
        test_02_kr_missing_metric_from,
        test_03_kr_metric_to_placeholder,
        test_04_kr_repos_involved_empty_list,
        test_05_kr_source_assumed,
        test_06_kr_source_missing,
        test_07_project_current_state_too_short,
        test_08_project_out_of_scope_source_assumed,
        test_09_initiative_all_valid_ai_explored,
        test_10_unknown_layer_no_check,
        test_11_no_identified_layer,
        test_12_kr_null_value,
        test_13_kr_empty_string_value,
        test_14_kr_invalid_source,
        test_15_project_all_valid,
    ]

    passed = 0
    failed = 0
    errors = []

    print(f"\n{'='*60}")
    print(f"  Information Gate Unit Tests")
    print(f"{'='*60}\n")

    for test_fn in tests:
        try:
            test_fn()
            passed += 1
        except AssertionError as e:
            failed += 1
            errors.append((test_fn.__name__, str(e)))
            print(f"FAIL: {test_fn.__name__}: {e}")
        except Exception as e:
            failed += 1
            errors.append((test_fn.__name__, f"ERROR: {e}"))
            print(f"ERROR: {test_fn.__name__}: {e}")

    print(f"\n{'='*60}")
    print(f"  Results: {passed} passed, {failed} failed")
    print(f"{'='*60}")

    if errors:
        print("\nFailed tests:")
        for name, msg in errors:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    else:
        print("\nAll tests passed!")
        sys.exit(0)
