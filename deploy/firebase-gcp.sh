#!/usr/bin/env bash
# =============================================================================
# Studio Personalizado — publicação no Google (Firebase Hosting + Cloud Run + Cloud SQL)
#
# Rode no Google Cloud Shell (https://shell.cloud.google.com), na pasta do repositório:
#   bash deploy/firebase-gcp.sh
#
# O que o script faz (pode ser rodado de novo com segurança; o que já existe é mantido):
#   1. Ativa as APIs necessárias
#   2. Cria o PostgreSQL no Cloud SQL (com backup diário) + banco + usuário com senha aleatória
#   3. Guarda os segredos no Secret Manager
#   4. Dá à conta de serviço do Cloud Run acesso ao banco e aos segredos
#   5. Publica o servidor no Cloud Run
#   6. Importa o catálogo inicial e cria o administrador (Cloud Run jobs)
#   7. Publica o Firebase Hosting apontando para o Cloud Run
# =============================================================================
set -euo pipefail

SERVICE="studio-personalizado"
INSTANCE="studio-db"
DB_NAME="studio"
DB_USER="studio"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\n\033[31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f Dockerfile ] && [ -d server ] || fail "Rode este script na pasta raiz do repositório (onde está o Dockerfile)."
command -v gcloud >/dev/null || fail "gcloud não encontrado. Use o Google Cloud Shell."

# ------------------------------------------------------------------ Perguntas
bold "Configuração"
DEFAULT_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
read -r -p "  ID do projeto Firebase/Google Cloud [${DEFAULT_PROJECT}]: " PROJECT_ID
PROJECT_ID="${PROJECT_ID:-$DEFAULT_PROJECT}"
[ -n "$PROJECT_ID" ] || fail "Informe o ID do projeto."
read -r -p "  Região [southamerica-east1]: " REGION
REGION="${REGION:-southamerica-east1}"
read -r -p "  E-mail do administrador do painel: " ADMIN_EMAIL
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$ ]] || fail "E-mail inválido."
read -r -p "  Domínio próprio (opcional, ex.: loja.com.br — deixe vazio se não tiver): " CUSTOM_DOMAIN

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" \
  || fail "Projeto $PROJECT_ID não encontrado ou sem permissão."
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
CONNECTION="${PROJECT_ID}:${REGION}:${INSTANCE}"

BILLING="$(gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo unknown)"
if [ "$BILLING" = "False" ]; then
  fail "O projeto não tem faturamento ativo. Ative o plano Blaze no console do Firebase (Uso e faturamento) e rode de novo."
fi

# ------------------------------------------------------------------ 1. APIs
bold "1/7 Ativando APIs (pode levar 1–2 min)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com firebasehosting.googleapis.com \
  iam.googleapis.com --quiet

# ------------------------------------------------------------------ 2. Cloud SQL
bold "2/7 Banco PostgreSQL (Cloud SQL)"
if gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  info "Instância $INSTANCE já existe."
else
  info "Criando instância $INSTANCE em $REGION (leva ~10 minutos)…"
  gcloud sql instances create "$INSTANCE" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro \
    --region="$REGION" --storage-size=10GB --storage-auto-increase \
    --backup-start-time=05:00 --enable-point-in-time-recovery \
    --database-flags=log_min_duration_statement=2000 --quiet
fi
gcloud sql databases describe "$DB_NAME" --instance="$INSTANCE" >/dev/null 2>&1 \
  || gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" --quiet

# ------------------------------------------------------------------ 3. Segredos
bold "3/7 Segredos (Secret Manager)"
secret_exists() { gcloud secrets describe "$1" >/dev/null 2>&1; }
put_secret() { # nome, valor (lido de stdin)
  if secret_exists "$1"; then gcloud secrets versions add "$1" --data-file=- >/dev/null
  else gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null; fi
}

if secret_exists DATABASE_URL; then
  info "DATABASE_URL já existe (mantido)."
else
  DB_PASS="$(openssl rand -hex 24)"
  if gcloud sql users list --instance="$INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
    gcloud sql users set-password "$DB_USER" --instance="$INSTANCE" --password="$DB_PASS" --quiet
  else
    gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASS" --quiet
  fi
  printf 'postgres://%s:%s@localhost/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASS" "$DB_NAME" "$CONNECTION" | put_secret DATABASE_URL
  unset DB_PASS
  info "Usuário do banco criado com senha aleatória (guardada só no Secret Manager)."
fi
if secret_exists IP_HASH_SECRET; then info "IP_HASH_SECRET já existe (mantido)."
else openssl rand -hex 32 | tr -d '\n' | put_secret IP_HASH_SECRET; fi

# ------------------------------------------------------------------ 4. Permissões
bold "4/7 Permissões da conta de serviço"
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/run.builder \
            roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${RUN_SA}" \
    --role="$role" --condition=None --quiet >/dev/null 2>&1 || info "(aviso) não foi possível conceder $role — siga se o deploy funcionar"
done

# ------------------------------------------------------------------ 5. Cloud Run
bold "5/7 Publicando o servidor no Cloud Run (build leva ~3–5 min)"
ORIGINS="https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
[ -n "$CUSTOM_DOMAIN" ] && ORIGINS="${ORIGINS},https://${CUSTOM_DOMAIN}"
COMMON_ENV="NODE_ENV=production,DATABASE_SSL=false"
SECRETS="DATABASE_URL=DATABASE_URL:latest,IP_HASH_SECRET=IP_HASH_SECRET:latest"

gcloud run deploy "$SERVICE" --source . --region="$REGION" --allow-unauthenticated \
  --add-cloudsql-instances="$CONNECTION" --set-secrets="$SECRETS" \
  --set-env-vars="^@^${COMMON_ENV//,/@}@TRUST_PROXY=2@SESSION_COOKIE_NAME=__session@PUBLIC_ORIGINS=${ORIGINS}" \
  --memory=512Mi --cpu=1 --min-instances=0 --max-instances=3 --concurrency=40 --timeout=60 --quiet

IMAGE="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(spec.template.spec.containers[0].image)')"

# ------------------------------------------------------------------ 6. Catálogo + admin
bold "6/7 Catálogo inicial e administrador"
run_job() { # nome, segredos, args
  gcloud run jobs deploy "$1" --image="$IMAGE" --region="$REGION" \
    --set-cloudsql-instances="$CONNECTION" --set-secrets="$2" --set-env-vars="$COMMON_ENV" \
    --command=node --args="$3" --max-retries=0 --task-timeout=300 --execute-now --wait --quiet
}
run_job studio-seed "$SECRETS" "server/src/seed.js"

while true; do
  read -r -s -p "  Senha do painel para $ADMIN_EMAIL (12+ caracteres, letras e números): " ADMIN_PASS; echo
  read -r -s -p "  Repita a senha: " ADMIN_PASS2; echo
  if [ "$ADMIN_PASS" != "$ADMIN_PASS2" ]; then info "As senhas não conferem."; continue; fi
  if [ ${#ADMIN_PASS} -lt 12 ] || ! [[ "$ADMIN_PASS" =~ [A-Za-z] ]] || ! [[ "$ADMIN_PASS" =~ [0-9] ]]; then
    info "Senha fraca: use 12+ caracteres com letras e números."; continue
  fi
  break
done
printf '%s' "$ADMIN_PASS" | put_secret ADMIN_PASSWORD
unset ADMIN_PASS ADMIN_PASS2
ADMIN_OK=1
run_job studio-admin "${SECRETS},ADMIN_PASSWORD=ADMIN_PASSWORD:latest" "server/src/create-admin.js,${ADMIN_EMAIL}" || ADMIN_OK=0
gcloud run jobs delete studio-admin --region="$REGION" --quiet >/dev/null 2>&1 || true
gcloud secrets delete ADMIN_PASSWORD --quiet >/dev/null 2>&1 || true
info "Senha temporária removida do Secret Manager."
[ "$ADMIN_OK" = 1 ] || fail "Não foi possível criar o administrador. Veja os logs do job em Cloud Run → Jobs e rode o script de novo."

# ------------------------------------------------------------------ 7. Firebase Hosting
bold "7/7 Firebase Hosting"
sed -i.bak -E "s/\"region\": \"[a-z0-9-]+\"/\"region\": \"${REGION}\"/" firebase.json && rm -f firebase.json.bak
FIREBASE="firebase"
command -v firebase >/dev/null || FIREBASE="npx --yes firebase-tools@13"
$FIREBASE projects:list >/dev/null 2>&1 || $FIREBASE login --no-localhost
$FIREBASE deploy --only hosting --project "$PROJECT_ID" --non-interactive

URL="https://${PROJECT_ID}.web.app"
bold "Pronto!"
info "Loja:   ${URL}"
info "Painel: ${URL}/admin.html  (login: ${ADMIN_EMAIL})"
[ -n "$CUSTOM_DOMAIN" ] && info "Domínio próprio: adicione ${CUSTOM_DOMAIN} em Firebase Console → Hosting → Adicionar domínio personalizado."
info "Para publicar novas versões do código: bash deploy/firebase-gcp.sh (o que já existe é mantido)."
