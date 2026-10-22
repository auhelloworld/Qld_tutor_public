# ============================================================
# QLD AI Tutor — Multi-stage Docker Build
# Supports both amd64 and arm64 (Oracle ARM VPS)
# ============================================================

# --- Stage 1: Build frontend ---
FROM node:24-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --production=false
COPY frontend/ ./
# API traffic is same-origin in the browser and proxied by the Next.js server.
RUN npm run build

# --- Stage 2: Production image ---
FROM python:3.12-slim
WORKDIR /app

# Install Node.js for Next.js server
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python dependencies via pyproject.toml (sole source of truth)
COPY pyproject.toml /app/pyproject.toml
RUN pip install --no-cache-dir -e "."

# Copy application code
COPY backend/ /app/backend/
COPY core/ /app/core/
COPY data/ /app/data/
COPY scripts/manage_data_backup.py /app/scripts/manage_data_backup.py

# Copy the traced Next.js runtime instead of the complete build-time node_modules.
COPY --from=frontend-build /app/frontend/.next/standalone /app/frontend/
COPY --from=frontend-build /app/frontend/.next/static /app/frontend/.next/static
COPY --from=frontend-build /app/frontend/public /app/frontend/public

# Create data directories
RUN mkdir -p /app/data/logs /app/data/exams

# Expose ports
EXPOSE 8000 3000

# Start script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Create non-root user and set permissions for all files under /app
RUN groupadd -g 10001 tutorgroup && \
    useradd -u 10001 -g tutorgroup -d /app -s /sbin/nologin tutoruser && \
    chown -R tutoruser:tutorgroup /app

# NOTE: Running as root by default for VPS deployment compatibility.
# The data directory (bind-mounted from host) needs write access.
# If you prefer non-root, uncomment the USER line below and ensure
# the host's ./data directory is owned by UID 10001 (e.g. chown -R 10001:10001 data).
# USER tutoruser

ENTRYPOINT ["/app/docker-entrypoint.sh"]
