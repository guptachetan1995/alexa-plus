#!/usr/bin/env bash
# Builds the App Runner container image locally. No AWS call, no credential needed — this
# is the one step #123 itself may execute for real (see docs/deploy.md). deploy.sh calls
# this same script before it pushes, so the build path proven here is what #124 ships.
set -euo pipefail

ENTRY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-alexa-plus-server:local}"
PLATFORM="${PLATFORM:-linux/amd64}"

cd "$ENTRY_ROOT"
tar --exclude='client' --exclude='node_modules' --exclude='.git' --exclude='docs' \
    -cf - . \
  | docker build --platform "$PLATFORM" -f deploy/Dockerfile -t "$IMAGE_TAG" -

echo "built ${IMAGE_TAG} for ${PLATFORM}"
