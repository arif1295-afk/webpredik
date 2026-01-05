#!/usr/bin/env bash
# Small helper to link or create a Netlify site and enable GitHub deploys.
# Usage: ./scripts/netlify_link.sh <site-name> <github-repo-url>

if ! command -v netlify >/dev/null 2>&1; then
  echo "Install netlify CLI first: npm install -g netlify-cli"
  exit 1
fi

SITE_NAME="$1"
REPO_URL="$2"

if [ -z "$SITE_NAME" ]; then
  echo "Usage: $0 <site-name> <github-repo-url>"
  exit 1
fi

netlify status >/dev/null 2>&1 || netlify login

echo "Creating or linking site: $SITE_NAME"
netlify sites:create --name "$SITE_NAME" || echo "Create failed or site exists; you can link manually via Netlify dashboard."

if [ -n "$REPO_URL" ]; then
  echo "Open Netlify dashboard to connect repository: $REPO_URL"
fi

echo "Run 'netlify deploy' to perform a preview deploy, or configure continuous deploy in dashboard."
