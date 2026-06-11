# Multi-stage build for MXF Server
# Build stage uses Bun for fast package installation
FROM oven/bun:1.3-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first so the dependency layer caches until a
# manifest changes. --frozen-lockfile needs every workspace package.json.
COPY package.json bun.lock* bun.lockb* ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/

# Install dependencies using Bun. --ignore-scripts: the build stage only needs
# tsc; skipping postinstalls avoids esbuild's binary version check (dev-only
# dep with two resolved versions) and the ink ansi patch (TUI, not built here).
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript
RUN bun run build

# Production stage uses Bun for consistent runtime
FROM oven/bun:1.3-slim

# Install runtime dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium fonts-freefont-ttf libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 libnss3 \
    libatk1.0-0 libatk-bridge2.0-0 libdrm2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copy package files and lockfile from builder. scripts/ must precede install:
# the repo postinstall runs scripts/patch-ansi-styles.js.
COPY package.json bun.lock* bun.lockb* ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY scripts ./scripts

# Install production dependencies with Bun
RUN bun install --production --frozen-lockfile

# Copy built application and workspace packages from builder. The app dist
# resolves @mxf-dev/core and @mxf-dev/sdk through the workspace symlinks; Bun's
# 'bun' export condition runs the package TS sources directly.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages ./packages

# Create necessary directories
RUN mkdir -p /app/logs /app/uploads

# Set proper permissions
RUN groupadd -r mxf && useradd -r -g mxf mxf && chown -R mxf:mxf /app

# Switch to non-root user
USER mxf

# Expose application port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1))"

# Start the application
CMD ["bun", "run", "dist/server/index.js"]
