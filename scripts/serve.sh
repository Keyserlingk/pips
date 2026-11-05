#!/usr/bin/env bash
# Starts a local server for trying the game. Only this computer can reach it,
# unless you add --phone: then phones on the same Wi-Fi can too (scan the QR
# code it prints), but not other networks such as VPNs. Ctrl+C stops it.
#
#   scripts/serve.sh                    development server: reloads as you change the code
#   scripts/serve.sh --preview          the production build, as it will be published
#   scripts/serve.sh --phone            also reachable from phones on this Wi-Fi
#   scripts/serve.sh --preview --phone
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode=dev
phone=false
for arg in "$@"; do
  case "$arg" in
    --preview) mode=preview ;;
    --phone) phone=true ;;
    *) sed -n '6,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
done
port=$([[ $mode == dev ]] && echo 5173 || echo 4173)

[[ -d node_modules ]] || npm install

host=localhost
ip=""
if $phone; then
  # The Wi-Fi address only: listening on every network would also open the server to VPNs and the like.
  wifi=$(ip -brief link 2>/dev/null | awk '$1 ~ /^wl/ && $2 == "UP" {print $1; exit}')
  ip=$(ip -4 -brief addr show "${wifi:-none}" 2>/dev/null | awk '{sub(/\/.*/, "", $3); print $3}')
  [[ -n "$ip" ]] || { echo "No Wi-Fi connection found: can't serve to phones." >&2; exit 1; }
  host=$ip
fi

echo
# With --phone the server listens on the Wi-Fi address only, so this computer uses that address too.
echo "  On this computer:  http://$host:$port/"
if [[ -n "$ip" ]]; then
  echo "  On your phone:     http://$ip:$port/   (same Wi-Fi only; scan this)"
  node -e '
    const qr = require("qrcode-generator")(0, "L");
    qr.addData(process.argv[1]);
    qr.make();
    const n = qr.getModuleCount(), dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
    // Two rows per line with half blocks, inverted so it reads on dark terminals too.
    for (let r = -2; r < n + 2; r += 2) {
      let line = "    ";
      for (let c = -2; c < n + 2; c++) line += [" ", "▄", "▀", "█"][(dark(r, c) ? 0 : 2) + (dark(r + 1, c) ? 0 : 1)];
      console.log(line);
    }' "http://$ip:$port/"
fi
echo

if [[ $mode == dev ]]; then
  exec npx vite --host "$host" --port "$port" --strictPort
else
  npm run build
  exec npx vite preview --host "$host" --port "$port" --strictPort
fi
