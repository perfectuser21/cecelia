"""LLM Planner for Orchestrator - Convert TRD to Tasks."""

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.autumnrice.models import TRD, Task, generate_task_id


@dataclass
class PlanResult:
    """Result of planning operation."""
    success: bool
    tasks: List[Task]
    error: Optional[str] = None
    raw_output: Optional[str] = None


# Planner system prompt
PLANNER_SYSTEM_PROMPT = """你是 Orchestrator Planner，负责把 TRD（Technical Requirement Document）拆解成可执行的 Task 列表。

## 输出格式（必须是严格 JSON）

```json
{
  "tasks": [
    {
      "title": "任务标题",
      "description": "详细描述",
      "repo": "仓库路径",
      "branch": "分支名",
      "priority": "P0|P1|P2",
      "depends_on": ["前置任务 ID，空数组表示无依赖"],
      "acceptance": ["验收条件 1", "验收条件 2"]
    }
  ]
}
```

## 拆解原则

1. **原子性**：每个 Task 应该能在一个 PR 内完成
2. **可验收**：每个 Task 必须有明确的验收条件
3. **依赖清晰**：depends_on 使用任务序号（如 "T-1"），无环
4. **优先级合理**：
   - P0: 阻塞主链路
   - P1: 核心功能
   - P2: 增强功能

## 分支命名

格式：`cp-{日期}-{功能名}`
例如：`cp-20260129-login-api`

## 注意事项

- 只输出 JSON，不要有其他文字
- tasks 数组不能为空
- 每个 task 必须有 repo 和 branch
- depends_on 引用的是任务在数组中的序号（从 1 开始）"""


class Planner:
    """LLM-based planner for converting TRD to Tasks."""

    def __init__(
        self,
        claude_path: Optional[str] = None,
        timeout_seconds: int = 120,
    ):
        """Initialize planner.

        Args:
            claude_path: Path to claude CLI (default: ~/.local/bin/claude)
            timeout_seconds: Timeout for LLM calls
        """
        self.claude_path = claude_path or str(Path.home() / ".local" / "bin" / "claude")
        self.timeout = timeout_seconds

    def plan(self, trd: TRD, context: Optional[Dict[str, Any]] = None) -> PlanResult:
        """Plan TRD into Tasks.

        Args:
            trd: TRD to plan
            context: Optional context (projects, existing tasks, etc.)

        Returns:
            PlanResult with tasks or error
        """
        # Build prompt
        prompt = self._build_prompt(trd, context)

        # Call LLM
        try:
            output = self._call_llm(prompt)
        except Exception as e:
            return PlanResult(
                success=False,
                tasks=[],
                error=f"LLM call failed: {str(e)}",
            )

        # Parse output
        try:
            tasks = self._parse_output(output, trd.id)
            return PlanResult(
                success=True,
                tasks=tasks,
                raw_output=output,
            )
        except Exception as e:
            return PlanResult(
                success=False,
                tasks=[],
                error=f"Failed to parse LLM output: {str(e)}",
                raw_output=output,
            )

    def _build_prompt(self, trd: TRD, context: Optional[Dict[str, Any]] = None) -> str:
        """Build prompt for LLM."""
        prompt_parts = [
            PLANNER_SYSTEM_PROMPT,
            "",
            "## TRD 信息",
            "",
            f"**ID**: {trd.id}",
            f"**标题**: {trd.title}",
            f"**描述**: {trd.description}",
            f"**涉及项目**: {', '.join(trd.projects) if trd.projects else '未指定'}",
            "",
            "**验收标准**:",
        ]

        for criterion in trd.acceptance_criteria:
            prompt_parts.append(f"- {criterion}")

        if context:
            prompt_parts.extend([
                "",
                "## 上下文",
                "",
            ])
            if context.get("projects"):
                prompt_parts.append("**可用项目**:")
                for proj in context["projects"]:
                    prompt_parts.append(f"- {proj}")

        prompt_parts.extend([
            "",
            "请根据以上 TRD 生成 Task 列表（JSON 格式）。",
        ])

        return "\n".join(prompt_parts)

    def _call_llm(self, prompt: str) -> str:
        """Call LLM using Claude CLI."""
        # Write prompt to temp file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write(prompt)
            prompt_file = f.name

        try:
            result = subprocess.run(
                f'cat "{prompt_file}" | {self.claude_path} -p - --output-format text',
                shell=True,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )

            if result.returncode != 0:
                raise RuntimeError(f"Claude CLI failed: {result.stderr}")

            return result.stdout.strip()

        finally:
            Path(prompt_file).unlink(missing_ok=True)

    def _parse_output(self, output: str, trd_id: str) -> List[Task]:
        """Parse LLM output to Task list."""
        import re

        # Extract JSON from output
        json_match = re.search(r"\{[\s\S]*\}", output)
        if not json_match:
            raise ValueError("No JSON found in output")

        data = json.loads(json_match.group())

        if "tasks" not in data:
            raise ValueError("Missing 'tasks' key in output")

        tasks = []
        task_id_map = {}  # Map sequence number to actual task ID

        for i, task_data in enumerate(data["tasks"], 1):
            task_id = generate_task_id()
            task_id_map[f"T-{i}"] = task_id
            task_id_map[str(i)] = task_id

            task = Task(
                id=task_id,
                trd_id=trd_id,
                title=task_data.get("title", ""),
                description=task_data.get("description", ""),
                repo=task_data.get("repo", ""),
                branch=task_data.get("branch", ""),
                priority=task_data.get("priority", "P1"),
                depends_on=[],  # Will resolve after all tasks created
                acceptance=task_data.get("acceptance", []),
            )
            tasks.append(task)

        # Resolve dependencies
        for i, task_data in enumerate(data["tasks"]):
            deps = task_data.get("depends_on", [])
            resolved_deps = []
            for dep in deps:
                if dep in task_id_map:
                    resolved_deps.append(task_id_map[dep])
            tasks[i].depends_on = resolved_deps

        return tasks

    def validate_tasks(self, tasks: List[Task]) -> List[str]:
        """Validate generated tasks.

        Args:
            tasks: Tasks to validate

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        if not tasks:
            errors.append("No tasks generated")
            return errors

        task_ids = {t.id for t in tasks}

        for task in tasks:
            # Check required fields
            if not task.title:
                errors.append(f"Task {task.id}: missing title")
            if not task.repo:
                errors.append(f"Task {task.id}: missing repo")
            if not task.branch:
                errors.append(f"Task {task.id}: missing branch")
            if not task.acceptance:
                errors.append(f"Task {task.id}: missing acceptance criteria")

            # Check dependencies exist
            for dep in task.depends_on:
                if dep not in task_ids:
                    errors.append(f"Task {task.id}: invalid dependency {dep}")

        # Check for cycles
        from src.autumnrice.state_machine import StateMachine
        sm = StateMachine()
        is_valid, cycle_nodes = sm.validate_no_cycles(tasks)
        if not is_valid:
            errors.append(f"Dependency cycle detected: {cycle_nodes}")

        return errors
