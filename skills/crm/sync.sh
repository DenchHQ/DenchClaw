#!/usr/bin/env bash
# CRM workspace S3 sync script
# Usage: ./sync.sh [upload|download]
#
# Requires:
#   - AWS CLI configured with credentials (ABAC-scoped to org prefix)
#   - CRM_S3_BUCKET and CRM_S3_PREFIX environment variables
#     (or set in workspace_context.yaml sync section)
#
# This script syncs the workspace folder with S3.
# S3 is the persistence layer between sandbox sessions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="${SCRIPT_DIR}/.."

# Resolve workspace root (one level up from skills/crm/)
# If run from the crm/ folder itself, use current dir
if [ -f "${WORKSPACE_DIR}/workspace.duckdb" ]; then
  CRM_DIR="${WORKSPACE_DIR}"
elif [ -f "${SCRIPT_DIR}/../../workspace.duckdb" ]; then
  CRM_DIR="${SCRIPT_DIR}/../.."
else
  # Fallback: look relative to cwd
  CRM_DIR="."
fi

# Read S3 config from environment or workspace_context.yaml
S3_BUCKET="${CRM_S3_BUCKET:-}"
S3_PREFIX="${CRM_S3_PREFIX:-}"

if [ -z "$S3_BUCKET" ] && [ -f "${CRM_DIR}/workspace_context.yaml" ]; then
  # Extract sync config from YAML (basic grep, no yq dependency)
  S3_BUCKET=$(grep -A5 'sync:' "${CRM_DIR}/workspace_context.yaml" | grep 's3_bucket:' | awk '{print $2}' | tr -d '"' || true)
  S3_PREFIX=$(grep -A5 'sync:' "${CRM_DIR}/workspace_context.yaml" | grep 's3_prefix:' | awk '{print $2}' | tr -d '"' || true)
fi

if [ -z "$S3_BUCKET" ]; then
  echo "Error: CRM_S3_BUCKET not set and not found in workspace_context.yaml"
  exit 1
fi

S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}"

ACTION="${1:-upload}"

case "$ACTION" in
  upload)
    echo "Syncing CRM workspace to S3: ${S3_PATH}"
    aws s3 sync "${CRM_DIR}/" "${S3_PATH}" \
      --exclude "*.tmp" \
      --exclude ".DS_Store" \
      --exclude "exports/*" \
      --delete \
      --size-only
    echo "Upload complete."
    ;;

  download)
    echo "Downloading CRM workspace from S3: ${S3_PATH}"
    mkdir -p "${CRM_DIR}"
    aws s3 sync "${S3_PATH}" "${CRM_DIR}/" \
      --exclude "*.tmp" \
      --exclude ".DS_Store" \
      --delete \
      --size-only
    echo "Download complete."
    ;;

  *)
    echo "Usage: $0 [upload|download]"
    exit 1
    ;;
esac
