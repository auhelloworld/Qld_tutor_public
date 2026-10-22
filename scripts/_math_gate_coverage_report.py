#!/usr/bin/env python3
"""Measure deterministic maths-gate coverage across AC9 Y7-10 banks.

Uses scripts/audit_math_bank_full.verify_maths without rewriting the full audit suite.
Prints status/skill/type breakdowns and ranked expansion opportunities.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from audit_math_bank_full import (  # type: ignore
    load_exercises,
    meta,
    verify_maths,
)

YEARS = (7, 8, 9, 10)


def main() -> int:
    rows: list[dict] = []
    for year in YEARS:
        path = ROOT / "data" / f"exercise_{year}_math.json"
        if not path.is_file():
            print(f"missing {path}", file=sys.stderr)
            continue
        for ex in load_exercises(path):
            result = verify_maths(ex)
            m = meta(ex)
            rows.append({
                "year": year,
                "id": ex.get("id"),
                "question_type": str(ex.get("question_type") or "").lower(),
                "skill": str(m.get("skill") or result.skill or "unknown").lower().strip() or "unknown",
                "status": result.status,
                "confidence": result.confidence,
                "verifier_skill": result.skill,
                "evidence": (result.evidence or "")[:160],
                "has_diagram": bool(ex.get("diagram_data")),
                "has_steps": bool(ex.get("steps")),
            })

    n = len(rows)
    print(f"=== Maths gate coverage (verify_maths) ===")
    print(f"Active items audited: {n}")
    print()

    by_status = Counter(r["status"] for r in rows)
    print("Status distribution:")
    for status, count in by_status.most_common():
        print(f"  {status:16} {count:5}  {100*count/n:5.1f}%")
    print()

    actionable = by_status.get("verified", 0) + by_status.get("incorrect", 0)
    soft = by_status.get("likely_issue", 0) + by_status.get("parse_failed", 0)
    gap = by_status.get("inconclusive", 0) + by_status.get("unsupported", 0)
    print(f"Hard signal (verified+incorrect): {actionable} ({100*actionable/n:.1f}%)")
    print(f"Soft signal (likely_issue+parse_failed): {soft} ({100*soft/n:.1f}%)")
    print(f"No decision (inconclusive+unsupported): {gap} ({100*gap/n:.1f}%)")
    print()

    print("By year × status:")
    for year in YEARS:
        yr = [r for r in rows if r["year"] == year]
        if not yr:
            continue
        c = Counter(r["status"] for r in yr)
        hard = c.get("verified", 0) + c.get("incorrect", 0)
        print(
            f"  Y{year}: n={len(yr):4}  verified={c.get('verified',0):4}  "
            f"incorrect={c.get('incorrect',0):3}  likely={c.get('likely_issue',0):3}  "
            f"inconc={c.get('inconclusive',0):4}  unsup={c.get('unsupported',0):4}  "
            f"hard%={100*hard/len(yr):4.1f}"
        )
    print()

    print("By question_type × status:")
    for qtype, _ in Counter(r["question_type"] for r in rows).most_common():
        subset = [r for r in rows if r["question_type"] == qtype]
        c = Counter(r["status"] for r in subset)
        hard = c.get("verified", 0) + c.get("incorrect", 0)
        print(
            f"  {qtype or '?':16} n={len(subset):4}  "
            f"V={c.get('verified',0):4} I={c.get('incorrect',0):3} "
            f"L={c.get('likely_issue',0):3} Inc={c.get('inconclusive',0):4} "
            f"U={c.get('unsupported',0):4}  hard%={100*hard/len(subset):4.1f}"
        )
    print()

    # Gap ranking by authored skill metadata among inconclusive/unsupported
    gap_rows = [r for r in rows if r["status"] in {"inconclusive", "unsupported"}]
    skill_gap = Counter(r["skill"] for r in gap_rows)
    print("Top authored skills with NO hard decision (inconclusive+unsupported):")
    for skill, count in skill_gap.most_common(25):
        # also show how many of that skill are already verified/incorrect overall
        all_skill = [r for r in rows if r["skill"] == skill]
        hard_s = sum(1 for r in all_skill if r["status"] in {"verified", "incorrect"})
        print(
            f"  {count:4} gap / {len(all_skill):4} total  hard={hard_s:3}  skill={skill!r}"
        )
    print()

    # Among items that got a verifier skill but still inconclusive — parse/template gaps
    soft_inconc = [
        r for r in rows
        if r["status"] in {"inconclusive", "parse_failed"}
        and r["verifier_skill"] not in {"", "unknown"}
    ]
    verifier_soft = Counter(r["verifier_skill"] for r in soft_inconc)
    print("Existing verifiers that often return inconclusive/parse_failed (template expansion opportunity):")
    for skill, count in verifier_soft.most_common(20):
        all_v = [r for r in rows if r["verifier_skill"] == skill]
        hard_v = sum(1 for r in all_v if r["status"] in {"verified", "incorrect"})
        print(
            f"  soft={count:4}  total_routed={len(all_v):4}  hard={hard_v:4}  "
            f"hit%={100*hard_v/max(1,len(all_v)):5.1f}  skill={skill}"
        )
    print()

    incorrect = [r for r in rows if r["status"] == "incorrect"]
    print(f"Incorrect (deterministic) count: {len(incorrect)}")
    by_inc_skill = Counter(r["verifier_skill"] for r in incorrect)
    for skill, count in by_inc_skill.most_common(15):
        print(f"  {count:3}  {skill}")
    if incorrect:
        print("  sample ids:")
        for r in incorrect[:12]:
            print(f"    {r['id']}  skill={r['verifier_skill']}  {r['evidence'][:100]}")
    print()

    # Expansion candidates: large skill buckets with low hard-hit rate
    skill_total = Counter(r["skill"] for r in rows)
    candidates: list[tuple[float, str, int, int, float]] = []
    for skill, total in skill_total.items():
        if total < 15:
            continue
        hard = sum(
            1 for r in rows
            if r["skill"] == skill and r["status"] in {"verified", "incorrect"}
        )
        hit = hard / total
        # score = volume of remaining gap weighted by low hit rate
        gap_n = total - hard
        score = gap_n * (1.0 - hit)
        candidates.append((score, skill, total, hard, hit))
    candidates.sort(reverse=True)
    print("Ranked expansion opportunities (score = gap_count * (1 - hard_hit_rate), min 15 items):")
    for rank, (score, skill, total, hard, hit) in enumerate(candidates[:20], 1):
        print(
            f"  {rank:2}. score={score:6.1f}  n={total:4}  hard={hard:3}  "
            f"hit={100*hit:5.1f}%  gap={total-hard:4}  skill={skill!r}"
        )
    print()

    # Short answer alone — biggest LLM-saving pool
    sa = [r for r in rows if r["question_type"] == "short_answer"]
    sa_c = Counter(r["status"] for r in sa)
    print("Short-answer only (best gate ROI):")
    for status, count in sa_c.most_common():
        print(f"  {status:16} {count:5}  {100*count/len(sa):5.1f}%")
    sa_hard = sa_c.get("verified", 0) + sa_c.get("incorrect", 0)
    print(f"  hard signal: {sa_hard}/{len(sa)} ({100*sa_hard/len(sa):.1f}%)")
    print()

    out = ROOT / "audit_output" / "math_gate_coverage_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "n": n,
        "by_status": dict(by_status),
        "hard_pct": 100 * actionable / n if n else 0,
        "gap_pct": 100 * gap / n if n else 0,
        "top_gap_skills": skill_gap.most_common(30),
        "ranked_expansion": [
            {
                "skill": skill,
                "n": total,
                "hard": hard,
                "hit_pct": round(100 * hit, 1),
                "gap": total - hard,
                "score": round(score, 1),
            }
            for score, skill, total, hard, hit in candidates[:30]
        ],
        "incorrect_count": len(incorrect),
        "incorrect_sample": [
            {"id": r["id"], "skill": r["verifier_skill"], "evidence": r["evidence"]}
            for r in incorrect[:30]
        ],
    }
    out.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
