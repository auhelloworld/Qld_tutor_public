# Reliability, evidence, and write-safety guarantees

The [implementation-ready audit plan](../final-audit-and-plan.md#10-implementation-ready-plan) has been applied. The code and current schemas remain authoritative; the resulting runtime contracts are:

## Durable content and runtime validation

- **Bank Review separates editing from production writes.** Saving edits updates only the temporary review session. Writing a bank or imported exam requires a separate, parent-authorized confirmation, strict revalidation at the durable boundary, and a verified backup before atomic replacement of an existing file. Invalid content is rejected; backup failure leaves the original bytes unchanged; reload failure returns a non-success response with truthful backup/reload status. Multi-file appends are atomic per file, not a distributed transaction: if a later file fails, earlier successful file replacements are not rolled back. See [Bank Review](../bank-review.md).
- Active exercise records are validated with the canonical `ExerciseItem` contract before indexing. Drafts remain unavailable, and malformed active records are quarantined rather than delivered or counted as available. Content availability includes health-safe skipped IDs/counts, while `/api/health` exposes the skipped-invalid count without answer content.
- Nested sub-parts enforce choice/key agreement, marks/rubric consistency, and supported diagram contracts. Main and Guided pickers use actual active-bank availability, so empty senior shells are not presented as ordinary practice scopes.

## Learning evidence and assessment finality

- **Independent evidence is stricter than supported learning.** Error Book retry, transfer, consolidation, independent accuracy, quests, extension advice, mastery, prerequisite unlocks, forward-topic skipping, and initial revision scheduling require real scored support-level `0` evidence with no Show Answer/reveal provenance. Mastery additionally requires the one mastery rule: at least four such first answers, three right in the last four (a right answer marked `guess` does not count), and BKT at the mastery threshold without time decay; only the first answer to each question counts toward these. Error Book transfer and consolidation need a first try (`first_attempt` is not `false`) with no guess. Supported successes may still inform the general BKT trajectory and supported-progress feedback, but support levels `1`–`4` cannot close an independent stage or override a weak independent pattern. Missing legacy support metadata is not promoted to independent evidence, and versioned mistake-state derivation rebuilds stale materialized rows idempotently.
- Parent review of a provisional mock-exam response reconciles the exact stored attempt with its completed exam result, then recomputes question/part scores, totals, bands, and final/provisional state. Legacy sessions use only a conservative subject/question/saved-response match; ambiguous matches remain unchanged. Reconciliation is idempotent.
- An undersized Writing draft returns **Not yet scorable** expansion guidance without a percentage, band, or numeric zero. It is not stored in the portfolio, consumed as a revision iteration, or used as the next revision anchor. Revision comparison remains text-level and counts only non-empty sentence fragments.

## Scoped workflows and imported papers

- Full Exercise and Guided Practice apply the same minimum self-explanation quality floor and attach accepted explanations to the exact returned `attempt_id`. Multi-part momentum advances once per completed root question rather than once per sub-part.
- Parent recommendations retain subject plus year/unit/syllabus scope, pending-review queries are filtered server-side, and Writing history is separate from exam history. Strongest-area and extension claims require sufficient independent evidence; optional taxonomy failures do not hide the rest of the dashboard.
- Imported papers have a stable paper fingerprint. Reopening the same paper/configuration resumes its original deadline and saved responses; a different paper starts separately. Scoped history identifies the paper and exam type and shows provisional/final status. In-progress pages preserve page-hide saving and register the browser unload warning.

## Untrusted prompts, course metadata, and housekeeping

- Student-controlled Writing, PSMT, dialogue-history, and stuck-classifier text is sanitized and wrapped in application-owned boundaries before LLM use. Injected boundary markers cannot escape those blocks; PSMT uses a formative, QCAA-criteria-specific system instruction rather than a single-correct-answer grading instruction. Typed parsing, safe fallback, and redaction remain in force.
- Senior-course registry, curriculum shells, bank-path policy, and ingestion use canonical framework/subject/year-or-unit/topic metadata and shared provider selection. Empty shells remain non-selectable until active authored content exists.
- Diagnostic reporting avoids presenting one strand posterior as several precise topic estimates. Abandoned incomplete generated-exam sessions are pruned after 30 days; completed history and resumable recent sessions are retained.
- Pytest redirects SQLite, logs, Writing history, and `credentials.json` to per-test temporary storage. Installation credentials are excluded from copied fixture data, so focused and full suites do not read or modify the real credential file. Standard-practice network failures have a focused retry regression test.
