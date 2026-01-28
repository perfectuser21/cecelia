"""Tests for Task Decomposer."""

from src.intelligence.parser.intent_analyzer import IntentAnalysis, IntentType
from src.intelligence.parser.task_decomposer import TaskDecomposer, Task


class TestTaskDecomposer:
    """Test suite for TaskDecomposer."""

    def setup_method(self):
        """Set up test fixtures."""
        self.decomposer = TaskDecomposer()

    def test_decompose_feature_auth(self):
        """Test decomposing a feature intent for authentication."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="authentication",
            description="Implement user login",
            keywords=["user", "login"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        assert len(tasks) >= 3
        assert len(tasks) <= 10
        assert all(isinstance(t, Task) for t in tasks)

    def test_decompose_feature_api(self):
        """Test decomposing a feature intent for API."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="api",
            description="Create REST endpoint",
            keywords=["rest", "endpoint"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        assert len(tasks) >= 3
        assert any("api" in t.tags or "API" in t.title for t in tasks)

    def test_decompose_fix_intent(self):
        """Test decomposing a fix intent."""
        analysis = IntentAnalysis(
            type=IntentType.FIX,
            scope="general",
            description="Fix login bug",
            keywords=["login", "bug"],
            estimated_complexity="low",
        )
        tasks = self.decomposer.decompose(analysis)

        assert len(tasks) >= 3
        # Should have reproduce and fix steps
        titles = [t.title.lower() for t in tasks]
        assert any("reproduce" in t or "identify" in t for t in titles)

    def test_decompose_refactor_intent(self):
        """Test decomposing a refactor intent."""
        analysis = IntentAnalysis(
            type=IntentType.REFACTOR,
            scope="general",
            description="Refactor auth module",
            keywords=["auth", "module"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        assert len(tasks) >= 3

    def test_task_has_required_fields(self):
        """Test that tasks have all required fields."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Add feature",
            keywords=["feature"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        for task in tasks:
            assert task.id != ""
            assert task.title != ""
            assert task.description != ""
            assert task.priority in ["P0", "P1", "P2"]
            assert task.estimated_time != ""
            assert isinstance(task.dependencies, list)
            assert isinstance(task.tags, list)

    def test_task_ids_are_unique(self):
        """Test that task IDs are unique."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="authentication",
            description="Implement auth",
            keywords=["auth"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        ids = [t.id for t in tasks]
        assert len(ids) == len(set(ids))

    def test_task_ids_format(self):
        """Test that task IDs follow expected format."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Add feature",
            keywords=["feature"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        for task in tasks:
            assert task.id.startswith("task-")

    def test_keywords_added_to_tags(self):
        """Test that intent keywords are added to task tags."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Implement dashboard",
            keywords=["dashboard", "metrics"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        # At least some tasks should have keywords in tags
        all_tags = []
        for task in tasks:
            all_tags.extend(task.tags)

        # Keywords should appear in at least one task's tags
        assert any(kw in all_tags for kw in ["dashboard", "metrics"])

    def test_high_complexity_increases_time(self):
        """Test that high complexity increases time estimates."""
        low_analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Add feature",
            keywords=["feature"],
            estimated_complexity="low",
        )
        high_analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Add feature",
            keywords=["feature"],
            estimated_complexity="high",
        )

        low_tasks = self.decomposer.decompose(low_analysis)
        high_tasks = self.decomposer.decompose(high_analysis)

        # High complexity should have some different time estimates
        low_times = [t.estimated_time for t in low_tasks]
        high_times = [t.estimated_time for t in high_tasks]

        # They should be different (high complexity adjusts times)
        assert low_times != high_times

    def test_task_to_dict(self):
        """Test task serialization to dictionary."""
        analysis = IntentAnalysis(
            type=IntentType.FEATURE,
            scope="general",
            description="Add feature",
            keywords=["feature"],
            estimated_complexity="medium",
        )
        tasks = self.decomposer.decompose(analysis)

        task_dict = tasks[0].to_dict()

        assert "id" in task_dict
        assert "title" in task_dict
        assert "description" in task_dict
        assert "priority" in task_dict
        assert "estimated_time" in task_dict
        assert "dependencies" in task_dict
        assert "tags" in task_dict
