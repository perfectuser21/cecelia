"""CI Monitor - Monitor GitHub Actions workflow runs."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol

from src.intelligence.detector.base_monitor import (
    BaseMonitor,
    EventSeverity,
    EventType,
    MonitorEvent,
)


@dataclass
class WorkflowRun:
    """Represents a GitHub Actions workflow run."""

    run_id: int
    workflow_name: str
    branch: str
    status: str  # "completed", "in_progress", "queued"
    conclusion: Optional[str]  # "success", "failure", "cancelled", etc.
    error_message: Optional[str]
    html_url: str
    created_at: datetime
    updated_at: datetime
    head_sha: str
    repository: str


class GitHubClient(Protocol):
    """Protocol for GitHub API client."""

    async def get_workflow_runs(
        self,
        repo: str,
        status: Optional[str] = None,
        branch: Optional[str] = None,
        limit: int = 10,
    ) -> List[WorkflowRun]:
        """Get workflow runs from GitHub."""
        ...

    async def get_run_logs(self, repo: str, run_id: int) -> str:
        """Get logs for a workflow run."""
        ...


class CIMonitor(BaseMonitor):
    """Monitor for GitHub Actions CI failures."""

    def __init__(
        self,
        github_client: Optional[GitHubClient] = None,
        repositories: Optional[List[str]] = None,
        enabled: bool = True,
    ):
        """Initialize CI Monitor.

        Args:
            github_client: GitHub API client
            repositories: List of repositories to monitor (owner/repo format)
            enabled: Whether monitor is enabled
        """
        super().__init__(name="ci_monitor", enabled=enabled)
        self._github_client = github_client
        self._repositories = repositories or []

    async def check(self) -> List[MonitorEvent]:
        """Check for CI failures.

        Returns:
            List of CI failure events
        """
        if not self.enabled:
            return []

        if not self._github_client:
            return []

        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for repo in self._repositories:
            try:
                runs = await self._github_client.get_workflow_runs(
                    repo=repo,
                    status="completed",
                    limit=20,
                )

                for run in runs:
                    event_id = f"ci-{repo}-{run.run_id}"

                    # Skip if already processed
                    if self._is_processed(event_id):
                        continue

                    # Only process failures
                    if run.conclusion != "failure":
                        self._mark_processed(event_id)
                        continue

                    event = self._create_failure_event(run, repo, event_id)
                    self._record_event(event)
                    new_events.append(event)

            except Exception:
                # Log error but continue with other repos
                pass

        return new_events

    def _create_failure_event(
        self,
        run: WorkflowRun,
        repo: str,
        event_id: str,
    ) -> MonitorEvent:
        """Create a CI failure event.

        Args:
            run: Workflow run that failed
            repo: Repository name
            event_id: Unique event identifier

        Returns:
            MonitorEvent for the failure
        """
        return MonitorEvent(
            event_id=event_id,
            event_type=EventType.CI_FAILURE,
            severity=EventSeverity.HIGH,
            title=f"CI 失败: {run.workflow_name}",
            description=f"Workflow '{run.workflow_name}' 在分支 '{run.branch}' 失败\n"
                       f"错误: {run.error_message or '未知错误'}",
            source=self.name,
            timestamp=run.updated_at,
            metadata={
                "repository": repo,
                "workflow": run.workflow_name,
                "branch": run.branch,
                "run_id": run.run_id,
                "html_url": run.html_url,
                "head_sha": run.head_sha,
                "error_message": run.error_message,
            },
        )

    def check_sync(self, runs: List[Dict[str, Any]]) -> List[MonitorEvent]:
        """Synchronous check for testing.

        Args:
            runs: List of workflow run dictionaries

        Returns:
            List of CI failure events
        """
        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for run_data in runs:
            run = WorkflowRun(
                run_id=run_data["run_id"],
                workflow_name=run_data.get("workflow_name", "unknown"),
                branch=run_data.get("branch", "unknown"),
                status=run_data.get("status", "completed"),
                conclusion=run_data.get("conclusion"),
                error_message=run_data.get("error_message"),
                html_url=run_data.get("html_url", ""),
                created_at=run_data.get("created_at", datetime.utcnow()),
                updated_at=run_data.get("updated_at", datetime.utcnow()),
                head_sha=run_data.get("head_sha", ""),
                repository=run_data.get("repository", ""),
            )

            event_id = f"ci-{run.repository}-{run.run_id}"

            if self._is_processed(event_id):
                continue

            if run.conclusion != "failure":
                self._mark_processed(event_id)
                continue

            event = self._create_failure_event(run, run.repository, event_id)
            self._record_event(event)
            new_events.append(event)

        return new_events
