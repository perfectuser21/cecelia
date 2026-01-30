"""Tests for Orchestrator planner."""

import pytest
from unittest.mock import patch, MagicMock

from src.autumnrice.models import TRD, Task
from src.autumnrice.planner import Planner


class TestPlanner:
    """Tests for Planner."""

    @pytest.fixture
    def planner(self):
        return Planner(timeout_seconds=30)

    def test_build_prompt(self, planner):
        """Test prompt building."""
        trd = TRD(
            id="TRD-001",
            title="Test TRD",
            description="Test description",
            projects=["proj1"],
            acceptance_criteria=["criteria1", "criteria2"],
        )
        prompt = planner._build_prompt(trd)
        assert "TRD-001" in prompt
        assert "Test TRD" in prompt
        assert "criteria1" in prompt

    def test_build_prompt_with_context(self, planner):
        """Test prompt building with context."""
        trd = TRD(title="Test")
        context = {"projects": ["proj1", "proj2"]}
        prompt = planner._build_prompt(trd, context)
        assert "proj1" in prompt
        assert "proj2" in prompt

    def test_parse_output_valid_json(self, planner):
        """Test parsing valid JSON output."""
        output = '''
        {
            "tasks": [
                {
                    "title": "Task 1",
                    "description": "Desc 1",
                    "repo": "/repo",
                    "branch": "main",
                    "priority": "P0",
                    "depends_on": [],
                    "acceptance": ["acc1"]
                },
                {
                    "title": "Task 2",
                    "description": "Desc 2",
                    "repo": "/repo",
                    "branch": "feat",
                    "priority": "P1",
                    "depends_on": ["T-1"],
                    "acceptance": ["acc2"]
                }
            ]
        }
        '''
        tasks = planner._parse_output(output, "TRD-001")
        assert len(tasks) == 2
        assert tasks[0].title == "Task 1"
        assert tasks[0].priority == "P0"
        assert tasks[1].title == "Task 2"
        # Check dependency resolution
        assert len(tasks[1].depends_on) == 1
        assert tasks[1].depends_on[0] == tasks[0].id

    def test_parse_output_invalid_json(self, planner):
        """Test parsing invalid JSON raises error."""
        output = "This is not JSON"
        with pytest.raises(ValueError):
            planner._parse_output(output, "TRD-001")

    def test_parse_output_missing_tasks(self, planner):
        """Test parsing output without tasks key raises error."""
        output = '{"foo": "bar"}'
        with pytest.raises(ValueError):
            planner._parse_output(output, "TRD-001")

    def test_validate_tasks_valid(self, planner):
        """Test validating valid tasks."""
        tasks = [
            Task(
                id="T-001",
                title="Task 1",
                repo="/repo",
                branch="main",
                acceptance=["acc1"],
            ),
            Task(
                id="T-002",
                title="Task 2",
                repo="/repo",
                branch="feat",
                depends_on=["T-001"],
                acceptance=["acc2"],
            ),
        ]
        errors = planner.validate_tasks(tasks)
        assert errors == []

    def test_validate_tasks_missing_title(self, planner):
        """Test validating tasks with missing title."""
        tasks = [
            Task(id="T-001", title="", repo="/repo", branch="main", acceptance=["acc"]),
        ]
        errors = planner.validate_tasks(tasks)
        assert any("missing title" in e for e in errors)

    def test_validate_tasks_missing_repo(self, planner):
        """Test validating tasks with missing repo."""
        tasks = [
            Task(id="T-001", title="Task", repo="", branch="main", acceptance=["acc"]),
        ]
        errors = planner.validate_tasks(tasks)
        assert any("missing repo" in e for e in errors)

    def test_validate_tasks_missing_acceptance(self, planner):
        """Test validating tasks with missing acceptance."""
        tasks = [
            Task(id="T-001", title="Task", repo="/repo", branch="main", acceptance=[]),
        ]
        errors = planner.validate_tasks(tasks)
        assert any("missing acceptance" in e for e in errors)

    def test_validate_tasks_invalid_dependency(self, planner):
        """Test validating tasks with invalid dependency."""
        tasks = [
            Task(id="T-001", title="Task", repo="/repo", branch="main", depends_on=["T-999"], acceptance=["acc"]),
        ]
        errors = planner.validate_tasks(tasks)
        assert any("invalid dependency" in e for e in errors)

    def test_validate_tasks_empty(self, planner):
        """Test validating empty task list."""
        errors = planner.validate_tasks([])
        assert any("No tasks" in e for e in errors)

    @patch('subprocess.run')
    def test_plan_success(self, mock_run, planner):
        """Test successful planning with mocked LLM."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='''
            {
                "tasks": [
                    {
                        "title": "Task 1",
                        "description": "Desc",
                        "repo": "/repo",
                        "branch": "main",
                        "priority": "P0",
                        "depends_on": [],
                        "acceptance": ["acc"]
                    }
                ]
            }
            ''',
            stderr="",
        )

        trd = TRD(title="Test TRD", acceptance_criteria=["criteria"])
        result = planner.plan(trd)

        assert result.success is True
        assert len(result.tasks) == 1
        assert result.tasks[0].trd_id == trd.id

    @patch('subprocess.run')
    def test_plan_llm_failure(self, mock_run, planner):
        """Test planning when LLM call fails."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error",
        )

        trd = TRD(title="Test")
        result = planner.plan(trd)

        assert result.success is False
        assert "failed" in result.error.lower()

    @patch('subprocess.run')
    def test_plan_invalid_output(self, mock_run, planner):
        """Test planning when LLM returns invalid output."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="This is not valid JSON",
            stderr="",
        )

        trd = TRD(title="Test")
        result = planner.plan(trd)

        assert result.success is False
        assert result.raw_output is not None
