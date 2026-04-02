# Shell executor container for MXF shell sandbox
# Provides common CLI tools in an isolated environment
#
# Security is enforced by Docker runtime constraints:
# - No network access (NetworkMode: none)
# - Read-only root filesystem (ReadonlyRootfs: true)
# - All capabilities dropped (CapDrop: ALL)
# - Non-root user (1000:1000)
# - Memory and CPU limits
# - PID limit

FROM alpine:3.19

# Install common CLI tools that agents typically need.
# Network tools (curl, wget, openssh-client) are included for use when
# networkAccess: true is set in the sandbox config — they are inert under
# the default NetworkMode: none.
RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    git \
    grep \
    jq \
    sed \
    gawk \
    findutils \
    diffutils \
    patch \
    tree \
    less \
    wget \
    openssh-client \
    python3 \
    nodejs \
    npm

# Create non-root user matching the code-executor pattern
RUN addgroup -g 1000 executor && \
    adduser -u 1000 -G executor -s /bin/bash -D executor

# Create workspace directory
RUN mkdir -p /workspace && chown executor:executor /workspace

# Switch to non-root user
USER 1000:1000

WORKDIR /workspace

# Default entrypoint: bash
ENTRYPOINT ["/bin/bash", "-c"]
