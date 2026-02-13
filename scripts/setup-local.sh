#!/bin/bash
#
# ============================================================================
# LOCAL DEVELOPMENT SETUP SCRIPT
# ============================================================================
#
# This script sets up the local Kind cluster and installs all required
# components for the Urumi Platform.
#
# Prerequisites:
#   - Docker (running)
#   - Kind (https://kind.sigs.k8s.io/docs/user/quick-start/)
#   - kubectl
#   - Helm 3
#
# Usage:
#   ./scripts/setup-local.sh
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              URUMI PLATFORM - LOCAL SETUP                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

# Check prerequisites
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker${NC}"

if ! command -v kind &> /dev/null; then
    echo -e "${RED}✗ Kind is not installed${NC}"
    echo "  Install with: brew install kind"
    exit 1
fi
echo -e "${GREEN}✓ Kind${NC}"

if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}✗ kubectl is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ kubectl${NC}"

if ! command -v helm &> /dev/null; then
    echo -e "${RED}✗ Helm is not installed${NC}"
    echo "  Install with: brew install helm"
    exit 1
fi
echo -e "${GREEN}✓ Helm${NC}"

# Create Kind cluster
echo -e "\n${YELLOW}Creating Kind cluster...${NC}"

if kind get clusters | grep -q "urumi-dev"; then
    echo -e "${YELLOW}Cluster 'urumi-dev' already exists. Delete it? (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        kind delete cluster --name urumi-dev
    else
        echo "Using existing cluster"
    fi
fi

if ! kind get clusters | grep -q "urumi-dev"; then
    kind create cluster --config k8s/kind-config.yaml
    echo -e "${GREEN}✓ Kind cluster created${NC}"
else
    echo -e "${GREEN}✓ Kind cluster exists${NC}"
fi

# Install NGINX Ingress Controller
echo -e "\n${YELLOW}Installing NGINX Ingress Controller...${NC}"
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml

echo "Waiting for ingress controller to be ready..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

echo -e "${GREEN}✓ Ingress controller ready${NC}"

# Build Docker images
echo -e "\n${YELLOW}Building Docker images...${NC}"

# Backend
echo "Building backend image..."
docker build -t urumi/api:local ./backend

# Frontend
echo "Building frontend image..."
docker build -t urumi/dashboard:local ./frontend

echo -e "${GREEN}✓ Images built${NC}"

# Load images into Kind
echo -e "\n${YELLOW}Loading images into Kind cluster...${NC}"
kind load docker-image urumi/api:local --name urumi-dev
kind load docker-image urumi/dashboard:local --name urumi-dev
echo -e "${GREEN}✓ Images loaded${NC}"

# Install Helm chart
echo -e "\n${YELLOW}Installing Urumi Platform via Helm...${NC}"
helm upgrade --install urumi ./helm/urumi-platform \
  -f ./helm/urumi-platform/values-local.yaml \
  --namespace urumi-platform \
  --create-namespace

echo -e "${GREEN}✓ Helm chart installed${NC}"

# Wait for pods to be ready
echo -e "\n${YELLOW}Waiting for pods to be ready...${NC}"
kubectl wait --namespace urumi-platform \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/instance=urumi \
  --timeout=120s

echo -e "\n${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    SETUP COMPLETE! 🎉                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${BLUE}Dashboard:${NC} http://urumi.localhost"
echo -e "${BLUE}API:${NC}       http://urumi.localhost/api"
echo -e "${BLUE}Health:${NC}    http://urumi.localhost/health"

echo -e "\n${YELLOW}Note:${NC} Add '127.0.0.1 urumi.localhost' to /etc/hosts if not auto-resolving"

echo -e "\n${BLUE}Quick Test:${NC}"
echo "  curl http://urumi.localhost/api/stores"
