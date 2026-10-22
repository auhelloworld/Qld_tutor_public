# README documentation

The root [`README.md`](../../README.md) is the concise project entry point. The detailed material formerly kept in that file is organised here by audience and task. Commands in these documents are run from the repository root unless a command explicitly changes directory.

## Topics

| Document | Use it for |
| --- | --- |
| [Workflows](workflows.md) | Student workflows, daily study, weekly reports, diagnostics, exams, Writing Hub, parent tools, Bank Review, Maths Lab, and Science Lab. |
| [Reliability](reliability.md) | Evidence semantics, durable writes, assessment finality, scoped workflows, prompt boundaries, metadata, and test isolation. |
| [Content and authoring](content.md) | Current authored-content inventory, schemas, question families, stimulus rules, and authoring references. |
| [Architecture](architecture.md) | Runtime architecture, trust boundaries, persistence, migration, and repository layout. |
| [Development and configuration](development.md) | Local installation, startup, environment variables, mock mode, marking, and LLM failure handling. |
| [Operations](operations.md) | Docker Compose deployment, health checks, backups, rollback, and data reset. |
| [Verification](verification.md) | Test tiers, content gates, and production-bound iterative audit procedures. |
| [Limitations](limitations.md) | Deployment scope, product boundaries, content coverage, and known evidence limitations. |

## Related repository documentation

- [Content authoring guides](../content_authoring/)
- [Bank Review durability notes](../bank-review.md)
- [LLM runtime audit](../llm-runtime-audit.md)
- [Adding senior courses](../adding-senior-courses.md)

The code, schemas, current data files, and runtime behaviour remain authoritative. Historical audit and implementation-plan documents provide supporting context and should not be treated as current runtime specifications.
