"""Task Decomposer - Break down intents into executable tasks."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from src.intelligence.parser.intent_analyzer import IntentAnalysis, IntentType


@dataclass
class Task:
    """A single executable task."""

    id: str
    title: str
    description: str
    priority: str  # P0, P1, P2
    estimated_time: str
    dependencies: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "estimated_time": self.estimated_time,
            "dependencies": self.dependencies,
            "tags": self.tags,
        }


class TaskDecomposer:
    """Decomposes user intent into executable tasks."""

    # Task templates for common patterns
    TASK_TEMPLATES = {
        IntentType.FEATURE: {
            "authentication": [
                Task(
                    id="",
                    title="Design database schema",
                    description="Create tables and relationships for authentication",
                    priority="P0",
                    estimated_time="30min",
                    tags=["database", "schema"],
                ),
                Task(
                    id="",
                    title="Implement backend API",
                    description="Create REST endpoints for authentication",
                    priority="P0",
                    estimated_time="2h",
                    tags=["backend", "api"],
                ),
                Task(
                    id="",
                    title="Implement frontend UI",
                    description="Create login/register forms and components",
                    priority="P0",
                    estimated_time="2h",
                    tags=["frontend", "ui"],
                ),
                Task(
                    id="",
                    title="Write unit tests",
                    description="Test authentication logic and API",
                    priority="P1",
                    estimated_time="1h",
                    tags=["test"],
                ),
                Task(
                    id="",
                    title="Integration testing",
                    description="End-to-end testing of auth flow",
                    priority="P1",
                    estimated_time="30min",
                    tags=["test", "e2e"],
                ),
            ],
            "api": [
                Task(
                    id="",
                    title="Design API contract",
                    description="Define endpoints, request/response schemas",
                    priority="P0",
                    estimated_time="30min",
                    tags=["design", "api"],
                ),
                Task(
                    id="",
                    title="Implement API endpoints",
                    description="Create route handlers and controllers",
                    priority="P0",
                    estimated_time="2h",
                    tags=["backend", "api"],
                ),
                Task(
                    id="",
                    title="Add validation",
                    description="Input validation and error handling",
                    priority="P0",
                    estimated_time="1h",
                    tags=["backend", "validation"],
                ),
                Task(
                    id="",
                    title="Write API tests",
                    description="Unit and integration tests for endpoints",
                    priority="P1",
                    estimated_time="1h",
                    tags=["test", "api"],
                ),
            ],
            "frontend": [
                Task(
                    id="",
                    title="Design component structure",
                    description="Plan component hierarchy and state management",
                    priority="P0",
                    estimated_time="30min",
                    tags=["design", "frontend"],
                ),
                Task(
                    id="",
                    title="Implement components",
                    description="Create React/Vue components",
                    priority="P0",
                    estimated_time="2h",
                    tags=["frontend", "ui"],
                ),
                Task(
                    id="",
                    title="Add styling",
                    description="CSS/styling for components",
                    priority="P1",
                    estimated_time="1h",
                    tags=["frontend", "css"],
                ),
                Task(
                    id="",
                    title="Write component tests",
                    description="Unit tests for components",
                    priority="P1",
                    estimated_time="1h",
                    tags=["test", "frontend"],
                ),
            ],
            "general": [
                Task(
                    id="",
                    title="Analyze requirements",
                    description="Understand and document requirements",
                    priority="P0",
                    estimated_time="30min",
                    tags=["analysis"],
                ),
                Task(
                    id="",
                    title="Design solution",
                    description="Plan implementation approach",
                    priority="P0",
                    estimated_time="30min",
                    tags=["design"],
                ),
                Task(
                    id="",
                    title="Implement core functionality",
                    description="Build the main feature",
                    priority="P0",
                    estimated_time="2h",
                    tags=["implementation"],
                ),
                Task(
                    id="",
                    title="Write tests",
                    description="Unit and integration tests",
                    priority="P1",
                    estimated_time="1h",
                    tags=["test"],
                ),
                Task(
                    id="",
                    title="Documentation",
                    description="Update relevant documentation",
                    priority="P2",
                    estimated_time="30min",
                    tags=["docs"],
                ),
            ],
        },
        IntentType.FIX: {
            "general": [
                Task(
                    id="",
                    title="Reproduce the issue",
                    description="Confirm and understand the bug",
                    priority="P0",
                    estimated_time="15min",
                    tags=["debug"],
                ),
                Task(
                    id="",
                    title="Identify root cause",
                    description="Trace and find the source of the bug",
                    priority="P0",
                    estimated_time="30min",
                    tags=["debug", "analysis"],
                ),
                Task(
                    id="",
                    title="Implement fix",
                    description="Apply the fix for the issue",
                    priority="P0",
                    estimated_time="1h",
                    tags=["fix"],
                ),
                Task(
                    id="",
                    title="Write regression test",
                    description="Add test to prevent recurrence",
                    priority="P1",
                    estimated_time="30min",
                    tags=["test", "regression"],
                ),
            ],
        },
        IntentType.REFACTOR: {
            "general": [
                Task(
                    id="",
                    title="Analyze current code",
                    description="Understand existing implementation",
                    priority="P0",
                    estimated_time="30min",
                    tags=["analysis"],
                ),
                Task(
                    id="",
                    title="Plan refactoring",
                    description="Define target structure and approach",
                    priority="P0",
                    estimated_time="30min",
                    tags=["design"],
                ),
                Task(
                    id="",
                    title="Refactor code",
                    description="Apply refactoring changes",
                    priority="P0",
                    estimated_time="2h",
                    tags=["refactor"],
                ),
                Task(
                    id="",
                    title="Verify tests pass",
                    description="Ensure no regressions",
                    priority="P0",
                    estimated_time="30min",
                    tags=["test"],
                ),
            ],
        },
        IntentType.TEST: {
            "general": [
                Task(
                    id="",
                    title="Identify test gaps",
                    description="Analyze coverage and missing tests",
                    priority="P0",
                    estimated_time="30min",
                    tags=["analysis", "test"],
                ),
                Task(
                    id="",
                    title="Write unit tests",
                    description="Add missing unit tests",
                    priority="P0",
                    estimated_time="2h",
                    tags=["test", "unit"],
                ),
                Task(
                    id="",
                    title="Write integration tests",
                    description="Add integration/e2e tests",
                    priority="P1",
                    estimated_time="1h",
                    tags=["test", "integration"],
                ),
            ],
        },
    }

    def __init__(self, historical_context: Optional[List[Dict[str, Any]]] = None):
        """Initialize decomposer with optional historical context.

        Args:
            historical_context: Previous implementations from Semantic Brain
        """
        self.historical_context = historical_context or []

    def decompose(self, analysis: IntentAnalysis) -> List[Task]:
        """Decompose an intent analysis into executable tasks.

        Args:
            analysis: The intent analysis result

        Returns:
            List of tasks with dependencies set
        """
        # Get template tasks
        template_tasks = self._get_template_tasks(analysis)

        # Customize tasks based on analysis
        tasks = self._customize_tasks(template_tasks, analysis)

        # Assign unique IDs
        for i, task in enumerate(tasks, 1):
            task.id = f"task-{i}"

        return tasks

    def _get_template_tasks(self, analysis: IntentAnalysis) -> List[Task]:
        """Get template tasks based on intent type and scope."""
        intent_templates = self.TASK_TEMPLATES.get(analysis.type, {})

        # Try to get scope-specific template
        scope_tasks = intent_templates.get(analysis.scope)
        if scope_tasks:
            return [self._copy_task(t) for t in scope_tasks]

        # Fall back to general template
        general_tasks = intent_templates.get("general")
        if general_tasks:
            return [self._copy_task(t) for t in general_tasks]

        # Default minimal task list
        return [
            Task(
                id="",
                title="Analyze requirements",
                description=f"Understand: {analysis.description}",
                priority="P0",
                estimated_time="30min",
                tags=["analysis"],
            ),
            Task(
                id="",
                title="Implement solution",
                description=f"Build: {analysis.description}",
                priority="P0",
                estimated_time="2h",
                tags=["implementation"],
            ),
            Task(
                id="",
                title="Test and verify",
                description="Verify implementation works correctly",
                priority="P1",
                estimated_time="1h",
                tags=["test"],
            ),
        ]

    def _copy_task(self, task: Task) -> Task:
        """Create a copy of a task."""
        return Task(
            id=task.id,
            title=task.title,
            description=task.description,
            priority=task.priority,
            estimated_time=task.estimated_time,
            dependencies=list(task.dependencies),
            tags=list(task.tags),
        )

    def _customize_tasks(self, tasks: List[Task], analysis: IntentAnalysis) -> List[Task]:
        """Customize tasks based on the specific intent."""
        # Add keywords as tags
        for task in tasks:
            for keyword in analysis.keywords[:3]:
                if keyword not in task.tags:
                    task.tags.append(keyword)

        # Adjust priorities based on complexity
        if analysis.estimated_complexity == "high":
            # Add more planning time for complex tasks
            for task in tasks:
                if "analysis" in task.tags or "design" in task.tags:
                    task.estimated_time = self._increase_time(task.estimated_time)
        elif analysis.estimated_complexity == "low":
            # Simplify for simple tasks
            for task in tasks:
                task.estimated_time = self._decrease_time(task.estimated_time)

        return tasks

    def _increase_time(self, time_str: str) -> str:
        """Increase time estimate by 50%."""
        if "min" in time_str:
            minutes = int(time_str.replace("min", ""))
            new_minutes = int(minutes * 1.5)
            if new_minutes >= 60:
                return f"{new_minutes // 60}h"
            return f"{new_minutes}min"
        elif "h" in time_str:
            hours = float(time_str.replace("h", ""))
            return f"{hours * 1.5}h"
        return time_str

    def _decrease_time(self, time_str: str) -> str:
        """Decrease time estimate by 30%."""
        if "min" in time_str:
            minutes = int(time_str.replace("min", ""))
            new_minutes = max(15, int(minutes * 0.7))
            return f"{new_minutes}min"
        elif "h" in time_str:
            hours = float(time_str.replace("h", ""))
            new_hours = max(0.5, hours * 0.7)
            if new_hours < 1:
                return f"{int(new_hours * 60)}min"
            return f"{new_hours}h"
        return time_str
