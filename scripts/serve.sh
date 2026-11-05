#!/usr/bin/env bash
# Starts a local server for trying the game, on this computer and on phones on
# the same Wi-Fi (scan the QR code it prints). Ctrl+C stops it.
#
#   scripts/serve.sh              development server: reloads as you change the code
#   scripts/serve.sh --preview    the production build, as it will be published
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode=dev
case "${1:-}" in
  "") ;;
  --preview) mode=preview ;;
  *) sed -n '5,6p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
port=$([[ $mode == dev ]] && echo 5173 || echo 4173)

[[ -d node_modules ]] || npm install

# This computer's address on the local network, for phones.
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "  On this computer:  http://localhost:$port/"
if [[ -n "$ip" ]]; then
  echo "  On your phone:     http://$ip:$port/   (same Wi-Fi; scan this)"
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
  exec npx vite --host --port "$port" --strictPort
else
  npm run build
  exec npx vite preview --host --port "$port" --strictPort
fi
