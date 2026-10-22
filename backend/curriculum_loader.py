"""Curriculum_Store loader.

Implements design §3.9 and §5 of the curriculum-framework-foundation spec.
The :class:`CurriculumLoader` owns disk reads of every Framework_Slice file
under ``data/curriculum/`` and exposes:

- :meth:`CurriculumLoader.load_slice` — read a single slice file and return
  it validated as a :class:`FrameworkSliceFile`.
- :meth:`CurriculumLoader.load_topic` — find a single topic by Topic_Id,
  walking the owning framework's slice files.
- :meth:`CurriculumLoader.load_unified_view` — produce the backward-compat
  ``{subject: {year_or_unit: {topic_id: payload, "sequence": [...]}}}``
  shape consumed by ``GET /api/curriculum``.
- :meth:`CurriculumLoader.query_topics_for_year10` — gather AC9 Year 10
  topics plus optional QCAA Senior Unit 1 previews per the dual-visibility
  algorithm (Design §5; Req 11).

Cross-slice invariants enforced inside :meth:`load_unified_view`:

- elaboration-id uniqueness across every loaded slice (Req 4.8).
- supplementary-resource-id uniqueness across every loaded slice (Req 5.10).

Caching strategy: the loader caches each slice keyed by its absolute path
together with a SHA-256 content hash of the file. A subsequent call reads
the file, recomputes the hash, and returns the cached
:class:`FrameworkSliceFile` when the hash is unchanged. This is robust
against ``mtime`` regressions caused by ``git checkout`` or filesystem
snapshot restores. Concurrent access is serialised by an
:class:`~threading.RLock`.

This module deliberately ships with zero LLM-, network-, or AI-SDK imports
(consistent with the registry in ``backend/curriculum_frameworks.py``).
"""

from __future__ import annotations

import hashlib
import json
import warnings
from pathlib import Path
from threading import RLock
from typing import Any

from backend.curriculum_frameworks import (
    Framework,
    FRAMEWORKS,
    get_framework,
    get_framework_for_topic_id,
    iter_frameworks,
)
from core.schema.curriculum_schema import FrameworkSliceFile, SubjectTopic


# Repo-relative path to the canonical Curriculum_Store root. Computed once at
# import time so callers that use the default constructor always read from
# the same location regardless of the current working directory.
#
# Layout: ``backend/curriculum_loader.py`` → ``parents[1]`` is the repo root
# (the directory containing ``backend/`` and ``data/``).
_DEFAULT_STORE_ROOT: Path = (
    Path(__file__).resolve().parents[1] / "data" / "curriculum"
)


class CurriculumLoader:
    """Mtime-cached reader for the on-disk Curriculum_Store."""

    def __init__(self, store_root: Path | None = None) -> None:
        """Initialise with the directory containing per-framework slice dirs.

        ``store_root`` defaults to the repo's ``data/curriculum/`` directory
        regardless of the caller's current working directory. Tests pass an
        explicit path to point at a temporary store.
        """
        self._root: Path = (
            Path(store_root) if store_root is not None else _DEFAULT_STORE_ROOT
        )
        self._lock = RLock()
        self._cache: dict[Path, tuple[str, FrameworkSliceFile]] = {}
        # Memoised unified view, keyed by the combined content fingerprint of
        # every slice file that fed it. Rebuilding the view costs ~50 ms while
        # re-reading and hashing all slices costs ~4 ms, so the fingerprint is
        # recomputed on each call and only a real content change rebuilds.
        self._unified_view: tuple[str, dict[str, Any]] | None = None
        # Serialised body + strong ETag for the unified view, memoised under the
        # same fingerprint so HTTP revalidation never re-serialises ~3 MB.
        self._unified_payload: tuple[str, str, str] | None = None
        # Scope payloads retain only the selected subject/year-or-unit content
        # plus a tiny all-scope key skeleton needed by the frontend picker.
        self._scoped_payloads: dict[tuple[str, str], tuple[str, str, str]] = {}

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _load_with_mtime_cache(self, path: Path) -> FrameworkSliceFile:
        """Read + validate the slice at ``path``, reusing the cache by content hash.

        The cache key is the path itself. On cache hit we still read the
        file and recompute its SHA-256 hash, so any content change
        (including ``git checkout``, which may not update ``mtime``)
        invalidates the cached entry.

        Raises :class:`FileNotFoundError` when the file does not exist; the
        caller decides whether to swallow it (e.g. the unified-view walk
        skips non-existent slice directories silently).
        """
        with self._lock:
            raw = path.read_bytes()  # raises FileNotFoundError naturally
            content_hash = hashlib.sha256(raw).hexdigest()
            cached = self._cache.get(path)
            if cached is not None and cached[0] == content_hash:
                return cached[1]
            data = json.loads(raw)
            slice_obj = FrameworkSliceFile.model_validate(data)
            self._cache[path] = (content_hash, slice_obj)
            return slice_obj

    @staticmethod
    def _sort_keys_recursive(value: Any) -> Any:
        """Return ``value`` with every dict key sorted at every level.

        Lists keep their element order (sequence ordering is meaningful for
        ``CurriculumSequence.sequence``); nested dicts are reconstructed
        with sorted keys. Used by :meth:`load_unified_view` to enforce the
        unified-view-determinism invariant (Req 12.8).
        """
        if isinstance(value, dict):
            return {
                k: CurriculumLoader._sort_keys_recursive(value[k])
                for k in sorted(value.keys())
            }
        if isinstance(value, list):
            return [CurriculumLoader._sort_keys_recursive(v) for v in value]
        return value

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_slice(
        self,
        framework_id: str,
        year_or_subject: int | str,
    ) -> FrameworkSliceFile:
        """Read the slice file owned by ``framework_id`` for ``year_or_subject``.

        For ACARA frameworks, ``year_or_subject`` is the year level (an int
        7–10, or a stringified equivalent), and the file is
        ``<slice_directory>/year<n>.json``. For QCAA Senior frameworks,
        ``year_or_subject`` is the syllabus subject (e.g. ``"methods"``) and
        the file is ``<slice_directory>/<syllabus_subject>.json``.

        Raises :class:`KeyError` when ``framework_id`` is not registered and
        :class:`FileNotFoundError` when the slice file does not exist.
        """
        framework = get_framework(framework_id)
        if framework.jurisdiction == "ACARA":
            path = (
                self._root
                / framework.slice_directory
                / f"year{int(year_or_subject)}.json"
            )
        else:
            path = (
                self._root
                / framework.slice_directory
                / f"{year_or_subject}.json"
            )
        return self._load_with_mtime_cache(path)

    def load_topic(self, topic_id: str) -> SubjectTopic | None:
        """Return the topic with the given Topic_Id, or ``None``.

        Two distinct ``None`` cases (both surface to callers identically):

        - ``topic_id`` is not accepted by any registered framework's
          validator (no framework matches).
        - ``topic_id`` is accepted by some framework's validator, but the
          owning slice does not contain that Topic_Id (validator-accepts-
          but-slice-missing per Req 9.1a; e.g. ``AC9M8N01`` in Phase 1
          where the AC9 Maths Year 8 slice has not been migrated yet).
        """
        fw_id = get_framework_for_topic_id(topic_id)
        if fw_id is None:
            return None
        framework = get_framework(fw_id)
        slice_dir = self._root / framework.slice_directory
        if not slice_dir.exists():
            return None
        for slice_path in sorted(slice_dir.glob("*.json")):
            try:
                slice_obj = self._load_with_mtime_cache(slice_path)
            except FileNotFoundError:
                # Race with a concurrent rename/delete — treat as absent
                # rather than crashing the request.
                continue
            for topic in slice_obj.topics:
                if topic.topic_id == topic_id:
                    return topic
        return None

    def load_unified_view(self) -> dict[str, Any]:
        """Project every registered framework's slices into a unified dict.

        Shape (Req 12.2 / 12.3):

        - For ACARA frameworks::

              view[<subject_suffix>][f"year{n}"] = {
                  "<topic_id>": {... topic dict ...},
                  ...,
                  "sequence": [<topic_id>, ...],
              }

        - For QCAA Senior frameworks::

              view[f"senior_{<syllabus_subject>}"][f"unit{n}"] = {
                  "<topic_id>": {... topic dict ...},
                  ...,
                  "sequence": [<topic_id>, ...],   # per-unit ordering
              }

        Cross-slice invariants are enforced during the walk:

        - duplicate ``elaboration_id`` across any pair of topics raises
          ``ValueError`` (Req 4.8).
        - duplicate ``resource_id`` across any pair of topics raises
          ``ValueError`` (Req 5.10).

        The result is recursively sorted by key so two consecutive calls
        on identical inputs return JSON-equivalent payloads (unified-view-
        determinism invariant — Req 12.8).
        """
        fingerprint = self._slice_fingerprint()
        with self._lock:
            memo = self._unified_view
        if memo is not None and memo[0] == fingerprint:
            return memo[1]

        view: dict[str, Any] = {}
        seen_elaboration_ids: set[str] = set()
        seen_resource_ids: set[str] = set()

        for framework in FRAMEWORKS.values():
            slice_dir = self._root / framework.slice_directory
            if not slice_dir.exists():
                # Empty content shells are allowed by Req 2.7, and Phase 1
                # ships with several frameworks whose slice directory has
                # not yet been created on disk. Skip silently.
                continue
            for slice_path in sorted(slice_dir.glob("*.json")):
                try:
                    slice_obj = self._load_with_mtime_cache(slice_path)
                except FileNotFoundError:
                    continue

                self._check_unique_ids(
                    slice_obj,
                    seen_elaboration_ids,
                    seen_resource_ids,
                )
                self._project_slice_into_view(
                    view, framework, slice_path, slice_obj
                )

        sorted_view = self._sort_keys_recursive(view)
        with self._lock:
            self._unified_view = (fingerprint, sorted_view)
        return sorted_view

    def unified_view_payload(self) -> tuple[str, str]:
        """Return ``(json_body, etag)`` for the unified view.

        Both are memoised under the slice-content fingerprint, so repeated HTTP
        requests neither rebuild the view nor re-serialise/re-hash the body.
        """
        fingerprint = self._slice_fingerprint()
        with self._lock:
            memo = self._unified_payload
        if memo is not None and memo[0] == fingerprint:
            return memo[1], memo[2]

        view = self.load_unified_view()
        body = json.dumps(view, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
        etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest() + '"'
        with self._lock:
            self._unified_payload = (fingerprint, body, etag)
        return body, etag

    def scoped_view_payload(self, subject: str, scope: str) -> tuple[str, str]:
        """Return one curriculum scope while retaining the global picker shape.

        Every subject and year/unit key is present as an empty mapping, but only
        ``subject/scope`` contains topic payloads. This keeps the existing picker
        able to switch scope without transferring the complete curriculum.
        """
        subject_key = str(subject).strip()
        scope_key = str(scope).strip()
        fingerprint = self._slice_fingerprint()
        cache_key = (subject_key, scope_key)
        with self._lock:
            memo = self._scoped_payloads.get(cache_key)
        if memo is not None and memo[0] == fingerprint:
            return memo[1], memo[2]

        view = self.load_unified_view()
        subject_scopes = view.get(subject_key)
        if not isinstance(subject_scopes, dict) or scope_key not in subject_scopes:
            raise KeyError(f"unknown curriculum scope {subject_key}/{scope_key}")

        scoped_view: dict[str, dict[str, Any]] = {
            current_subject: {
                current_scope: {}
                for current_scope in scopes
            }
            for current_subject, scopes in view.items()
            if isinstance(scopes, dict)
        }
        scoped_view[subject_key][scope_key] = subject_scopes[scope_key]
        body = json.dumps(
            scoped_view,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
        )
        etag = '"' + hashlib.sha256(body.encode("utf-8")).hexdigest() + '"'
        with self._lock:
            self._scoped_payloads[cache_key] = (fingerprint, body, etag)
        return body, etag

    def _slice_fingerprint(self) -> str:
        """Return a SHA-256 digest over every slice file's path and content.

        Content-based (not ``mtime``-based) so ``git checkout`` and snapshot
        restores invalidate the memo, matching :meth:`_load_with_mtime_cache`.
        """
        digest = hashlib.sha256()
        for framework in FRAMEWORKS.values():
            slice_dir = self._root / framework.slice_directory
            if not slice_dir.exists():
                continue
            for slice_path in sorted(slice_dir.glob("*.json")):
                try:
                    payload = slice_path.read_bytes()
                except OSError:
                    continue
                digest.update(str(slice_path).encode("utf-8"))
                digest.update(b"\x00")
                digest.update(hashlib.sha256(payload).digest())
        return digest.hexdigest()

    # ------------------------------------------------------------------
    # Unified-view helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _check_unique_ids(
        slice_obj: FrameworkSliceFile,
        seen_elaboration_ids: set[str],
        seen_resource_ids: set[str],
    ) -> None:
        """Enforce elaboration-id and resource-id uniqueness across slices.

        Empty / null elaboration_ids do not contribute (a topic with no
        elaborations or with empty-string ids is a no-op for the uniqueness
        check). The relevant Pydantic models already constrain
        ``elaboration_id`` and ``resource_id`` to non-empty strings during
        per-slice validation, so the empty-string guard here is belt-and-
        braces — it stops the cross-slice walk from rejecting an otherwise
        valid slice file solely because two of its topics happen to lack
        elaborations.
        """
        for topic in slice_obj.topics:
            for elab in topic.elaborations:
                eid = elab.elaboration_id
                if not eid:
                    continue
                if eid in seen_elaboration_ids:
                    raise ValueError(
                        f"duplicate elaboration_id {eid!r} encountered "
                        f"while loading slice for framework "
                        f"{slice_obj.framework_id!r}"
                    )
                seen_elaboration_ids.add(eid)
            for resource in topic.supplementary_resources:
                rid = resource.resource_id
                if not rid:
                    continue
                if rid in seen_resource_ids:
                    raise ValueError(
                        f"duplicate resource_id {rid!r} encountered while "
                        f"loading slice for framework "
                        f"{slice_obj.framework_id!r}"
                    )
                seen_resource_ids.add(rid)

    @staticmethod
    def _project_slice_into_view(
        view: dict[str, Any],
        framework: Framework,
        slice_path: Path,
        slice_obj: FrameworkSliceFile,
    ) -> None:
        """Insert ``slice_obj`` into ``view`` per the projection rules.

        See :meth:`load_unified_view` for the shape contract.
        """
        if framework.jurisdiction == "ACARA":
            year_key = slice_path.stem  # "year7", "year8", ...
            subject_key = framework.subject_suffix
            year_block: dict[str, Any] = view.setdefault(
                subject_key, {}
            ).setdefault(year_key, {})
            year_block["sequence"] = list(slice_obj.sequence.sequence)
            for topic in slice_obj.topics:
                year_block[topic.topic_id] = topic.model_dump(mode="json")
            return

        # QCAA Senior: top-level subject key is derived per-topic from each
        # topic's ``syllabus_subject`` so a single slice file (named
        # ``methods.json`` etc.) can in principle contain multiple subjects.
        # Per-unit sequence is the in-document order of topics with that
        # ``unit`` value.
        for topic in slice_obj.topics:
            subject_key = f"senior_{topic.syllabus_subject}"
            unit_key = f"unit{topic.unit}"
            unit_block: dict[str, Any] = view.setdefault(
                subject_key, {}
            ).setdefault(unit_key, {})
            unit_block[topic.topic_id] = topic.model_dump(mode="json")

        # Build a sequence per (subject, unit) pair seen in this slice.
        unit_subject_pairs: set[tuple[str, int]] = {
            (t.syllabus_subject, t.unit) for t in slice_obj.topics
        }
        for syllabus_subject, unit_num in unit_subject_pairs:
            ordered = [
                t.topic_id
                for t in slice_obj.topics
                if t.syllabus_subject == syllabus_subject and t.unit == unit_num
            ]
            view[f"senior_{syllabus_subject}"][f"unit{unit_num}"][
                "sequence"
            ] = ordered

    # ------------------------------------------------------------------
    # Year 10 dual-visibility (Design §5 / Req 11)
    # ------------------------------------------------------------------

    def query_topics_for_year10(
        self,
        previewed_senior_subjects: list[str],
    ) -> list[dict[str, Any]]:
        """Return AC9 Year 10 topics plus optional Senior Unit 1 previews.

        Algorithm (Design §5):

        1. For every AC9 framework with a ``year10.json`` slice on disk,
           load it and emit every topic whose ``year_level == 10``
           (no-other-AC9-year invariant — Req 11.4).
        2. For each previewed senior subject (lowercased and stripped):
           - Look up the Senior framework whose ``supported_subjects``
             contains the normalised subject.
           - Unknown subject → ``warnings.warn(f"unknown senior subject
             {subject!r}")`` and skip (Req 11.7).
           - Otherwise load ``<slice_directory>/<subject>.json`` and emit
             every topic whose ``unit == 1`` (no-other-senior-unit
             invariant — Req 11.5).
        3. Dedup by ``topic_id`` (Req 11.6) preserving first-seen order
           (AC9 first, then senior in the input list's order).

        On any IO/parse failure we ``warnings.warn`` and continue with what
        has loaded so far (Req 11.8). Network/IO ``FileNotFoundError`` for a
        missing slice is treated as "no content yet" without warning,
        matching the empty-shell convention in Req 2.7.
        """
        out: list[dict[str, Any]] = []
        seen: set[str] = set()

        # Step 1: AC9 Year 10
        for framework in iter_frameworks():
            if framework.jurisdiction != "ACARA":
                continue
            try:
                slice_obj = self.load_slice(framework.framework_id, 10)
            except FileNotFoundError:
                # Empty-shell — Req 11.8 graceful, no warning.
                continue
            except Exception as exc:  # parse/validation failures
                warnings.warn(
                    "failed to load Year 10 slice for "
                    f"{framework.framework_id}: {exc}"
                )
                continue
            for topic in slice_obj.topics:
                year_level = getattr(topic, "year_level", None)
                if year_level != 10:
                    continue  # Req 11.4
                if topic.topic_id in seen:
                    continue
                seen.add(topic.topic_id)
                out.append(topic.model_dump(mode="json"))

        # Step 2: Senior Unit 1 previews
        for raw_subject in previewed_senior_subjects:
            try:
                normalised = raw_subject.strip().lower()
            except AttributeError:
                # Defensive: a non-string slipped through. Surface a warning
                # and skip rather than crashing the whole call.
                warnings.warn(
                    f"non-string senior subject {raw_subject!r} — ignored"
                )
                continue

            senior_framework = self._find_senior_framework_for_subject(
                normalised
            )
            if senior_framework is None:
                warnings.warn(
                    f"unknown senior subject {raw_subject!r}"
                )
                continue

            try:
                slice_obj = self.load_slice(
                    senior_framework.framework_id, normalised
                )
            except FileNotFoundError:
                # Empty-shell: no warning, just nothing to preview.
                continue
            except Exception as exc:
                warnings.warn(
                    "failed to load senior slice "
                    f"{senior_framework.framework_id}/{normalised}: {exc}"
                )
                continue

            for topic in slice_obj.topics:
                unit = getattr(topic, "unit", None)
                if unit != 1:
                    continue  # Req 11.5
                if topic.topic_id in seen:
                    continue  # Req 11.6
                seen.add(topic.topic_id)
                out.append(topic.model_dump(mode="json"))

        return out

    @staticmethod
    def _find_senior_framework_for_subject(
        normalised_subject: str,
    ) -> Framework | None:
        """Return the Senior framework owning ``normalised_subject``, or None."""
        for framework in iter_frameworks():
            if framework.jurisdiction != "QCAA-Senior":
                continue
            if normalised_subject in framework.supported_subjects:
                return framework
        return None


_SHARED_LOADER: "CurriculumLoader | None" = None
_SHARED_LOADER_GUARD = RLock()


def get_shared_loader() -> "CurriculumLoader":
    """Return the process-wide loader for the default curriculum store.

    Every :class:`~backend.rules.StudyRuleEngine` used to build its own loader,
    so each cached engine retained a private copy of every parsed slice
    (~0.9 MB per slice). Callers that read the default store share one instance;
    tests and staged-content callers still pass an explicit ``store_root``.
    """
    global _SHARED_LOADER
    with _SHARED_LOADER_GUARD:
        if _SHARED_LOADER is None:
            _SHARED_LOADER = CurriculumLoader()
        return _SHARED_LOADER


__all__ = ["CurriculumLoader", "get_shared_loader"]
