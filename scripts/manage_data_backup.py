#!/usr/bin/env python3
"""Create, verify, and restore consistent QLD Tutor runtime-data snapshots.

Backups intentionally contain mutable student/runtime data rather than the
versioned exercise bank. Run backup/restore while the tutor container is
stopped so SQLite and the adjacent JSON histories represent one recovery point.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = PROJECT_ROOT / "data"
MUTABLE_ITEMS = (
    "credentials.json",
    "content_approvals.yaml",
    "logs",
    "exams",
)
DATABASE_FILES = ("qld_tutor.db", "qld_tutor.db-wal", "qld_tutor.db-shm")
MANIFEST_NAME = "manifest.json"
FORMAT_VERSION = 1


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_item(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise RuntimeError(f"Refusing to snapshot symlink: {source}")
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def _file_manifest(root: Path) -> dict[str, dict[str, int | str]]:
    files: dict[str, dict[str, int | str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise RuntimeError(f"Backup contains unsupported symlink: {path}")
        if not path.is_file() or path.name == MANIFEST_NAME:
            continue
        relative = path.relative_to(root).as_posix()
        files[relative] = {"size": path.stat().st_size, "sha256": _sha256(path)}
    return files


def verify_backup(backup_dir: Path) -> dict:
    backup_dir = backup_dir.resolve()
    manifest_path = backup_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise RuntimeError(f"Missing {MANIFEST_NAME} in {backup_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != FORMAT_VERSION:
        raise RuntimeError("Unsupported backup format version")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise RuntimeError("Backup manifest has no file map")

    for relative, expected in files.items():
        path = (backup_dir / relative).resolve()
        try:
            path.relative_to(backup_dir)
        except ValueError as exc:
            raise RuntimeError(f"Unsafe manifest path: {relative}") from exc
        if not path.is_file():
            raise RuntimeError(f"Backup file is missing: {relative}")
        if path.stat().st_size != expected.get("size"):
            raise RuntimeError(f"Backup size mismatch: {relative}")
        if _sha256(path) != expected.get("sha256"):
            raise RuntimeError(f"Backup checksum mismatch: {relative}")
    return manifest


def create_backup(data_dir: Path, output_dir: Path, confirm_stopped: bool) -> Path:
    if not confirm_stopped:
        raise RuntimeError("Refusing backup without --confirm-app-stopped")
    data_dir = data_dir.resolve()
    output_dir = output_dir.resolve()
    if not data_dir.is_dir():
        raise RuntimeError(f"Data directory does not exist: {data_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    final_dir = output_dir / f"qld-tutor-{_utc_stamp()}"
    if final_dir.exists():
        final_dir = output_dir / f"{final_dir.name}-{uuid.uuid4().hex[:8]}"
    partial_dir = Path(
        tempfile.mkdtemp(prefix=f".{final_dir.name}-", suffix=".partial", dir=output_dir)
    )

    try:
        database = data_dir / "qld_tutor.db"
        if database.exists():
            destination = partial_dir / "qld_tutor.db"
            source_uri = f"file:{database.as_posix()}?mode=ro"
            with sqlite3.connect(source_uri, uri=True, timeout=5.0) as source:
                with sqlite3.connect(destination) as target:
                    source.backup(target)
                    result = target.execute("PRAGMA quick_check").fetchone()
                    if not result or result[0] != "ok":
                        raise RuntimeError("SQLite backup failed quick_check")

        for relative in MUTABLE_ITEMS:
            source = data_dir / relative
            if source.exists():
                _copy_item(source, partial_dir / relative)

        manifest = {
            "format_version": FORMAT_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_data_dir": str(data_dir),
            "application_must_be_stopped": True,
            "files": _file_manifest(partial_dir),
        }
        manifest_path = partial_dir / MANIFEST_NAME
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        with manifest_path.open("rb") as handle:
            os.fsync(handle.fileno())
        os.replace(partial_dir, final_dir)
        verify_backup(final_dir)
        return final_dir
    except Exception:
        shutil.rmtree(partial_dir, ignore_errors=True)
        raise


def restore_backup(backup_dir: Path, data_dir: Path, confirm_stopped: bool) -> Path:
    if not confirm_stopped:
        raise RuntimeError("Refusing restore without --confirm-app-stopped")
    backup_dir = backup_dir.resolve()
    data_dir = data_dir.resolve()
    verify_backup(backup_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    stage = data_dir / f".restore-stage-{uuid.uuid4().hex}"
    rollback_root = data_dir / "backups" / f"restore-rollback-{_utc_stamp()}-{uuid.uuid4().hex[:8]}"
    stage.mkdir(parents=True)
    rollback_root.mkdir(parents=True)

    names = ("qld_tutor.db",) + MUTABLE_ITEMS
    moved_existing: list[str] = []
    installed: list[str] = []
    try:
        for relative in names:
            source = backup_dir / relative
            if source.exists():
                _copy_item(source, stage / relative)

        # WAL/SHM from the destination must never be paired with a restored DB.
        for relative in names + DATABASE_FILES[1:]:
            current = data_dir / relative
            if current.exists():
                target = rollback_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(current, target)
                moved_existing.append(relative)

        for relative in names:
            source = stage / relative
            if source.exists():
                os.replace(source, data_dir / relative)
                installed.append(relative)

        shutil.rmtree(stage, ignore_errors=True)
        return rollback_root
    except Exception:
        for relative in reversed(installed):
            current = data_dir / relative
            if current.is_dir():
                shutil.rmtree(current, ignore_errors=True)
            elif current.exists():
                current.unlink()
        for relative in reversed(moved_existing):
            rollback = rollback_root / relative
            if rollback.exists():
                (data_dir / relative).parent.mkdir(parents=True, exist_ok=True)
                os.replace(rollback, data_dir / relative)
        shutil.rmtree(stage, ignore_errors=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup = subparsers.add_parser("backup", help="create a runtime-data snapshot")
    backup.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    backup.add_argument("--output-dir", type=Path)
    backup.add_argument("--confirm-app-stopped", action="store_true")

    verify = subparsers.add_parser("verify", help="verify a snapshot manifest")
    verify.add_argument("backup_dir", type=Path)

    restore = subparsers.add_parser("restore", help="restore into a stopped installation")
    restore.add_argument("backup_dir", type=Path)
    restore.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    restore.add_argument("--confirm-app-stopped", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "backup":
            output_dir = args.output_dir or (args.data_dir / "backups")
            result = create_backup(args.data_dir, output_dir, args.confirm_app_stopped)
            print(result)
        elif args.command == "verify":
            manifest = verify_backup(args.backup_dir)
            print(
                json.dumps(
                    {
                        "status": "ok",
                        "created_at": manifest["created_at"],
                        "file_count": len(manifest["files"]),
                    }
                )
            )
        else:
            rollback = restore_backup(
                args.backup_dir,
                args.data_dir,
                args.confirm_app_stopped,
            )
            print(json.dumps({"status": "restored", "rollback_dir": str(rollback)}))
        return 0
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
