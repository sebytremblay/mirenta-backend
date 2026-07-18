#!/usr/bin/env bash
#
# Deploy the Mirenta voice agent to LiveKit Cloud.
#
# Runs locally and in CI. The agent id and project subdomain are not secret,
# so they live here; the LiveKit API credentials arrive through the
# environment (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). The script
# regenerates livekit.toml on every run because that file stays gitignored to
# keep it out of the Docker build context.
#
# Existing agent secrets (MIRENTA_API_BASE_URL, MIRENTA_INTERNAL_API_KEY,
# OPENAI_API_KEY, ...) persist across deploys. This script passes no --secrets
# flag, so LiveKit Cloud retains whatever the agent already holds. Update those
# through `lk agent update-secrets` when they change, never through a deploy.

set -euo pipefail

AGENT_ID="CA_q3cEoRMbFHse"
PROJECT_SUBDOMAIN="mirenta-y0dc1n3g"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"

for var in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is not set" >&2
    exit 1
  fi
done

if ! command -v lk >/dev/null 2>&1; then
  echo "error: the lk CLI is not installed (see https://docs.livekit.io/home/cli/)" >&2
  exit 1
fi

cat > "$AGENT_DIR/livekit.toml" <<EOF
[project]
subdomain = "$PROJECT_SUBDOMAIN"

[agent]
id = "$AGENT_ID"
EOF

echo "deploying agent $AGENT_ID to $PROJECT_SUBDOMAIN"
lk agent deploy \
  --url "$LIVEKIT_URL" \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --yes \
  "$AGENT_DIR"

echo "deploy complete"
