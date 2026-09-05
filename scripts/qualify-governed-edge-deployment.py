#!/usr/bin/env python3
"""Qualify the exact governed Production Edge deployment that may trigger runtime acceptance.

This script is intentionally standalone and uses only the Python standard library so the
GitHub Actions workflow does not depend on indentation-sensitive embedded Python heredocs.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

DEPLOY_JOB_NAME = "Deploy · governed Edge Functions"
REQUIRED_STEPS = (
    "Verify current main is the quality-approved candidate",
    "Revalidate governed Edge candidate",
    "Reverify remote main immediately before Production mutation",
    "Deploy governed functions",
)


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def qualify(payload: dict[str, Any], *, expected_sha: str, expected_run_id: int,
            upstream_conclusion: str, upstream_event: str, upstream_branch: str) -> tuple[bool, bool, str]:
    """Return (accept, not_applicable, reason) for one upstream deployment run."""
    accept = False
    not_applicable = False
    reason = "governed deployment provenance was not established"

    if upstream_event != "workflow_run":
        reason = (
            f"upstream deploy workflow was triggered by {upstream_event!r}, "
            "not trusted Master workflow_run"
        )
    elif upstream_branch != "main":
        reason = f"upstream deploy workflow branch is {upstream_branch!r}, not main"
    elif upstream_conclusion == "skipped":
        not_applicable = True
        reason = (
            "upstream deploy workflow was skipped; no Production Edge mutation occurred "
            "and runtime acceptance is not applicable"
        )
    elif upstream_conclusion != "success":
        reason = f"upstream deploy workflow conclusion is {upstream_conclusion!r}, not success"
    else:
        deploy_jobs = [
            job for job in payload.get("jobs", [])
            if job.get("name") == DEPLOY_JOB_NAME
        ]
        if len(deploy_jobs) != 1:
            reason = "governed deploy job was not uniquely present"
        else:
            job = deploy_jobs[0]
            steps = {step.get("name"): step for step in job.get("steps", [])}
            missing_or_failed = [
                name for name in REQUIRED_STEPS
                if steps.get(name, {}).get("conclusion") != "success"
            ]
            if job.get("run_id") != expected_run_id:
                reason = "deploy job run_id does not match the triggering workflow run"
            elif job.get("head_sha") != expected_sha:
                reason = "deploy job SHA does not match workflow_run.head_sha"
            elif job.get("conclusion") == "skipped":
                not_applicable = True
                reason = (
                    "governed deploy job was skipped; no Production Edge mutation occurred "
                    "and runtime acceptance is not applicable"
                )
            elif job.get("conclusion") != "success":
                reason = f"deploy job conclusion is {job.get('conclusion')!r}, not success"
            elif missing_or_failed:
                reason = f"required deploy steps did not complete successfully: {missing_or_failed}"
            else:
                accept = True
                reason = "governed Edge deployment and exact-SHA guards completed successfully"

    return accept, not_applicable, reason


def main() -> int:
    try:
        jobs_json = Path(_required_env("JOBS_JSON"))
        expected_sha = _required_env("DEPLOYED_SHA")
        expected_run_id_raw = _required_env("UPSTREAM_RUN_ID")
        upstream_conclusion = _required_env("UPSTREAM_CONCLUSION")
        upstream_event = _required_env("UPSTREAM_EVENT")
        upstream_branch = _required_env("UPSTREAM_BRANCH")
        github_output = Path(_required_env("GITHUB_OUTPUT"))

        if len(expected_sha) != 40 or any(ch not in "0123456789abcdef" for ch in expected_sha):
            raise ValueError("DEPLOYED_SHA must be exactly 40 lowercase hexadecimal characters")
        if not expected_run_id_raw.isdigit():
            raise ValueError("UPSTREAM_RUN_ID must be numeric")

        with jobs_json.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("JOBS_JSON must contain a JSON object")

        accept, not_applicable, reason = qualify(
            payload,
            expected_sha=expected_sha,
            expected_run_id=int(expected_run_id_raw),
            upstream_conclusion=upstream_conclusion,
            upstream_event=upstream_event,
            upstream_branch=upstream_branch,
        )

        with github_output.open("a", encoding="utf-8") as output:
            output.write(f"accept={'true' if accept else 'false'}\n")
            if accept:
                output.write(f"deployed_sha={expected_sha}\n")

        if not_applicable:
            print(reason)
            return 0
        if not accept:
            print(f"::error::{reason}")
            return 1

        print(reason)
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"::error::governed deployment provenance validation failed: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
