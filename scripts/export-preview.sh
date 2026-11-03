#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  printf 'usage: %s OUTPUT_PATH\n' "$0" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="$1"
case "$output_path" in
  /*) ;;
  *) output_path="$repo_root/$output_path" ;;
esac
mkdir -p "$(dirname "$output_path")"

# Pin a caller's empty marker into the environment so --env-file-if-exists=.env cannot
# accidentally restore a local marker during a clean export.
export LANE_MARKER="${LANE_MARKER-}"

port="$(node --input-type=module -e '
  import { createServer } from "node:net";
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") process.stdout.write(String(address.port));
    server.close();
  });
')"

server_pid=''
stop_server() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap stop_server EXIT INT TERM

cd "$repo_root"
PORT="$port" node --env-file-if-exists=.env --import tsx src/server.ts >/dev/null 2>&1 &
server_pid=$!

url="http://127.0.0.1:$port/digest/2026-10-28"
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    printf 'rig exited before it became ready\n' >&2
    exit 1
  fi
  if curl --silent --output /dev/null --fail "$url"; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" -ne 1 ]]; then
  printf 'rig did not return HTTP 200 at %s\n' "$url" >&2
  exit 1
fi

status="$(curl --silent --show-error --output "$output_path" --write-out '%{http_code}' "$url")"
if [[ "$status" != 200 ]]; then
  rm -f "$output_path"
  printf 'preview request returned HTTP %s\n' "$status" >&2
  exit 1
fi

# Check the banner without ever echoing the marker value to stdout/stderr.
node --input-type=module - "$output_path" <<'NODE'
import { readFileSync } from 'node:fs';

const outputPath = process.argv[2];
const html = readFileSync(outputPath, 'utf8');
const marker = (process.env.LANE_MARKER ?? '').trim();
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})[character]);

if (marker) {
  if (!html.includes(escapeHtml(marker))) {
    console.error('preview banner does not contain the expected marker');
    process.exit(1);
  }
} else if (!html.includes('no marker set')) {
  console.error('preview banner should say no marker set');
  process.exit(1);
}
NODE

printf 'Saved %s\n' "$output_path"
