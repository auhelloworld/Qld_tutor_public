# Operations

## Docker Compose

```bash
cp .env.example .env
# set a real LLM_API_KEY or blank it for mock mode; also edit CORS_ORIGINS, JWT_SECRET, and PARENT_PASSWORD
docker compose up --build -d
```

The supplied service runs Next.js and FastAPI in one container. The only host mapping is:

- Frontend and API entry point: `http://localhost:9527`
- Weekly learning review: `http://localhost:9527/weekly-report`
- Same-origin API namespace: `http://localhost:9527/api`

The browser never connects to FastAPI directly. Next.js rewrites `/api/*` inside the container to `http://127.0.0.1:8000/api/*`, and Uvicorn listens only on that container loopback address. Port `9528` is not published and should be removed from host-firewall and cloud-security-group rules.

The default `9527:3000` mapping publishes on all host interfaces. It is accepted for this installation's controlled non-public LAN/VPN use, but it is **not** suitable for direct internet exposure. Internet deployment requires a separate, reviewed boundary including host firewall policy, HTTPS termination, hardened identity/API authorization, registration controls, secret rotation, and global LLM-abuse limits; those controls are outside this deployment profile.

### Startup, health, and credentials

- If `data/credentials.json` does not exist, the entrypoint atomically creates the valid empty store `{}`. A legacy blank file is treated as empty; non-empty malformed JSON still fails closed and is never overwritten silently.
- Uvicorn starts first. During FastAPI startup, the backend applies idempotent SQLite schema upgrades, creates missing indexes, and backfills newly indexed Error Book link columns before accepting normal traffic. This changes schema/index metadata only as required and does not delete attempt history. The entrypoint then waits up to 120 seconds for `http://127.0.0.1:8000/api/ready` before starting Node.
- `/api/health` is a lightweight process liveness endpoint and reports separate counts for invalid exercise records and exercise-bank files that could not be loaded. `/api/ready` additionally requires a non-empty exercise snapshot, zero skipped-invalid active records, zero unreadable/malformed/non-array `data/exercise_*.json` files, writable runtime data, and a readable/writable SQLite database. A single broken bank file therefore keeps the deployment unready instead of silently serving a partial bank.
- Compose uses `/api/ready` for its healthcheck, with a 120-second startup allowance. `init: true`, TERM/INT forwarding, sibling shutdown, child reaping, and a 30-second stop grace period give both Uvicorn and Node a bounded shutdown path.

Rebuild and verify a deployment with:

```bash
docker compose build tutor
docker compose up -d --force-recreate tutor
docker compose ps tutor  # PORTS should publish 9527 only; STATUS should become healthy
curl -fsS http://127.0.0.1:9527/api/health
curl -fsS http://127.0.0.1:9527/api/ready
curl -fsS http://127.0.0.1:9527/today >/dev/null
curl -fsS http://127.0.0.1:9527/weekly-report >/dev/null
curl -I http://127.0.0.1:9527/
```

A direct request to `http://127.0.0.1:9528/api/health` should fail to connect. For a remote non-public host, set `CORS_ORIGINS` to the exact frontend origin, for example `http://SERVER_IP:9527`, and expose port `9527` only to the trusted LAN/VPN. The `data/` bind mount persists the database, logs, credentials, content approvals, and imported exams. Compose also mounts the repository's entire `frontend/public/` directory read-only at `/app/frontend/public`, so new or replaced public assets are visible to the running frontend without rebuilding the image (use a new filename when browser-cache invalidation matters).

### Runtime backups and rollback

The repository includes `scripts/manage_data_backup.py`, a stopped-service backup/verify/restore CLI for mutable runtime data. It uses SQLite's backup API for `qld_tutor.db` and includes `credentials.json`, `content_approvals.yaml`, `logs/`, and `exams/` when present. Versioned curriculum and exercise files are intentionally excluded. Each snapshot contains a SHA-256 `manifest.json`; the application must be stopped while creating or restoring a snapshot, and the CLI requires the explicit `--confirm-app-stopped` flag.

Create a recovery point before upgrades or manual runtime-data changes. Build the image first so the one-off container contains the current tool, stop the application, then run:

```bash
docker compose build tutor
docker compose stop tutor
docker compose run --rm --no-deps --entrypoint python tutor \
  scripts/manage_data_backup.py backup \
  --data-dir /app/data \
  --output-dir /app/data/backups \
  --confirm-app-stopped
```

The command prints the created directory, for example `/app/data/backups/qld-tutor-20260822T120000Z`. Verify a snapshot before relying on it:

```bash
docker compose run --rm --no-deps --entrypoint python tutor \
  scripts/manage_data_backup.py verify \
  /app/data/backups/<qld-tutor-backup-directory>
```

Restore only while the application is stopped:

```bash
docker compose stop tutor
docker compose run --rm --no-deps --entrypoint python tutor \
  scripts/manage_data_backup.py restore \
  /app/data/backups/<qld-tutor-backup-directory> \
  --data-dir /app/data \
  --confirm-app-stopped
docker compose up -d --force-recreate tutor
```

Restore verifies the manifest first, removes stale destination WAL/SHM files, and moves replaced runtime data into a timestamped `data/backups/restore-rollback-*` directory. This rollback directory is local protection, not a second disaster-recovery copy. Copy verified snapshots to a different physical device or trusted backup system, encrypt that off-host copy, and protect it like student records and credentials. The Compose `data/` bind mount persists runtime data, but it does not create backups by itself.

Bank Review's durable **Save bank** and **Save exam** paths are separate from full-host backup: when replacing an existing JSON file they create and byte-verify a neighbouring `.bak` before atomic replacement, and refuse the write if that backup cannot be verified. This per-file safeguard is not a disaster-recovery copy.

## Data reset

Stopping the application and deleting the database/log files resets learning progress:

```bash
rm -f data/qld_tutor.db data/qld_tutor.db-wal data/qld_tutor.db-shm
rm -rf data/logs/
```

This is destructive and does not delete `data/credentials.json`; remove or replace that file separately only when you intentionally want to reset registered accounts. Back up `data/` first.
