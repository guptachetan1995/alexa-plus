#!/usr/bin/env bash
# Deploys the alexa-plus MCP server to AWS App Runner. OWNER-RUN ONLY (#124) — deploying
# is a human-only action per CLAUDE.md; no goal, including the one that wrote this file,
# runs this script. Idempotent: every resource is checked before it's created.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"
SERVICE_NAME="${SERVICE_NAME:-alexa-plus-mcp-server}"
ECR_REPOSITORY="${ECR_REPOSITORY:-alexa-plus-server}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
PORT="${PORT:-3000}"
ACCESS_ROLE_NAME="${ACCESS_ROLE_NAME:-alexa-plus-apprunner-ecr-access}"
APP_RUNNER_CPU="${APP_RUNNER_CPU:-0.25 vCPU}"
APP_RUNNER_MEMORY="${APP_RUNNER_MEMORY:-0.5 GB}"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_REGION AWS_PROFILE

account_id="$(aws sts get-caller-identity --query Account --output text)"
ecr_uri="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}"

# --- ECR repository (create if missing) --------------------------------------------
aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPOSITORY" \
       --image-scanning-configuration scanOnPush=true

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"

IMAGE_TAG="${ecr_uri}:${IMAGE_TAG}" bash "${DEPLOY_DIR}/build.sh"
docker push "${ecr_uri}:${IMAGE_TAG}"
image_uri="${ecr_uri}:${IMAGE_TAG##*:}"

# --- ECR access role (App Runner assumes this to pull the private image) -----------
trust_policy='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"Service": "build.apprunner.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }
  ]
}'
access_role_arn="arn:aws:iam::${account_id}:role/${ACCESS_ROLE_NAME}"
if ! aws iam get-role --role-name "$ACCESS_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ACCESS_ROLE_NAME" \
    --assume-role-policy-document "$trust_policy" >/dev/null
  aws iam attach-role-policy --role-name "$ACCESS_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
  # A freshly created role isn't always immediately assumable; a short settle delay
  # avoids a create-service race on a brand-new role (same reasoning as opencv's).
  sleep 8
fi

# --- App Runner service (create or update) ------------------------------------------
source_config=$(cat <<JSON
{
  "ImageRepository": {
    "ImageIdentifier": "${image_uri}",
    "ImageRepositoryType": "ECR",
    "ImageConfiguration": {"Port": "${PORT}"}
  },
  "AutoDeploymentsEnabled": false,
  "AuthenticationConfiguration": {"AccessRoleArn": "${access_role_arn}"}
}
JSON
)
# TCP against the container port is App Runner's own default; stated explicitly rather
# than left implicit. No HTTP health path exists yet (see docs/deploy.md).
health_check_config='{"Protocol":"TCP","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}'

service_arn="$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='${SERVICE_NAME}'].ServiceArn" --output text)"

if [ -n "$service_arn" ]; then
  aws apprunner update-service --service-arn "$service_arn" \
    --source-configuration "$source_config" >/dev/null
else
  service_arn="$(aws apprunner create-service --service-name "$SERVICE_NAME" \
    --source-configuration "$source_config" \
    --health-check-configuration "$health_check_config" \
    --instance-configuration "{\"Cpu\":\"${APP_RUNNER_CPU}\",\"Memory\":\"${APP_RUNNER_MEMORY}\"}" \
    --query 'Service.ServiceArn' --output text)"
fi

# App Runner's create/update calls return before the service finishes provisioning —
# no `aws apprunner wait ...` subcommand exists, so poll describe-service directly.
echo "waiting for ${SERVICE_NAME} to become RUNNING..."
status=""
for _ in $(seq 1 60); do
  status="$(aws apprunner describe-service --service-arn "$service_arn" \
    --query 'Service.Status' --output text)"
  [ "$status" = "RUNNING" ] && break
  sleep 10
done
[ "$status" = "RUNNING" ] || {
  echo "service did not reach RUNNING (last status: ${status})" >&2
  exit 1
}

service_url="$(aws apprunner describe-service --service-arn "$service_arn" \
  --query 'Service.ServiceUrl' --output text)"

echo "deployed ${SERVICE_NAME}; image ${image_uri}"
echo "service url: https://${service_url}/mcp"
