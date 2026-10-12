#!/usr/bin/env bash
# Startet den AgOpenWeb-Host headless mit einem leeren Datenordner neu (Linux).
# Ein laufender Host wird vorher beendet, damit der Audit nicht gegen den alten Build läuft.
#
#   Tools/ui-audit/restart-host.sh [DATENORDNER]
#
# Standard-Datenordner: /tmp/agopenweb-ui-audit (wird geleert!).
# AGOPENWEB_REPO=<Pfad> startet den Host aus einem anderen Checkout (z. B. einem Feature-Branch),
# während die Skripte aus diesem Ordner laufen.
set -euo pipefail

REPO="${AGOPENWEB_REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
DATA="${1:-/tmp/agopenweb-ui-audit}"
BIN="$REPO/Platforms/AgOpenWeb.Desktop/bin/Debug/net10.0/AgOpenWeb.Desktop"
LOG="$DATA.log"

# Linux kürzt Prozessnamen auf 15 Zeichen.
pkill -x AgOpenWeb.Deskt 2>/dev/null || true
for _ in $(seq 1 20); do pgrep -x AgOpenWeb.Deskt >/dev/null || break; sleep 0.5; done

if [ ! -x "$BIN" ]; then
  echo "Baue Desktop-Host …"
  dotnet build "$REPO/Platforms/AgOpenWeb.Desktop/AgOpenWeb.Desktop.csproj" -c Debug >/dev/null
fi

rm -rf "$DATA"
mkdir -p "$DATA"
cd "$REPO"
AGOPENWEB_DATA="$DATA" setsid nohup "$BIN" --headless >"$LOG" 2>&1 </dev/null &

for _ in $(seq 1 60); do
  if curl -s -o /dev/null http://localhost:5174/; then
    echo "Host läuft: http://localhost:5174 (Daten: $DATA, Log: $LOG)"
    exit 0
  fi
  sleep 0.5
done
echo "Host antwortet nicht, siehe $LOG" >&2
exit 1
