# MXF Code Executor - Minimal Bun image for sandboxed code execution
# Provides secure, isolated execution environment with strict resource limits
#
# Security is enforced by Docker runtime constraints:
# - No network access (NetworkMode: none)
# - Read-only root filesystem (ReadonlyRootfs: true)
# - All capabilities dropped (CapDrop: ALL)
# - Non-root user
# - Memory and CPU limits
# - PID limit

FROM oven/bun:1.1-slim

# Create working directory
WORKDIR /app

# Copy executor script
COPY executor.ts /app/executor.ts

# Security: Set restrictive permissions
# The Bun slim image already has a user with UID/GID 1000 (bun)
RUN chown -R 1000:1000 /app && \
    chmod -R 755 /app

# Switch to non-root user (bun user has UID 1000)
USER 1000:1000

# Entrypoint: Run the executor script
ENTRYPOINT ["bun", "run", "/app/executor.ts"]
