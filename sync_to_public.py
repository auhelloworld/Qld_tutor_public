#!/usr/bin/env python3
"""
sync_to_public.py — Qld_tutor 双仓同步：自用仓（private）→ 公开仓（public）

作用
----
把自用版工作区镜像同步到公开仓 clone，并在公开侧自动：
  1) 跳过私有专属路径（Mathspace 配图目录、scratch、.env、credentials、运行时 DB 等）
  2) 过滤所有 data/**/*.json 题库数组里的 Mathspace 记录
     （判定：id 含 "_ms_"，或 topic 含 "Mathspace"，或整条记录序列化后含 "mathspace"）
  3) 同步完成后全文扫描公开仓，只要还有 "mathspace" 字样（白名单除外）
     就以非零码退出并列出文件 —— 扫不干净绝不提交、绝不推送
  4) 默认只做到“改好公开仓工作区 + 打印 git status”，不自动 commit/push；
     加 --commit 才提交，加 --push 才推送

为什么
------
自用版含从 Mathspace 并入的题目（题干 + steps + 配图），不能公开发布、
更不能被 MIT 覆盖。公开仓只发代码 + 自有题。本脚本是唯一的同步通道，
不要再手工往公开仓拷文件。

用法
----
  # 日常同步（改好公开仓，你自己检查 diff 后手工 commit/push）
  python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor

  # 只演练：不写任何文件，只报告会剔除多少条、会跳过哪些路径
  python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor --dry-run

  # 同步 + 提交 + 推送（一键，慎用；扫描不过会自动中止，不会推送）
  python3 sync_to_public.py --source ~/Qld_tutor_private --dest ~/Qld_tutor \
      --commit "sync: public snapshot $(date +%F)" --push

说明
----
- 题库 JSON 按原仓库格式写回（indent=2, ensure_ascii=False, 末尾换行），
  已验证与原文件逐字节一致的序列化方式，过滤只删 ms 记录、不动自有题格式。
- 公开仓独有的文件若不想被镜像删除，写进公开仓根目录的 .sync-keep
  （每行一个相对路径），脚本会保留它们。LICENSE 建议直接放自用仓根目录，
  随同步一起过去，保持单一来源。
- 依赖：仅 Python 3.10+ 标准库；commit/push 需要 git 在 PATH 中。
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 配置区（按需改这里，不要改逻辑）
# ---------------------------------------------------------------------------

# 永不同步到公开仓的路径（相对仓库根目录，支持 fnmatch 通配）
EXCLUDED_PATTERNS = [
    ".git", ".git/**",
    ".env", ".env.*", "**/.env", "**/.env.*",
    "data/credentials.json", "**/credentials.json",
    "scratch", "scratch/**",                      # 私人工作区，含源抽取文件
    "frontend/public/mathspace_images",            # Mathspace 配图（4300 个文件）
    "frontend/public/mathspace_images/**",
    "backend/venv", "backend/venv/**",
    "venv", "venv/**", ".venv", ".venv/**",
    "frontend/node_modules", "frontend/node_modules/**",
    "frontend/.next", "frontend/.next/**",
    "**/__pycache__", "**/__pycache__/**", "**/*.pyc",
    "**/*.db", "**/*.sqlite", "**/*.sqlite3",      # 运行时学生数据
    "**/*.log", ".DS_Store", "**/.DS_Store",
    "tests/unit/test_mathspace_graph_math.py",
    "frontend/src/__tests__/senior-worksheets-render.test.tsx",
    "iterative-question-bank-content-audit", "iterative-question-bank-content-audit/**",
    "qld-tutor-question-bank-generation", "qld-tutor-question-bank-generation/**",
    "qld-tutor-source-digest", "qld-tutor-source-digest/**",
    "tasks", "tasks/**",
]

# 全文扫描时允许出现 "mathspace" 的文件（相对公开仓根目录）
SCAN_ALLOWLIST = {
    "sync_to_public.py",        # 本脚本自身（判定规则里有这个词）
    "README-dual-repo.md",      # 双仓说明文档
    ".sync-keep",
}

SCAN_EXTENSIONS_EXCLUDED = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf",
    ".zip", ".gz", ".woff", ".woff2", ".ttf", ".mp4", ".webp",
}

BANNED_WORD = "mathspace"


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def rel_match(rel: Path, patterns: list[str]) -> bool:
    """相对路径是否命中任一排除规则。"""
    s = rel.as_posix()
    parts = s.split("/")
    for pat in patterns:
        if fnmatch.fnmatch(s, pat):
            return True
        # 目录级命中：任一前缀目录命中也排除（如 "scratch" 命中 scratch/**）
        for i in range(1, len(parts)):
            if fnmatch.fnmatch("/".join(parts[:i]), pat):
                return True
    return False


def is_mathspace_item(item: object) -> bool:
    """一条题库记录是否为 Mathspace 来源。宁严勿漏：整条序列化后含关键词即算。"""
    if not isinstance(item, dict):
        return False
    if "_ms_" in str(item.get("id", "")):
        return True
    if BANNED_WORD in str(item.get("topic", "")).lower():
        return True
    try:
        return BANNED_WORD in json.dumps(item, ensure_ascii=False).lower()
    except (TypeError, ValueError):
        return False


def run_git(dest: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(dest), *args],
        capture_output=True, text=True, check=check,
    )


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="自用仓 → 公开仓 过滤同步")
    ap.add_argument("--source", required=True, help="自用仓工作区路径（private）")
    ap.add_argument("--dest", required=True, help="公开仓 clone 路径（public）")
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写任何文件")
    ap.add_argument("--commit", metavar="MSG", help="同步后用该信息提交（默认不提交）")
    ap.add_argument("--push", action="store_true", help="提交后推送（必须同时给 --commit）")
    ap.add_argument("--force", action="store_true",
                    help="公开仓有未提交改动时也继续（默认拒绝，防覆盖手工改动）")
    args = ap.parse_args()

    source = Path(args.source).expanduser().resolve()
    dest = Path(args.dest).expanduser().resolve()

    if args.push and not args.commit:
        print("错误：--push 必须同时提供 --commit", file=sys.stderr)
        return 2
    if not source.is_dir():
        print(f"错误：source 不存在：{source}", file=sys.stderr)
        return 2
    if not dest.is_dir() or not (dest / ".git").exists():
        print(f"错误：dest 不是一个 git clone：{dest}", file=sys.stderr)
        return 2
    if source == dest:
        print("错误：source 与 dest 不能相同", file=sys.stderr)
        return 2

    # 公开仓有未提交改动时默认停手，避免镜像删除把手工改动吞掉
    if not args.dry_run and not args.force:
        dirty = run_git(dest, "status", "--porcelain").stdout.strip()
        if dirty:
            print("错误：公开仓有未提交改动，先处理（commit/stash）或加 --force：\n"
                  + dirty[:2000], file=sys.stderr)
            return 2

    # 公开仓独有保留清单
    keep: set[str] = set()
    keep_file = dest / ".sync-keep"
    if keep_file.exists():
        keep = {ln.strip() for ln in keep_file.read_text(encoding="utf-8").splitlines()
                if ln.strip() and not ln.strip().startswith("#")}

    stats = {"copied": 0, "deleted": 0, "skipped": 0,
             "items_removed": 0, "files_filtered": 0}

    # ---- 1) 镜像复制（source → dest，带排除） -------------------------------
    source_files: set[str] = set()
    for path in sorted(source.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(source)
        if rel_match(rel, EXCLUDED_PATTERNS):
            stats["skipped"] += 1
            continue
        source_files.add(rel.as_posix())
        target = dest / rel
        if args.dry_run:
            stats["copied"] += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or path.read_bytes() != target.read_bytes():
            shutil.copy2(path, target)
            stats["copied"] += 1

    # ---- 2) 镜像删除（dest 里 source 没有的文件删掉，白名单除外） ---------
    if not args.dry_run:
        for path in sorted(dest.rglob("*"), reverse=True):
            if ".git" in path.relative_to(dest).parts or path.is_dir():
                continue
            rel = path.relative_to(dest)
            s = rel.as_posix()
            if s in keep or s in SCAN_ALLOWLIST:
                continue
            if s not in source_files and not rel_match(rel, EXCLUDED_PATTERNS):
                path.unlink()
                stats["deleted"] += 1
        # 清理空目录（.git 除外）
        for path in sorted((p for p in dest.rglob("*") if p.is_dir()),
                           key=lambda p: len(p.parts), reverse=True):
            if ".git" in path.relative_to(dest).parts:
                continue
            try:
                path.rmdir()  # 仅当为空时成功
            except OSError:
                pass
    else:
        for path in sorted(dest.rglob("*")):
            if ".git" in path.relative_to(dest).parts or path.is_dir():
                continue
            s = path.relative_to(dest).as_posix()
            if s not in source_files and s not in keep and s not in SCAN_ALLOWLIST:
                stats["deleted"] += 1

    # ---- 3) 过滤公开侧题库 JSON ---------------------------------------------
    data_root = (source if args.dry_run else dest) / "data"
    if data_root.is_dir():
        for jf in sorted(data_root.rglob("*.json")):
            # 在 dry-run 下读 source 原文件计数；在正式模式下过滤 dest 里已拷好的文件
            try:
                raw = jf.read_text(encoding="utf-8")
                data = json.loads(raw)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, list) or not data or not isinstance(data[0], dict):
                continue
            kept = [it for it in data if not is_mathspace_item(it)]
            removed = len(data) - len(kept)
            if removed == 0:
                continue
            stats["items_removed"] += removed
            stats["files_filtered"] += 1
            print(f"  过滤 {jf.relative_to(data_root.parent)}: "
                  f"{len(data)} → {len(kept)}（剔除 {removed}）")
            if not args.dry_run:
                out = json.dumps(kept, indent=2, ensure_ascii=False) + "\n"
                jf.write_text(out, encoding="utf-8")

    # ---- 4) 全文扫描验证（正式模式扫 dest；dry-run 只扫内存中的题库逻辑已在上步完成） --
    scan_hits: list[str] = []
    if not args.dry_run:
        for path in sorted(dest.rglob("*")):
            if path.is_dir() or ".git" in path.relative_to(dest).parts:
                continue
            rel = path.relative_to(dest).as_posix()
            if rel in SCAN_ALLOWLIST or path.suffix.lower() in SCAN_EXTENSIONS_EXCLUDED:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="strict")
            except (OSError, UnicodeDecodeError):
                continue
            if BANNED_WORD in text.lower():
                scan_hits.append(rel)

    print("\n同步报告")
    print(f"  复制/更新文件 : {stats['copied']}")
    print(f"  镜像删除文件  : {stats['deleted']}")
    print(f"  跳过私有路径  : {stats['skipped']}")
    print(f"  过滤题库文件  : {stats['files_filtered']} 个，"
          f"共剔除 Mathspace 记录 {stats['items_removed']} 条")

    if args.dry_run:
        print("  [dry-run] 未写入任何文件。")
        return 0

    if scan_hits:
        print("\n✗ 全文扫描未过：公开仓以下文件仍含 'mathspace' 字样，"
              "先人工处理（多为 docs 计数、审计报告、生成目录），脚本未提交：",
              file=sys.stderr)
        for h in scan_hits:
            print(f"    - {h}", file=sys.stderr)
        return 1
    print("  ✓ 全文扫描：公开仓无 'mathspace' 残留")

    # ---- 5) 可选提交 / 推送 ---------------------------------------------------
    status = run_git(dest, "status", "--porcelain").stdout.strip()
    if not status:
        print("  公开仓无变化，无需提交。")
        return 0
    print("  公开仓变更概览（前 30 行）：")
    print("\n".join("    " + ln for ln in status.splitlines()[:30]))

    if not args.commit:
        print("\n未提交。检查无误后手工 git -C <dest> add -A && commit，或下次带 --commit 运行。")
        return 0

    run_git(dest, "add", "-A")
    run_git(dest, "commit", "-m", args.commit)
    print(f"  ✓ 已提交：{args.commit}")
    if args.push:
        run_git(dest, "push")
        print("  ✓ 已推送")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
