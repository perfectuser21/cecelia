"""Code Monitor - Monitor git commits and pull requests."""

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
class Commit:
    """Represents a git commit."""

    sha: str
    message: str
    author: str
    timestamp: datetime
    branch: str
    files_changed: List[str]
    additions: int
    deletions: int


@dataclass
class PullRequest:
    """Represents a pull request."""

    pr_id: int
    title: str
    author: str
    branch: str
    base_branch: str
    status: str  # "open", "closed", "merged"
    created_at: datetime
    updated_at: datetime
    files_changed: int
    commits_count: int
    html_url: str


class GitClient(Protocol):
    """Protocol for Git operations client."""

    async def get_recent_commits(
        self,
        repo: str,
        branch: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 10,
    ) -> List[Commit]:
        """Get recent commits."""
        ...

    async def get_pull_requests(
        self,
        repo: str,
        state: str = "open",
        limit: int = 10,
    ) -> List[PullRequest]:
        """Get pull requests."""
        ...


class CodeMonitor(BaseMonitor):
    """Monitor for code changes (commits and PRs)."""

    def __init__(
        self,
        git_client: Optional[GitClient] = None,
        repositories: Optional[List[str]] = None,
        enabled: bool = True,
    ):
        """Initialize Code Monitor.

        Args:
            git_client: Git API client
            repositories: List of repositories to monitor
            enabled: Whether monitor is enabled
        """
        super().__init__(name="code_monitor", enabled=enabled)
        self._git_client = git_client
        self._repositories = repositories or []
        self._last_commit_sha: Dict[str, str] = {}

    async def check(self) -> List[MonitorEvent]:
        """Check for new commits and PRs.

        Returns:
            List of code change events
        """
        if not self.enabled:
            return []

        if not self._git_client:
            return []

        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for repo in self._repositories:
            try:
                # Check commits
                commits = await self._git_client.get_recent_commits(
                    repo=repo,
                    limit=10,
                )

                for commit in commits:
                    event_id = f"commit-{repo}-{commit.sha[:8]}"

                    if self._is_processed(event_id):
                        continue

                    event = self._create_commit_event(commit, repo, event_id)
                    self._record_event(event)
                    new_events.append(event)

                # Check PRs
                prs = await self._git_client.get_pull_requests(
                    repo=repo,
                    state="open",
                    limit=10,
                )

                for pr in prs:
                    event_id = f"pr-{repo}-{pr.pr_id}"

                    if self._is_processed(event_id):
                        continue

                    event = self._create_pr_event(pr, repo, event_id)
                    self._record_event(event)
                    new_events.append(event)

            except Exception:
                pass

        return new_events

    def _create_commit_event(
        self,
        commit: Commit,
        repo: str,
        event_id: str,
    ) -> MonitorEvent:
        """Create a commit event.

        Args:
            commit: Commit data
            repo: Repository name
            event_id: Unique event identifier

        Returns:
            MonitorEvent for the commit
        """
        # Determine severity based on changes
        total_changes = commit.additions + commit.deletions
        if total_changes > 500:
            severity = EventSeverity.MEDIUM
        elif total_changes > 100:
            severity = EventSeverity.LOW
        else:
            severity = EventSeverity.INFO

        return MonitorEvent(
            event_id=event_id,
            event_type=EventType.CODE_PUSH,
            severity=severity,
            title=f"新提交: {commit.message[:50]}",
            description=f"分支: {commit.branch}\n"
                       f"作者: {commit.author}\n"
                       f"变更: +{commit.additions} -{commit.deletions}",
            source=self.name,
            timestamp=commit.timestamp,
            metadata={
                "repository": repo,
                "sha": commit.sha,
                "branch": commit.branch,
                "author": commit.author,
                "files_changed": commit.files_changed,
                "additions": commit.additions,
                "deletions": commit.deletions,
            },
        )

    def _create_pr_event(
        self,
        pr: PullRequest,
        repo: str,
        event_id: str,
    ) -> MonitorEvent:
        """Create a PR event.

        Args:
            pr: Pull request data
            repo: Repository name
            event_id: Unique event identifier

        Returns:
            MonitorEvent for the PR
        """
        return MonitorEvent(
            event_id=event_id,
            event_type=EventType.CODE_PR,
            severity=EventSeverity.INFO,
            title=f"PR: {pr.title}",
            description=f"分支: {pr.branch} -> {pr.base_branch}\n"
                       f"作者: {pr.author}\n"
                       f"文件变更: {pr.files_changed}, 提交: {pr.commits_count}",
            source=self.name,
            timestamp=pr.created_at,
            metadata={
                "repository": repo,
                "pr_id": pr.pr_id,
                "branch": pr.branch,
                "base_branch": pr.base_branch,
                "author": pr.author,
                "files_changed": pr.files_changed,
                "commits_count": pr.commits_count,
                "html_url": pr.html_url,
            },
        )

    def check_sync(self, commits: List[Dict[str, Any]]) -> List[MonitorEvent]:
        """Synchronous check for testing.

        Args:
            commits: List of commit dictionaries

        Returns:
            List of code change events
        """
        self._last_check = datetime.utcnow()
        new_events: List[MonitorEvent] = []

        for commit_data in commits:
            commit = Commit(
                sha=commit_data["sha"],
                message=commit_data.get("message", ""),
                author=commit_data.get("author", "unknown"),
                timestamp=commit_data.get("timestamp", datetime.utcnow()),
                branch=commit_data.get("branch", "main"),
                files_changed=commit_data.get("files_changed", []),
                additions=commit_data.get("additions", 0),
                deletions=commit_data.get("deletions", 0),
            )

            repo = commit_data.get("repository", "unknown")
            event_id = f"commit-{repo}-{commit.sha[:8]}"

            if self._is_processed(event_id):
                continue

            event = self._create_commit_event(commit, repo, event_id)
            self._record_event(event)
            new_events.append(event)

        return new_events
