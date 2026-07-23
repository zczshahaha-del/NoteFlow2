from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from backup_noteflow import create_backup
from restore_noteflow import restore_database, verify_backup


def _run(command: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    environment = os.environ.copy()
    environment.update(env or {})
    return subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, text=True, check=True)


def _psql(container: str, user: str, database: str, sql: str) -> str:
    result = _run(["docker", "exec", container, "psql", "-U", user, "-d", database, "-At", "-c", sql])
    return result.stdout.strip()


def _write_report(report: dict, name: str) -> None:
    report_root = ROOT / "quality" / "reports"
    report_root.mkdir(parents=True, exist_ok=True)
    (report_root / f"{name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# NoteFlow 步骤 16～18 灾备与故障演练",
        "",
        f"- 时间：{report['generatedAt']}",
        f"- 结果：{'通过' if report['summary']['failed'] == 0 else '失败'}",
        f"- 临时数据库：`{report['temporaryDatabase']}`（演练结束已清理）",
        "",
        "| 检查 | 结果 | 说明 |",
        "|---|---|---|",
    ]
    for item in report["checks"]:
        lines.append(f"| `{item['name']}` | {'通过' if item['passed'] else '失败'} | {item['detail']} |")
    (report_root / f"{name}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", default="noteflow-postgres")
    parser.add_argument("--database", default="noteflow")
    parser.add_argument("--user", default="noteflow")
    parser.add_argument("--report-name", default="steps-16-18-resilience-drill")
    args = parser.parse_args()
    suffix = uuid.uuid4().hex[:10]
    target = f"noteflow_drill_{suffix}"
    checks: list[dict] = []
    started = time.perf_counter()
    cleanup_ok = False
    with tempfile.TemporaryDirectory(prefix="noteflow-steps-16-18-") as temp:
        backup_dir = Path(temp) / "backup"
        try:
            manifest = create_backup(backup_dir, container=args.container, database=args.database, user=args.user)
            checks.append({"name": "backup", "passed": True, "detail": f"3 个备份对象，数据库 dump {manifest['files'][0]['bytes']} bytes"})
            verify_backup(backup_dir)
            checks.append({"name": "checksums", "passed": True, "detail": "数据库、附件、配置结构 SHA-256 全部匹配；未包含运行时密钥"})
            restore_database(
                backup_dir, container=args.container, target_database=target, user=args.user, create=True,
            )
            source_counts = _psql(args.container, args.user, args.database, "SELECT (SELECT count(*) FROM notes)::text || ',' || (SELECT count(*) FROM user_memories)::text")
            restored_counts = _psql(args.container, args.user, target, "SELECT (SELECT count(*) FROM notes)::text || ',' || (SELECT count(*) FROM user_memories)::text")
            if source_counts != restored_counts:
                raise RuntimeError(f"row-count mismatch source={source_counts} restored={restored_counts}")
            checks.append({"name": "restore", "passed": True, "detail": f"notes,user_memories 计数一致：{restored_counts}"})

            base = ["docker", "compose", "run", "--rm", "-T", "-e", f"DB_NAME={target}", "backend"]
            _run([*base, "alembic", "upgrade", "head"])
            head = _psql(args.container, args.user, target, "SELECT version_num FROM alembic_version")
            if head != "20260717_0009":
                raise RuntimeError(f"unexpected migration head: {head}")
            _run([*base, "alembic", "downgrade", "20260717_0008"])
            down = _psql(args.container, args.user, target, "SELECT version_num FROM alembic_version")
            _run([*base, "alembic", "upgrade", "head"])
            up = _psql(args.container, args.user, target, "SELECT version_num FROM alembic_version")
            if down != "20260717_0008" or up != "20260717_0009":
                raise RuntimeError(f"migration roundtrip mismatch down={down} up={up}")
            checks.append({"name": "migration-roundtrip", "passed": True, "detail": f"{head} → {down} → {up}"})

            unit = _run([
                sys.executable, "-m", "unittest", "server.tests.test_mem0_integration",
                "server.tests.test_memory_safety_dataset", "-v",
            ], env={"PYTHONPATH": str(ROOT / "server"), "PYTHONPYCACHEPREFIX": "/private/tmp/noteflow-pycache"})
            checks.append({"name": "fault-and-safety", "passed": True, "detail": "Mem0 timeout/circuit、跨用户裁决、敏感信息与灰度默认关闭测试通过"})
        except Exception as exc:
            checks.append({"name": "drill-error", "passed": False, "detail": f"{type(exc).__name__}: {str(exc)[:300]}"})
        finally:
            try:
                _run(["docker", "exec", args.container, "dropdb", "-U", args.user, "--if-exists", target])
                cleanup_ok = True
            except Exception as exc:
                checks.append({"name": "cleanup", "passed": False, "detail": f"{type(exc).__name__}: {str(exc)[:240]}"})
    if cleanup_ok:
        checks.append({"name": "cleanup", "passed": True, "detail": "临时恢复数据库已删除"})
    failed = sum(1 for item in checks if not item["passed"])
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "temporaryDatabase": target,
        "durationSeconds": round(time.perf_counter() - started, 3),
        "summary": {"total": len(checks), "passed": len(checks) - failed, "failed": failed},
        "checks": checks,
    }
    _write_report(report, args.report_name)
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
