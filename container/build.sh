#!/bin/bash
# Build the NanoClaw agent container image
#
# Tags with both 'latest' and the current git SHA for traceability.
# Verifies the image exists after building.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

# Git SHA tag for traceability (which code is running?)
GIT_SHA=$(git -C "$SCRIPT_DIR/.." rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG} (git: ${GIT_SHA})"

${CONTAINER_RUNTIME} build \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t "${IMAGE_NAME}:${TAG}" \
  -t "${IMAGE_NAME}:${GIT_SHA}" \
  .

# Verify the image was created
if ! ${CONTAINER_RUNTIME} image inspect "${IMAGE_NAME}:${TAG}" >/dev/null 2>&1; then
  echo "ERROR: Build completed but image '${IMAGE_NAME}:${TAG}' not found!" >&2
  exit 1
fi

IMAGE_SIZE=$(${CONTAINER_RUNTIME} image inspect "${IMAGE_NAME}:${TAG}" --format '{{.Size}}' 2>/dev/null)
IMAGE_SIZE_MB=$((IMAGE_SIZE / 1024 / 1024))

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG} (${IMAGE_SIZE_MB}MB)"
echo "Git:   ${GIT_SHA}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
