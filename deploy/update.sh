#!/usr/bin/env bash
# Publica uma nova versão do código no Google (Cloud Run), mantendo banco, segredos e configurações.
# Uso no Google Cloud Shell, na pasta do repositório:
#   git pull && bash deploy/update.sh
# As migrações do banco rodam sozinhas quando o servidor inicia.
set -euo pipefail
SERVICE="studio-personalizado"
[ -f Dockerfile ] || { echo "Rode na pasta raiz do repositório." >&2; exit 1; }

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
[ -n "$PROJECT_ID" ] || { echo "Uso: bash deploy/update.sh ID-DO-PROJETO" >&2; exit 1; }
REGION="$(grep -oE '"region": "[a-z0-9-]+"' firebase.json | head -1 | cut -d'"' -f4)"

echo "Publicando $(git rev-parse --short HEAD 2>/dev/null || echo 'código atual') em $PROJECT_ID ($REGION)…"
# Sem outras flags: a nova versão herda banco, segredos e variáveis da versão anterior.
gcloud run deploy "$SERVICE" --source . --project "$PROJECT_ID" --region "$REGION" --quiet

if [ "${2:-}" = "--hosting" ]; then
  FIREBASE="firebase"; command -v firebase >/dev/null || FIREBASE="npx --yes firebase-tools@13"
  $FIREBASE deploy --only hosting --project "$PROJECT_ID" --non-interactive
fi
echo "Pronto: https://${PROJECT_ID}.web.app"
