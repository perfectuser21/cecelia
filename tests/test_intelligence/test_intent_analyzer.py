"""Tests for Intent Analyzer."""

from src.intelligence.parser.intent_analyzer import IntentAnalyzer, IntentType


class TestIntentAnalyzer:
    """Test suite for IntentAnalyzer."""

    def setup_method(self):
        """Set up test fixtures."""
        self.analyzer = IntentAnalyzer()

    def test_detect_feature_intent_english(self):
        """Test detecting feature intent from English text."""
        result = self.analyzer.analyze("Add a user login feature")
        assert result.type == IntentType.FEATURE

    def test_detect_feature_intent_chinese(self):
        """Test detecting feature intent from Chinese text."""
        result = self.analyzer.analyze("实现用户登录功能")
        assert result.type == IntentType.FEATURE

    def test_detect_fix_intent(self):
        """Test detecting fix intent."""
        result = self.analyzer.analyze("Fix the bug in login form")
        assert result.type == IntentType.FIX

    def test_detect_fix_intent_chinese(self):
        """Test detecting fix intent from Chinese text."""
        result = self.analyzer.analyze("修复登录页面的错误")
        assert result.type == IntentType.FIX

    def test_detect_refactor_intent(self):
        """Test detecting refactor intent."""
        result = self.analyzer.analyze("Refactor the authentication module")
        assert result.type == IntentType.REFACTOR

    def test_detect_refactor_intent_chinese(self):
        """Test detecting refactor intent from Chinese text."""
        result = self.analyzer.analyze("重构认证模块")
        assert result.type == IntentType.REFACTOR

    def test_detect_test_intent(self):
        """Test detecting test intent."""
        result = self.analyzer.analyze("Add unit tests for auth module")
        assert result.type == IntentType.TEST

    def test_detect_unknown_intent(self):
        """Test detecting unknown intent."""
        result = self.analyzer.analyze("xyz abc")
        assert result.type == IntentType.UNKNOWN

    def test_detect_scope_authentication(self):
        """Test detecting authentication scope."""
        result = self.analyzer.analyze("Implement login functionality")
        assert result.scope == "authentication"

    def test_detect_scope_api(self):
        """Test detecting API scope."""
        result = self.analyzer.analyze("Create REST API endpoint")
        assert result.scope == "api"

    def test_detect_scope_frontend(self):
        """Test detecting frontend scope."""
        result = self.analyzer.analyze("Build UI component for dashboard")
        assert result.scope == "frontend"

    def test_detect_scope_database(self):
        """Test detecting database scope."""
        result = self.analyzer.analyze("Update database schema")
        assert result.scope == "database"

    def test_extract_keywords(self):
        """Test keyword extraction."""
        result = self.analyzer.analyze("Implement user authentication with JWT tokens")
        assert "user" in result.keywords or "authentication" in result.keywords
        assert len(result.keywords) > 0
        assert len(result.keywords) <= 10

    def test_estimate_high_complexity(self):
        """Test high complexity estimation."""
        result = self.analyzer.analyze("Build a complete authentication system with OAuth")
        assert result.estimated_complexity == "high"

    def test_estimate_low_complexity(self):
        """Test low complexity estimation."""
        result = self.analyzer.analyze("Simple fix for typo")
        assert result.estimated_complexity == "low"

    def test_estimate_medium_complexity(self):
        """Test medium complexity estimation."""
        result = self.analyzer.analyze("Add validation to form fields")
        assert result.estimated_complexity == "medium"

    def test_description_preserved(self):
        """Test that original description is preserved."""
        intent = "Create a new feature for user management"
        result = self.analyzer.analyze(intent)
        assert result.description == intent
