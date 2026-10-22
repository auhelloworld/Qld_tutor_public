"""Test-only utilities for resetting module-level caches.

NOT for production use. Import only in test fixtures.
"""


def reset_engine_factory_cache():
    """Clear the engine factory cache and lock registry."""
    from backend.rules import _ENGINES, _ENGINES_GUARD, _LOCKS, _INITIALIZED_DBS, _DB_INIT_GUARD

    with _ENGINES_GUARD:
        _ENGINES.clear()
    _LOCKS.clear()
    # Forget one-time DB init so tests that rebuild a DB at the same path re-init.
    with _DB_INIT_GUARD:
        _INITIALIZED_DBS.clear()


def reset_tutor_engine():
    """Clear the tutor engine singleton cache."""
    import backend.tutor_engine as te
    te._tutor_engine = None
