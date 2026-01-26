# Multi-stage build for MXF Server
# Build stage uses Bun for fast package installation
FROM oven/bun:1.1-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json bun.lock* bun.lockb* ./

# Install dependencies using Bun (fast)
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN bun run build

# Production stage uses Bun for consistent runtime
FROM oven/bun:1.1-slim

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

# Copy package files and lockfile from builder
COPY package.json bun.lock* bun.lockb* ./

# Install production dependencies with Bun
RUN bun install --production --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/shared ./src/shared

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
