# Urumi Platform

> Kubernetes-native store provisioning platform  Urumi AI SDE Internship Round 1

<div align="center">

![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Helm](https://img.shields.io/badge/Helm-0F1689?style=for-the-badge&logo=helm&logoColor=white)
![WooCommerce](https://img.shields.io/badge/WooCommerce-96588A?style=for-the-badge&logo=woocommerce&logoColor=white)

</div>

---

## Overview

Deploy fully-isolated WooCommerce stores on Kubernetes with one API call. Each store gets its own namespace, MySQL database, WordPress + WooCommerce installation, and ingress  all automatically provisioned and cleaned up.

---

## Architecture

<div align="center">

### High-Level System Architecture

<img width="508" height="739" alt="Screenshot 2026-02-12 at 8 56 43 PM" src="https://github.com/user-attachments/assets/0935fb5d-7d7d-48f6-8010-9f102d55390c" />


<br/><br/>

### Provisioning Pipeline (4-Phase)

<img width="1230" height="695" alt="Screenshot 2026-02-12 at 10 34 21 PM" src="https://github.com/user-attachments/assets/9d553181-0ab3-4e91-abe2-ea357f27b391" />


</div>

> For full design details — isolation model, security layers, state machine, scaling strategy — see [ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

### Key Features

- **One-Click Store Creation**  Deploy stores via dashboard or REST API (async, returns instantly)
- **Complete Isolation**  Namespace-per-store with ResourceQuota, LimitRange, NetworkPolicies
- **Modern Dashboard**  Real-time status, store URLs, provisioning progress, delete with cleanup
- **Helm-Powered**  Same charts for local (Kind) and production (k3s/VPS) via values files
- **Abuse Prevention**  API rate limiting, max store quotas, audit logging
- **Auto-Setup**  WooCommerce auto-configured with sample products + Cash on Delivery payment
- **Clean Teardown**  Namespace deletion cascades to all resources (PVCs, secrets, pods, ingress)
- **Idempotent Operations**  Safe to retry; 409 conflicts handled gracefully
- **Structured Logging**  Pino JSON logs with store context for debugging
- **Health Probes**  K8s-native readiness/liveness for all components

---

## Project Structure

```
Urumi_AI/
├── backend/                    # Node.js + TypeScript API server
│   ├── src/
│   │   ├── api/
│   │   │   ├── middleware/     # Error handling, rate limiting
│   │   │   ├── routes/        # Store CRUD + health endpoints
│   │   │   └── validators/    # Request validation
│   │   ├── config/            # Zod-validated env config
│   │   ├── models/            # Store model + state machine
│   │   ├── services/
│   │   │   ├── audit/         # Audit logging (who created/deleted what)
│   │   │   ├── k8s/           # K8s services: namespace, mysql, wordpress, setup
│   │   │   └── provisioning/  # Orchestration logic (phased provisioning)
│   │   └── utils/             # Logger, retry w/ backoff, timeout/deadline
│   └── Dockerfile
├── frontend/                   # React + Vite dashboard
│   ├── src/
│   │   ├── components/        # StoreCard, StoreList, CreateStoreModal, Stats
│   │   ├── hooks/             # useStores (polling + CRUD)
│   │   ├── services/          # Typed API client
│   │   └── types/             # Store type definitions
│   └── Dockerfile
├── helm/
│   └── urumi-platform/        # Platform Helm chart
│       ├── templates/         # K8s manifests (RBAC, ingress, deployments)
│       ├── values.yaml        # Default config
│       ├── values-local.yaml  # Kind/local overrides
│       └── values-prod.yaml   # k3s/VPS production overrides
├── k8s/
│   └── kind-config.yaml       # Kind cluster with port mappings
├── scripts/
│   └── setup-local.sh         # Automated local setup
└── docs/
    ├── ARCHITECTURE.md        # System design & tradeoffs
    └── RUNBOOK.md             # Ops procedures & troubleshooting
```

---

## Local Setup (Kind)

### Prerequisites

| Tool | Install | Version |
|------|---------|---------|
| Docker Desktop | `brew install --cask docker` | 24+ |
| Kind | `brew install kind` | 0.20+ |
| kubectl | `brew install kubectl` | 1.28+ |
| Helm 3 | `brew install helm` | 3.13+ |
| Node.js | `brew install node` | 20+ |

### Step 1: Create Kind Cluster

```bash
kind create cluster --config k8s/kind-config.yaml
```

This creates cluster `urumi-dev` with:
- Port 80 mapped to host (for `*.localhost` ingress  no tunnel needed)
- Port 443 mapped to host (HTTPS)
- Port 30001 mapped to host (NodePort)

### Step 2: Install NGINX Ingress Controller

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=90s
```

### Step 3: Pre-load Docker Images

```bash
# Pull with explicit platform (required for Kind on Apple Silicon)
docker pull --platform linux/amd64 mysql:8.0
docker pull --platform linux/amd64 bitnami/wordpress:latest

# Load into Kind cluster
kind load docker-image mysql:8.0 --name urumi-dev
kind load docker-image bitnami/wordpress:latest --name urumi-dev
```

### Step 4: Install Dependencies & Start Services

```bash
# Backend (terminal 1)
cd backend && npm install && npm run dev
# → API at http://localhost:3001

# Frontend (terminal 2)
cd frontend && npm install && npm run dev
# → Dashboard at http://localhost:3000
```

### Step 5: Create a Store & Place an Order

```bash
# Create a store via API
curl -X POST http://localhost:3001/api/stores \
  -H "Content-Type: application/json" \
  -d '{"name": "my-shop", "engine": "woocommerce"}'

# Poll status (provisioning is async, returns instantly)
curl -s http://localhost:3001/api/stores | python3 -m json.tool
```

Wait ~60-90 seconds for status to become `ready`. Then:

**Placing a Test Order (Definition of Done):**

1. **Open storefront**: `http://store-{id}.localhost`
2. **Click "Shop"** in the navigation menu
3. **Add a product to cart** → click "Add to cart" on any product
4. **Go to Cart** → click "Proceed to checkout"
5. **Fill billing details** (any test data) → select **"Cash on Delivery"** as payment
6. **Click "Place order"** → order confirmation appears
7. **Verify in WP Admin**: Go to `http://store-{id}.localhost/wp-admin` → WooCommerce → Orders

```bash
# Get admin credentials
kubectl get secret wordpress-admin-secret -n store-{id} \
  -o jsonpath='{.data.admin-password}' | base64 -d
# Username: admin
```

### Delete a Store

```bash
curl -X DELETE http://localhost:3001/api/stores/{id}

# Verify cleanup  namespace should be gone
kubectl get ns | grep store-
```

### Local Domain Approach

All `*.localhost` domains resolve to `127.0.0.1` by default on macOS/Linux. Kind maps container port 80 to host port 80 via `extraPortMappings`. NGINX ingress routes by `Host` header to the correct store's WordPress service. **No `/etc/hosts` editing, tunneling, or sudo required.**

---

## Production Setup (k3s / VPS)

### Prerequisites

- A VPS (Ubuntu 22.04+, 4GB+ RAM)  AWS EC2, DigitalOcean, Hetzner, etc.
- A domain name with DNS records pointing to the VPS IP

### Step 1: Install k3s

```bash
curl -sfL https://get.k3s.io | sh -
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER ~/.kube/config
```

### Step 2: Install Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

### Step 3: Build & Push Container Images

```bash
# Build and push to your registry
docker build -t registry.example.com/urumi/api:1.0.0 ./backend
docker build -t registry.example.com/urumi/dashboard:1.0.0 ./frontend
docker push registry.example.com/urumi/api:1.0.0
docker push registry.example.com/urumi/dashboard:1.0.0
```

Or if no private registry, build directly on the VPS or use `docker save | docker load`.

### Step 4: Configure DNS

Point these DNS records to your VPS IP:
- `urumi.example.com` → VPS IP (A record)  for the dashboard
- `*.stores.example.com` → VPS IP (wildcard A record)  for store URLs

### Step 5: Update & Deploy

Edit `helm/urumi-platform/values-prod.yaml` with your domain, registry, etc. Then:

```bash
helm install urumi ./helm/urumi-platform -f ./helm/urumi-platform/values-prod.yaml
```

### Step 6 (Optional): TLS with cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

Create a `ClusterIssuer` for Let's Encrypt  details in the values-prod.yaml comments.

### What Changes: Local vs Production (Helm Values)

| Setting | Local (Kind) | Production (k3s) |
|---------|-------------|-------------------|
| `storeDomain` | `localhost` | `stores.example.com` |
| `ingress.className` | `nginx` | `traefik` |
| `tls` | disabled | cert-manager + Let's Encrypt |
| `api.replicas` | 1 | 2+ |
| `api.image.pullPolicy` | `Never` | `Always` |
| `postgresql.storage.storageClassName` | `""` (default) | `local-path` (k3s) |
| `storeDefaults.mysql.storageSize` | `1Gi` | `5Gi` |
| `storeDefaults.wordpress.storageSize` | `2Gi` | `10Gi` |

### Upgrade / Rollback with Helm

```bash
# Upgrade (new image version or config)
helm upgrade urumi ./helm/urumi-platform -f ./helm/urumi-platform/values-prod.yaml

# Rollback to previous release
helm rollback urumi 1

# View release history
helm history urumi
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/stores` | Create store (returns 202, async) |
| `GET` | `/api/stores` | List all stores |
| `GET` | `/api/stores/:id` | Get store by ID |
| `DELETE` | `/api/stores/:id` | Delete store + cleanup |
| `GET` | `/api/audit` | Audit log (who created/deleted what) |
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe (checks K8s) |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| GET (reads/polling) | Unlimited (read-only, no abuse risk) |
| POST/PUT/DELETE (writes) | 100 requests / 15 minutes per IP |
| Store creation | 5 requests / 10 minutes per IP |
| Store deletion | 10 requests / 10 minutes per IP |
| Max active stores | 10 (hard cap in orchestrator) |

---

## System Design & Tradeoffs

### Architecture Choice

- **Namespace-per-store**: Each store is completely isolated. Deletion is trivial (delete namespace = cascading cleanup). Resource quotas/limits scoped naturally.
- **In-process orchestrator vs. operator**: Chose in-process for simplicity. A CRD + operator pattern would be better for production (automatic reconciliation, watch-based events).
- **PostgreSQL-backed state**: Store metadata persisted to PostgreSQL via `StoreRepository` (connection-pooled `pg` client). The database is initialized on startup and records survive pod restarts. Schema auto-creates via `initDatabase()`.
- **Async provisioning**: API returns HTTP 202 immediately. Background `provisionInBackground()` runs the 4-phase pipeline. Frontend polls every 5s.

### Idempotency & Failure Handling

- All K8s CREATE operations handle 409 Conflict gracefully (skip if exists).
- `withRetry()` with exponential backoff + jitter for transient K8s API failures.
- `createDeadline()` enforces 5-minute total timeout for provisioning.
- On failure: FAILED status with error + phase, namespace auto-deleted.
- State machine with `canTransitionTo()` prevents invalid transitions.

### Security

- **Secrets**: Generated via `crypto.randomBytes(16)`, stored as K8s Secrets, ref'd via `secretKeyRef`.
- **RBAC**: ServiceAccount + ClusterRole scoped to necessary resources only.
- **NetworkPolicies**: Deny-by-default + allow ingress-nginx + intra-namespace (WP ↔ MySQL).
- **Non-root**: WordPress runs with `fsGroup: 1001`.
- **Helmet**: Security headers; CORS configured per environment.
- **Rate limiting**: Per-IP limits on all endpoints, stricter on mutations.

### Abuse Prevention

- Rate limiting (express-rate-limit): global + per-endpoint
- Max 10 active stores hard limit
- Audit logging: every action with timestamp, IP, store details
- 5-minute provisioning deadline per store
- ResourceQuota per namespace: CPU/memory/storage/pod counts

### Horizontal Scaling

- API + Dashboard: stateless → scale via `replicas` in Helm values
- Concurrent provisioning: async background tasks (parallel stores supported)
- For higher throughput: add Redis job queue + worker processes
- MySQL per store: single instance; for HA add read replicas or managed DB

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, provisioning flow, isolation model |
| [RUNBOOK.md](docs/RUNBOOK.md) | Ops procedures, troubleshooting, disaster recovery |

---

Built for the **Urumi AI SDE Internship  Round 1 Assessment**
