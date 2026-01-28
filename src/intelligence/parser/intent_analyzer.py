"""Intent Analyzer - Understand user intent from natural language."""

import re
from dataclasses import dataclass
from enum import Enum
from typing import List


class IntentType(str, Enum):
    """Types of development intents."""

    FEATURE = "feature"
    FIX = "fix"
    REFACTOR = "refactor"
    TEST = "test"
    DOCS = "docs"
    UNKNOWN = "unknown"


@dataclass
class IntentAnalysis:
    """Result of intent analysis."""

    type: IntentType
    scope: str
    description: str
    keywords: List[str]
    estimated_complexity: str  # low, medium, high


class IntentAnalyzer:
    """Analyzes user intent from natural language descriptions."""

    # Keywords that indicate intent type
    INTENT_KEYWORDS = {
        IntentType.FEATURE: [
            "add",
            "create",
            "implement",
            "build",
            "new",
            "introduce",
            "develop",
            "make",
            "设计",
            "实现",
            "添加",
            "创建",
            "新增",
            "开发",
            "构建",
        ],
        IntentType.FIX: [
            "fix",
            "bug",
            "error",
            "issue",
            "repair",
            "resolve",
            "correct",
            "patch",
            "修复",
            "修正",
            "解决",
            "问题",
            "错误",
            "bug",
        ],
        IntentType.REFACTOR: [
            "refactor",
            "restructure",
            "reorganize",
            "clean",
            "improve",
            "optimize",
            "simplify",
            "重构",
            "优化",
            "改进",
            "整理",
            "清理",
        ],
        IntentType.TEST: [
            "test",
            "testing",
            "spec",
            "coverage",
            "unit test",
            "e2e",
            "integration",
            "测试",
            "单元测试",
            "集成测试",
        ],
        IntentType.DOCS: [
            "document",
            "documentation",
            "readme",
            "comment",
            "docs",
            "文档",
            "注释",
            "说明",
        ],
    }

    # Scope indicators
    SCOPE_KEYWORDS = {
        "authentication": ["auth", "login", "logout", "session", "登录", "认证", "会话"],
        "database": ["database", "db", "sql", "schema", "table", "数据库", "表"],
        "api": ["api", "endpoint", "route", "controller", "接口", "路由"],
        "frontend": ["ui", "frontend", "component", "page", "前端", "组件", "页面"],
        "backend": ["backend", "server", "service", "后端", "服务"],
        "infrastructure": ["docker", "deploy", "ci", "cd", "部署", "基础设施"],
        "testing": ["test", "spec", "coverage", "测试"],
    }

    # Complexity indicators
    COMPLEXITY_INDICATORS = {
        "high": ["system", "architecture", "complete", "full", "entire", "complex", "系统", "架构", "完整", "全部"],
        "low": ["simple", "minor", "small", "quick", "easy", "简单", "小", "快速"],
    }

    def analyze(self, intent: str) -> IntentAnalysis:
        """Analyze user intent and return structured analysis.

        Args:
            intent: Natural language description of the task

        Returns:
            IntentAnalysis with type, scope, and complexity
        """
        intent_lower = intent.lower()

        # Detect intent type
        intent_type = self._detect_intent_type(intent_lower)

        # Extract scope
        scope = self._detect_scope(intent_lower)

        # Extract keywords
        keywords = self._extract_keywords(intent_lower)

        # Estimate complexity
        complexity = self._estimate_complexity(intent_lower, keywords)

        return IntentAnalysis(
            type=intent_type,
            scope=scope,
            description=intent,
            keywords=keywords,
            estimated_complexity=complexity,
        )

    def _detect_intent_type(self, text: str) -> IntentType:
        """Detect the type of intent from text."""
        scores = {intent_type: 0 for intent_type in IntentType}

        for intent_type, keywords in self.INTENT_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    scores[intent_type] += 1

        # Find highest scoring type
        max_score = max(scores.values())
        if max_score == 0:
            return IntentType.UNKNOWN

        for intent_type, score in scores.items():
            if score == max_score:
                return intent_type

        return IntentType.UNKNOWN

    def _detect_scope(self, text: str) -> str:
        """Detect the scope/area of the intent."""
        for scope, keywords in self.SCOPE_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    return scope

        return "general"

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract relevant keywords from the text."""
        # Remove common words
        stop_words = {
            "a",
            "an",
            "the",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "shall",
            "can",
            "need",
            "to",
            "of",
            "in",
            "for",
            "on",
            "with",
            "at",
            "by",
            "from",
            "as",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "between",
            "under",
            "again",
            "further",
            "then",
            "once",
            "i",
            "me",
            "my",
            "myself",
            "we",
            "our",
            "ours",
            "ourselves",
            "you",
            "your",
            "yours",
            "yourself",
            "yourselves",
            "he",
            "him",
            "his",
            "himself",
            "she",
            "her",
            "hers",
            "herself",
            "it",
            "its",
            "itself",
            "they",
            "them",
            "their",
            "theirs",
            "themselves",
            "what",
            "which",
            "who",
            "whom",
            "this",
            "that",
            "these",
            "those",
            "am",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "and",
            "but",
            "if",
            "or",
            "because",
            "as",
            "until",
            "while",
            "of",
            "at",
            "by",
            "for",
            "with",
            "about",
            "against",
            "between",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "to",
            "from",
            "up",
            "down",
            "in",
            "out",
            "on",
            "off",
            "over",
            "under",
            "again",
            "further",
            "then",
            "once",
            "here",
            "there",
            "when",
            "where",
            "why",
            "how",
            "all",
            "each",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "nor",
            "not",
            "only",
            "own",
            "same",
            "so",
            "than",
            "too",
            "very",
            "just",
            "的",
            "了",
            "是",
            "在",
            "我",
            "有",
            "和",
            "就",
            "不",
            "人",
            "都",
            "一",
            "一个",
            "上",
            "也",
            "很",
            "到",
            "说",
            "要",
            "去",
            "你",
            "会",
            "着",
            "没有",
            "看",
            "好",
            "自己",
            "这",
        }

        # Extract words
        words = re.findall(r"\b[a-zA-Z\u4e00-\u9fff]+\b", text)

        # Filter and return unique keywords
        keywords = []
        for word in words:
            if word.lower() not in stop_words and len(word) > 2:
                if word.lower() not in keywords:
                    keywords.append(word.lower())

        return keywords[:10]  # Limit to top 10 keywords

    def _estimate_complexity(self, text: str, keywords: List[str]) -> str:
        """Estimate the complexity of the task."""
        # Check for high complexity indicators
        for indicator in self.COMPLEXITY_INDICATORS["high"]:
            if indicator in text:
                return "high"

        # Check for low complexity indicators
        for indicator in self.COMPLEXITY_INDICATORS["low"]:
            if indicator in text:
                return "low"

        # Use keyword count as a heuristic
        if len(keywords) > 7:
            return "high"
        elif len(keywords) < 4:
            return "low"

        return "medium"
