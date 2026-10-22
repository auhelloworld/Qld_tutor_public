"""QCAA Senior Mathematics migration stub (Phase 1).

Running this script exits with status 1 and prints a not-implemented
message to stderr. The empty-shell slice files required by the loader
are produced by ``bootstrap_senior_shells.py``, not by this stub.

Implements design §3.7 of the curriculum-framework-foundation spec.
"""

from backend.migrations.base import SeniorMigrationStub


class QCAASeniorMathsMigration(SeniorMigrationStub):
    def framework_id(self) -> str:
        return "QCAA_SENIOR_MATHS"


if __name__ == "__main__":
    QCAASeniorMathsMigration().run()
