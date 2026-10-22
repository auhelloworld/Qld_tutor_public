from __future__ import annotations

from pathlib import Path


def test_tmp_data_dir_uses_a_per_test_credential_path_and_excludes_installation_file(tmp_data_dir):
    """The data-copy fixture must never expose the installation credential store."""
    from backend.routers import auth as auth_router

    assert not (tmp_data_dir / "credentials.json").exists()
    assert Path(auth_router.CREDENTIALS_PATH) == tmp_data_dir / "credentials.json"


def test_global_fixture_redirects_credentials_without_tmp_data_dir(tmp_path):
    """Every test gets an isolated credential path, even without tmp_data_dir."""
    from backend.routers import auth as auth_router

    isolated_path = Path(auth_router.CREDENTIALS_PATH)
    assert isolated_path == tmp_path / "runtime-data" / "credentials.json"
    assert not isolated_path.exists()
