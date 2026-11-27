#!/usr/bin/env bash
# =============================================================================
# Configura a publicação AUTOMÁTICA: cada push no main do GitHub publica no Google.
# Rode UMA vez no Google Cloud Shell, depois do deploy/firebase-gcp.sh:
#   bash deploy/setup-github-deploy.sh
#
# Usa Workload Identity Federation: o GitHub prova quem é para o Google a cada
# execução. NENHUMA chave fica guardada no GitHub. O acesso é limitado a este
# repositório e ao branch main, com uma conta de serviço de permissões mínimas.
# =============================================================================
set -euo pipefail

REPO="${GITHUB_REPO:-Mateus-R-Sampaio/palule_new}"
SA_NAME="github-deployer"
POOL="github"
PROVIDER="github-actions"

PROJECT_ID="$(gcloud config get-value project 2>/dev/null)"
read -r -p "ID do projeto [${PROJECT_ID}]: " INPUT; PROJECT_ID="${INPUT:-$PROJECT_ID}"
[ -n "$PROJECT_ID" ] || { echo "Informe o projeto." >&2; exit 1; }
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
REGION="$(grep -oE '"region": "[a-z0-9-]+"' firebase.json | head -1 | cut -d'"' -f4)"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --quiet

echo "Conta de serviço de publicação…"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="Publicação pelo GitHub Actions" --quiet

for role in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer roles/firebasehosting.admin roles/cloudbuild.builds.editor roles/storage.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$role" --condition=None --quiet >/dev/null
done
# Pode "agir como" a conta que roda o servidor (necessário para publicar), e só ela.
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" --member="serviceAccount:${SA}" \
  --role=roles/iam.serviceAccountUser --quiet >/dev/null

echo "Vínculo de confiança com o GitHub (Workload Identity Federation)…"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub" --quiet
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub Actions" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'" --quiet

POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${REPO}" --quiet >/dev/null

cat <<MSG

Pronto! Agora, no GitHub, abra:
  https://github.com/${REPO}/settings/variables/actions
e crie estas 4 variáveis (aba "Variables", NÃO "Secrets" — não são senhas):

  GCP_PROJECT_ID    = ${PROJECT_ID}
  GCP_REGION        = ${REGION}
  GCP_WIF_PROVIDER  = ${POOL_ID}/providers/${PROVIDER}
  GCP_DEPLOY_SA     = ${SA}

A partir daí, cada push no main roda os testes e, se passarem, publica o site.
MSG
