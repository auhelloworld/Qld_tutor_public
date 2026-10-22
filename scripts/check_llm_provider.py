"""Smoke-test the configured LLM provider contract.

This script is intentionally small and read-only: it does not touch student
logs. It checks whether the configured provider can support the JSON contracts
used by tutor marking, reasoning, and writing assessment.

Usage:
    backend/venv/Scripts/python.exe scripts/check_llm_provider.py
    backend/venv/bin/python scripts/check_llm_provider.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.routers.writing import _parse_writing_response
from backend.tutor_engine import TutorEngine
from core.schema.tutor_schema import MarkResult, ReasoningResult


def _result(name: str, ok: bool, detail: str, **extra: Any) -> dict[str, Any]:
    return {"name": name, "ok": ok, "detail": detail, **extra}


def _native_response_format_check(engine: TutorEngine) -> dict[str, Any]:
    try:
        response = engine.client.chat.completions.create(
            model=engine.default_model,
            messages=[{"role": "user", "content": 'Return exactly this JSON: {"ok": true}'}],
            temperature=0,
            timeout=engine._llm_timeout,
            response_format={"type": "json_object"},
            max_tokens=80,
        )
        raw = response.choices[0].message.content or ""
        parsed = json.loads(raw)
        return _result(
            "native_response_format",
            bool(parsed.get("ok")),
            "provider accepted response_format",
            raw_len=len(raw),
        )
    except Exception as exc:
        msg = str(exc).lower()
        unsupported = any(
            token in msg
            for token in ("response_format", "json_object", "unsupported parameter", "not supported", "json mode")
        )
        if unsupported:
            return _result(
                "native_response_format",
                True,
                "provider rejected response_format; app retry-without-response_format fallback should be used",
                native_supported=False,
            )
        return _result("native_response_format", False, f"{type(exc).__name__}: {exc}")


def _mark_contract_check(engine: TutorEngine) -> dict[str, Any]:
    fallback = MarkResult.fallback()
    result = engine._call_llm_safe(
        prompt=(
            "Return JSON for a marking result. Use this exact meaning: the answer is correct; "
            "feedback is 'Correct.'"
        ),
        expected_schema=MarkResult,
        fallback=fallback,
        response_format={"type": "json_object"},
        temp=0,
        max_tokens=300,
    )
    ok = result is not fallback and result.is_correct is True and bool(result.feedback)
    return _result("mark_result_schema", ok, "MarkResult parsed" if ok else "MarkResult fallback/parse failed")


def _reasoning_contract_check(engine: TutorEngine) -> dict[str, Any]:
    fallback = ReasoningResult.fallback(max_score=3, key_points=["identify", "justify", "conclude"])
    result = engine._call_llm_safe(
        prompt=(
            "Return JSON for a reasoning rubric result with score 3, max_score 3, "
            "feedback 'Clear reasoning.', and one met key point."
        ),
        expected_schema=ReasoningResult,
        fallback=fallback,
        response_format={"type": "json_object"},
        temp=0,
        max_tokens=500,
    )
    ok = result is not fallback and result.score >= 1 and result.max_score >= result.score and bool(result.feedback)
    return _result("reasoning_result_schema", ok, "ReasoningResult parsed" if ok else "ReasoningResult fallback/parse failed")


def _writing_contract_check(engine: TutorEngine) -> dict[str, Any]:
    try:
        raw = engine._call_llm(
            (
                "Return JSON only with criterion_scores as a list containing one item: "
                "criterion_number 1, score '4.0', max_score 6, feedback 'Good control.'"
            ),
            response_format={"type": "json_object"},
            temp=0,
            max_tokens=400,
            raise_on_error=True,
        )
        parsed = _parse_writing_response(raw)
        scores = parsed.get("criterion_scores") or []
        ok = bool(scores) and scores[0].get("score") == 4
        return _result("writing_json_contract", ok, "writing parser accepted provider output", raw_len=len(raw or ""))
    except Exception as exc:
        return _result("writing_json_contract", False, f"{type(exc).__name__}: {exc}")


def run_checks() -> dict[str, Any]:
    engine = TutorEngine()
    if engine.client is None:
        return {
            "configured": False,
            "model": engine.default_model,
            "checks": [_result("configuration", False, "No LLM API key configured; app will run in mock mode.")],
        }

    checks = [
        _native_response_format_check(engine),
        _mark_contract_check(engine),
        _reasoning_contract_check(engine),
        _writing_contract_check(engine),
    ]
    return {
        "configured": True,
        "model": engine.default_model,
        "checks": checks,
        "ok": all(check["ok"] for check in checks),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the configured LLM provider.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    report = run_checks()
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"LLM provider: {report['model']}")
        for check in report["checks"]:
            status = "PASS" if check["ok"] else "FAIL"
            print(f"[{status}] {check['name']}: {check['detail']}")

    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
