#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-ezav2-data-rg}"
LOCATION="${LOCATION:-eastus2}"
CONTAINER="${CONTAINER:-ezav2-media}"

command -v az >/dev/null 2>&1 || { echo "Azure CLI is required."; exit 1; }
az account show >/dev/null 2>&1 || { echo "Run: az login --use-device-code"; exit 1; }

SUFFIX="$(date +%s | tail -c 9)"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-ezav2${SUFFIX}}"
STORAGE_ACCOUNT="$(printf '%s' "$STORAGE_ACCOUNT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-24)"

echo "Creating Azure data resources for EZAv2..."
echo "Resource group: $RESOURCE_GROUP"
echo "Location:       $LOCATION"
echo "Storage:        $STORAGE_ACCOUNT"
echo "Container:      $CONTAINER"

az group create   --name "$RESOURCE_GROUP"   --location "$LOCATION"   --output none

az storage account create   --name "$STORAGE_ACCOUNT"   --resource-group "$RESOURCE_GROUP"   --location "$LOCATION"   --sku Standard_LRS   --kind StorageV2   --allow-blob-public-access true   --https-only true   --min-tls-version TLS1_2   --output none

ACCOUNT_KEY="$(az storage account keys list   --account-name "$STORAGE_ACCOUNT"   --resource-group "$RESOURCE_GROUP"   --query "[0].value"   -o tsv)"

az storage container create   --name "$CONTAINER"   --account-name "$STORAGE_ACCOUNT"   --account-key "$ACCOUNT_KEY"   --public-access blob   --output none

echo
echo "Azure Blob Storage is ready."
echo
echo "Add these Render environment variables:"
echo "  STORAGE_BACKEND=azure"
echo "  AZURE_STORAGE_CONTAINER=$CONTAINER"
echo "  AZURE_STORAGE_PUBLIC_BASE=https://$STORAGE_ACCOUNT.blob.core.windows.net/$CONTAINER"
echo
echo "For AZURE_STORAGE_CONNECTION_STRING, run this command in Cloud Shell and copy the VALUE directly into Render:"
echo
echo "az storage account show-connection-string --name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP --query connectionString -o tsv"
echo
echo "Do NOT paste that connection string into ChatGPT."
echo
echo "Keep the existing S3 variables until Azure storage is confirmed working. Then remove them."
