# Urumi Platform  System Architecture

## Overview

Urumi is a **Kubernetes-native store provisioning platform** that deploys fully-isolated WooCommerce stores on demand. One API call spins up an entire ecommerce store  its own namespace, database, application, ingress, sample products, and payment gateway  in under 3 minutes.

The same Helm charts deploy to a local Kind cluster or a production k3s VPS. The only change is the values file.

---

## 1. High-Level System Architecture

<img width="508" height="739" alt="Screenshot 2026-02-12 at 8 56 43 PM" src="https://github.com/user-attachments/assets/b4d97448-d54e-44aa-aa9e-3be586303bda" />


**Three core components:**

| Component | Tech | Responsibility |
|-----------|------|----------------|
| **Dashboard** | React 18 + Vite + Nginx | UI for store CRUD, status polling every 5s, stats |
| **API Server** | Express.js + TypeScript | REST endpoints, provisioning orchestrator, K8s client, audit logging |
| **PostgreSQL** | v15 StatefulSet + PVC | Source of truth  store records, status, phase, timestamps |

---

## 2. End-to-End Request Flow

```
 ┌──────────┐         ┌───────────┐         ┌───────────┐         ┌──────────────┐
 │  Browser  │         │ Dashboard │         │  API      │         │ Kubernetes   │
 │  (User)   │         │ (React)   │         │ (Express) │         │ API Server   │
 └─────┬─────┘         └─────┬─────┘         └─────┬─────┘         └──────┬───────┘
       │                     │                      │                      │
       │  Click "New Store"  │                      │                      │
       │────────────────────>│                      │                      │
       │                     │                      │                      │
       │                     │  POST /api/stores    │                      │
       │                     │  {name, engine}      │                      │
       │                     │─────────────────────>│                      │
       │                     │                      │                      │
       │                     │                      │── Zod validate       │
       │                     │                      │── Rate limit check   │
       │                     │                      │── Audit log (IP)     │
       │                     │                      │── INSERT store (DB)  │
       │                     │                      │                      │
       │                     │  HTTP 202 Accepted   │                      │
       │                     │  {id, status:pending}│                      │
       │                     │<─────────────────────│                      │
       │                     │                      │                      │
       │  Show "Provisioning"│                      │── Fire background ──>│
       │<────────────────────│                      │   provisioning       │
       │                     │                      │                      │
       │                     │                      │   Phase 1: Namespace │
       │                     │                      │──────────────────────>
       │                     │                      │── checkpoint to DB   │
       │                     │                      │                      │
       │                     │  GET /api/stores     │   Phase 2: MySQL     │
       │                     │  (poll every 5s)     │──────────────────────>
       │                     │─────────────────────>│── checkpoint to DB   │
       │                     │  {phase: "database"} │                      │
       │                     │<─────────────────────│   Phase 3: WordPress │
       │                     │                      │──────────────────────>
       │  Update phase badge │                      │── checkpoint to DB   │
       │<────────────────────│                      │                      │
       │                     │                      │   Phase 4: WP-CLI    │
       │                     │  GET /api/stores     │   (kubectl exec)     │
       │                     │─────────────────────>│──────────────────────>
       │                     │  {status: "ready",   │── UPDATE store=ready │
       │                     │   url: store-xx.host}│                      │
       │                     │<─────────────────────│                      │
       │                     │                      │                      │
       │  Show "Ready" +     │                      │                      │
       │  Store URL + Links  │                      │                      │
       │<────────────────────│                      │                      │
       │                     │                      │                      │
       │  Visit Store URL ───────────────── via Ingress ──────────> WordPress Pod
       │  Add to cart, Checkout, Place order (COD)                   in store-xx NS
       │                     │                      │                      │
```

**Key design decisions in this flow:**
- **HTTP 202**  non-blocking. User sees instant feedback.
- **5s smart polling**  only active when stores are in transitional states (pending/provisioning/deleting).
- **Phase checkpointing**  each phase updates PostgreSQL before starting the next. If the API pod crashes, we know exactly where it stopped.
- **5-minute deadline**  a `createDeadline(300000)` wraps all 4 phases. Prevents zombie provisioning.

---

## 3. Provisioning Pipeline (4-Phase)

<img width="1230" height="695" alt="Screenshot 2026-02-12 at 10 34 21 PM" src="https://github.com/user-attachments/assets/9c2c47c3-df18-4741-8fa4-32c8021d2d48" />


---

## 4. Store Isolation Model (Namespace-per-Store)

```
┌─────────────────────── KUBERNETES CLUSTER ──────────────────────────────────────┐
│                                                                                  │
│   ┌─── store-a1b2c3d4 ──────────────────────────┐                               │
│   │                                               │                               │
│   │   ResourceQuota                               │                               │
│   │   ┌──────────────────────────────────────┐   │                               │
│   │   │ pods: 10      limits.cpu: 2          │   │                               │
│   │   │ services: 5   limits.memory: 2Gi     │   │                               │
│   │   │ PVCs: 3       requests.storage: 5Gi  │   │                               │
│   │   └──────────────────────────────────────┘   │                               │
│   │                                               │                               │
│   │   LimitRange                                  │                               │
│   │   ┌──────────────────────────────────────┐   │                               │
│   │   │ default:  500m CPU, 512Mi memory     │   │                               │
│   │   │ min:       50m CPU,  64Mi memory     │   │                               │
│   │   │ max:        1  CPU,   1Gi memory     │   │                               │
│   │   └──────────────────────────────────────┘   │                               │
│   │                                               │                               │
│   │   NetworkPolicy (deny-by-default)             │                               │
│   │   ┌──────────────────────────────────────┐   │                               │
│   │   │ INGRESS RULES:                       │   │                               │
│   │   │  ✓ ingress-nginx  →  WordPress:8080  │   │    ┌─── store-e5f6g7h8 ──┐   │
│   │   │  ✓ MySQL (intra-NS) ← WordPress     │   │    │                      │   │
│   │   │  ✗ Cross-namespace traffic BLOCKED   │   │    │  (Same isolation     │   │
│   │   │                                      │   │    │   model applied)     │   │
│   │   │ EGRESS RULES:                        │   │    │                      │   │
│   │   │  ✓ DNS (kube-dns, port 53)           │   │    │  NetworkPolicy       │   │
│   │   │  ✓ HTTP/HTTPS (plugin downloads)     │◄──╋──X─┤  BLOCKS traffic     │   │
│   │   │  ✗ Everything else BLOCKED           │   │    │  between stores      │   │
│   │   └──────────────────────────────────────┘   │    │                      │   │
│   │                                               │    └──────────────────────┘   │
│   │   ┌──────────┐       ┌──────────────────┐    │                               │
│   │   │  MySQL   │ port  │   WordPress      │    │                               │
│   │   │  8.0     │ 3306  │ + WooCommerce    │    │                               │
│   │   │StatefulS.│◄─────│  Deployment      │    │                               │
│   │   │ PVC:1Gi  │       │  PVC: 2Gi        │    │                               │
│   │   └──────────┘       └────────┬─────────┘    │                               │
│   │                               │               │                               │
│   │                        ┌──────┴───────┐       │                               │
│   │                        │   Ingress    │       │                               │
│   │                        │ store-a1b2   │       │                               │
│   │                        │ .localhost   │       │                               │
│   │                        └──────────────┘       │                               │
│   └───────────────────────────────────────────────┘                               │
│                                                                                    │
│   Cleanup: DELETE namespace → foreground propagation → ALL child resources removed │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Why namespace-per-store?**
- **Blast radius**  a crashed store can't affect others
- **Resource caps**  ResourceQuota prevents any store from starving the cluster
- **Network isolation**  NetworkPolicy blocks cross-store traffic
- **Clean teardown**  `kubectl delete namespace store-xxx` cascades to everything
- **Debugging**  `kubectl -n store-xxx get all` shows only that store's resources

---

## 5. Security Architecture

```
┌──────────────────────── SECURITY LAYERS ──────────────────────────────────────┐
│                                                                                │
│  LAYER 1: NETWORK EDGE                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Ingress Controller                                                      │  │
│  │  ├── Only routes: urumi.localhost (dashboard + /api)                     │  │
│  │  ├── Only routes: store-*.localhost (per-store WordPress)                │  │
│  │  ├── TLS termination (prod: cert-manager + Let's Encrypt)               │  │
│  │  └── Internal services (PostgreSQL, MySQL) NOT exposed                   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  LAYER 2: API PROTECTION                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Helmet          │ Security headers on all responses (X-Frame, CSP...)  │  │
│  │  CORS            │ Wildcard dev / whitelisted origin prod               │  │
│  │  Rate Limiting   │ Global: 100/15min, Create: 5/10min, Delete: 10/10min│  │
│  │  Zod Validation  │ Schema validation on all request bodies              │  │
│  │  Max Store Cap   │ Hard limit: 10 active stores                         │  │
│  │  Trust Proxy     │ Correct client IP behind ingress for rate limiting   │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  LAYER 3: KUBERNETES RBAC                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  ServiceAccount: urumi-platform-api                                      │  │
│  │  ClusterRole (NOT admin  least privilege):                              │  │
│  │  ┌────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  RESOURCE          │ VERBS                                        │  │  │
│  │  │  namespaces        │ get, list, create, delete                    │  │  │
│  │  │  deployments       │ get, list, create, update, delete            │  │  │
│  │  │  statefulsets      │ get, list, create, update, delete            │  │  │
│  │  │  services          │ get, list, create, delete                    │  │  │
│  │  │  secrets           │ get, list, create, delete                    │  │  │
│  │  │  PVCs              │ get, list, create, delete                    │  │  │
│  │  │  ingresses         │ get, list, create, delete                    │  │  │
│  │  │  networkpolicies   │ get, list, create, delete                    │  │  │
│  │  │  resourcequotas    │ get, list, create                            │  │  │
│  │  │  limitranges       │ get, list, create                            │  │  │
│  │  │  pods/exec         │ create  (for WP-CLI only)                    │  │  │
│  │  └────────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  LAYER 4: SECRETS MANAGEMENT                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  All passwords: crypto.randomBytes(16).toString('hex')                   │  │
│  │  Stored as: K8s Secrets (not environment vars, not in Helm values)       │  │
│  │  Referenced via: secretKeyRef in pod env (never mounted as files)        │  │
│  │  PostgreSQL pw: preserved across helm upgrade via lookup()               │  │
│  │  Pino logger: redacts password, secret, token from all log output        │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  LAYER 5: CONTAINER HARDENING                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  WordPress:  fsGroup: 1001 (non-root bitnami user)                       │  │
│  │  MySQL:      fsGroup: 999  (non-root mysql user)                         │  │
│  │  WP-CLI:     execFile() not exec()  no shell injection possible         │  │
│  │  Per-store:  ResourceQuota prevents resource bomb attacks                │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  LAYER 6: AUDIT TRAIL                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Every action logged: timestamp, action, storeId, storeName, sourceIp   │  │
│  │  Actions: create_requested, create_started, create_succeeded,           │  │
│  │           create_failed, delete_requested, delete_succeeded,            │  │
│  │           delete_failed, status_changed                                 │  │
│  │  Queryable via: GET /api/audit?storeId=xxx&action=xxx                   │  │
│  │  Also: structured JSON logs (Pino) for external aggregation             │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. State Machine

```
                   ┌────────────────────┐
                   │      pending       │   POST /api/stores returns 202
                   │  (record created)  │   Background provisioning starts
                   └──────────┬─────────┘
                              │
                              ▼
                   ┌────────────────────┐
                   │   provisioning     │   4-phase pipeline running
                   │                    │   Phase checkpoints: namespace→database→
                   │  phase: namespace  │   application→validation
                   │  phase: database   │
                   │  phase: application│   5-minute deadline enforced
                   │  phase: validation │
                   └─────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │                             │
       all phases OK               any phase throws
              │                             │
              ▼                             ▼
   ┌────────────────────┐       ┌────────────────────┐
   │       ready        │       │       failed       │
   │                    │       │                     │
   │  url: store-xx.    │       │  error: "MySQL      │
   │       localhost    │       │   timeout after 90s"│
   │  duration: 145000  │       │  failedPhase:       │
   │                    │       │   "database"        │
   └──────────┬─────────┘       │                     │
              │                 │  Namespace cleaned   │
              │                 │  up automatically    │
              │                 └─────────────────────┘
              │
   DELETE /api/stores/:id
              │
              ▼
   ┌────────────────────┐
   │     deleting       │   kubectl delete namespace (foreground propagation)
   │                    │   Waits for all child resources to terminate
   └──────────┬─────────┘
              │
              ▼
   ┌────────────────────┐
   │     deleted        │   Soft-deleted in PostgreSQL
   │  (soft delete)     │   Hidden from dashboard listing
   │                    │   Preserved for audit trail
   └────────────────────┘
```

---

## 7. Error Handling & Reliability

```
┌──────────────────── RELIABILITY MECHANISMS ───────────────────────────┐
│                                                                       │
│  ┌─── RETRY WITH EXPONENTIAL BACKOFF ──────────────────────────────┐ │
│  │                                                                  │ │
│  │  Attempt 1: immediate                                            │ │
│  │  Attempt 2: 1s  × (1 ± 0.25 jitter) = 0.75s – 1.25s           │ │
│  │  Attempt 3: 2s  × (1 ± 0.25 jitter) = 1.50s – 2.50s           │ │
│  │  Attempt 4: 4s  × (1 ± 0.25 jitter) = 3.00s – 5.00s           │ │
│  │  Max delay cap: 30s                                              │ │
│  │                                                                  │ │
│  │  Retryable:        429, 500, 502, 503, 504,                     │ │
│  │                    ECONNREFUSED, ETIMEDOUT, ENOTFOUND            │ │
│  │  NOT retryable:    400, 403, 404, 422 (permanent failures)      │ │
│  │                                                                  │ │
│  │  Jitter prevents thundering herd when multiple stores provision  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─── IDEMPOTENT OPERATIONS ───────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  Every K8s CREATE handles 409 Conflict:                          │ │
│  │    try { await k8s.createNamespacedX(...) }                      │ │
│  │    catch (e) { if (e.statusCode === 409) → skip, already exists }│ │
│  │                                                                  │ │
│  │  Safe to retry entire provisioning pipeline.                     │ │
│  │  No duplicate resources created on crash + restart.              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─── DEADLINE / TIMEOUT ──────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  createDeadline(300000)  ← 5 minutes for all 4 phases           │ │
│  │    │                                                             │ │
│  │    ├── deadline.wrap(phase1)  ← wraps with remaining time       │ │
│  │    ├── deadline.check()       ← throws if expired               │ │
│  │    ├── deadline.wrap(phase2)                                     │ │
│  │    ├── deadline.check()                                          │ │
│  │    ├── deadline.wrap(phase3)                                     │ │
│  │    ├── deadline.check()                                          │ │
│  │    └── deadline.wrap(phase4)                                     │ │
│  │                                                                  │ │
│  │  Per-phase timeouts: MySQL: 90s, WordPress: 180s                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─── CLEANUP ON FAILURE ──────────────────────────────────────────┐ │
│  │                                                                  │ │
│  │  Phase 1 fails → nothing to clean (namespace not created)        │ │
│  │  Phase 2 fails → delete namespace (cascades MySQL + secrets)     │ │
│  │  Phase 3 fails → delete namespace (cascades everything)          │ │
│  │  Phase 4 fails → store still accessible (WP-CLI failures are    │ │
│  │                   non-fatal  WooCommerce can be configured      │ │
│  │                   manually via admin panel)                      │ │
│  │                                                                  │ │
│  │  Namespace delete uses foreground propagation:                   │ │
│  │    K8s waits for ALL child resources to be garbage-collected     │ │
│  │    before the namespace object itself is removed.                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 8. Abuse Prevention & Guardrails

```
┌────────────────────── BLAST RADIUS CONTROLS ──────────────────────────┐
│                                                                        │
│   Request Level                                                        │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │  Rate Limiter         │ Window  │ Max Requests │ Per    │         │
│   │  ─────────────────────┼─────────┼──────────────┼────────│         │
│   │  Global (writes)      │ 15 min  │ 100          │ IP     │         │
│   │  Store Creation       │ 10 min  │   5          │ IP     │         │
│   │  Store Deletion       │ 10 min  │  10          │ IP     │         │
│   │  GET + Health         │  none   │ unlimited    │       │         │
│   └─────────────────────────────────────────────────────────┘         │
│                                                                        │
│   System Level                                                         │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │  Max active stores:        10 (hard cap in orchestrator)│         │
│   │  Provisioning timeout:     5 minutes (deadline pattern) │         │
│   │  MySQL wait timeout:       90 seconds                   │         │
│   │  WordPress wait timeout:   180 seconds                  │         │
│   └─────────────────────────────────────────────────────────┘         │
│                                                                        │
│   Per-Store Level                                                      │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │  ResourceQuota per namespace:                           │         │
│   │    CPU:     500m request / 2 limit                      │         │
│   │    Memory:  512Mi request / 2Gi limit                   │         │
│   │    Storage: 5Gi total                                   │         │
│   │    Pods: 10, Services: 5, PVCs: 3                       │         │
│   │                                                         │         │
│   │  LimitRange per container:                              │         │
│   │    Default: 500m CPU, 512Mi memory                      │         │
│   │    Max:     1 CPU, 1Gi memory                           │         │
│   │                                                         │         │
│   │  NetworkPolicy: deny-by-default,                        │         │
│   │    only allow required ingress/egress                   │         │
│   └─────────────────────────────────────────────────────────┘         │
│                                                                        │
│   Observability                                                        │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │  Audit trail: who created/deleted what, when, from      │         │
│   │  where (source IP). Exposed via GET /api/audit          │         │
│   │  Structured logs: every request logged with duration     │         │
│   │  Health probes: /health/ready checks K8s API + Postgres │         │
│   └─────────────────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Horizontal Scaling Architecture

```
                              CURRENT (local dev)
                    ┌────────────────────────────────────┐
                    │  1× Dashboard   1× API   1× PG    │
                    └────────────────────────────────────┘

                              PRODUCTION READY
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                                                                          │
  │   ┌──────────┐  ┌──────────┐       ┌──────────┐  ┌──────────┐          │
  │   │Dashboard │  │Dashboard │       │   API    │  │   API    │          │
  │   │ replica1 │  │ replica2 │       │ replica1 │  │ replica2 │          │
  │   │ (nginx)  │  │ (nginx)  │       │(Express) │  │(Express) │          │
  │   └────┬─────┘  └─────┬───┘       └────┬─────┘  └─────┬───┘          │
  │        │               │                │              │               │
  │        └───────┬───────┘                └──────┬───────┘               │
  │                │                               │                       │
  │           Stateless ✓                     Stateless ✓                  │
  │           Scale: trivial                  Scale: add replicas          │
  │                                                │                       │
  │                                     ┌──────────┴──────────┐           │
  │                                     │                     │           │
  │                              ┌──────┴──────┐    ┌────────┴────────┐  │
  │                              │ PostgreSQL  │    │ Redis (future)  │  │
  │                              │ (StatefulSet│    │ Rate limit state│  │
  │                              │  single)    │    │ Session store   │  │
  │                              │             │    │ Job queue       │  │
  │                              │ CONSTRAINT: │    └─────────────────┘  │
  │                              │ HA requires │                         │
  │                              │ operator or │    ┌─────────────────┐  │
  │                              │ managed DB  │    │ Job Queue       │  │
  │                              │ (RDS)       │    │ (future)        │  │
  │                              └─────────────┘    │ BullMQ/Redis    │  │
  │                                                 │ Workers pull    │  │
  │   Provisioning Concurrency                      │ store creation  │  │
  │   ─────────────────────────                     │ jobs; retry     │  │
  │   Current: async pipelines run in-process       │ from checkpoint │  │
  │   Each store is independent  concurrent OK     └─────────────────┘  │
  │   Future: external job queue for crash recovery                      │
  │   and worker-based horizontal scaling                                │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘

  What scales horizontally:           Stateful constraints:
  ✓ Dashboard (nginx, stateless)     ✗ PostgreSQL (single replica)
  ✓ API (Express, stateless)         ✗ Rate limiter (in-memory  needs Redis)
  ✓ Provisioning workers (future)    ✗ Audit log (in-memory  needs DB/Redis)
```

---

## 10. Local ↔ Production: Same Charts, Different Values

```
┌──────────── values-local.yaml ────────────┐     ┌──────────── values-prod.yaml ─────────────┐
│                                            │     │                                            │
│  cluster:      Kind (kind-config.yaml)     │     │  cluster:      k3s on VPS                  │
│  ingress:      nginx (manual install)      │     │  ingress:      traefik (built-in k3s)      │
│  domain:       *.localhost (auto-resolve)  │     │  domain:       *.stores.example.com (DNS)   │
│  TLS:          none                        │     │  TLS:          cert-manager + Let's Encrypt  │
│  images:       pullPolicy: Never           │     │  images:       pullPolicy: Always (registry) │
│  log level:    debug                       │     │  log level:    info                          │
│                                            │     │                                              │
│  replicas:                                 │     │  replicas:                                   │
│    api: 1                                  │     │    api: 2                                    │
│    dashboard: 1                            │     │    dashboard: 2                              │
│                                            │     │                                              │
│  storage:                                  │     │  storage:                                    │
│    storageClass: standard                  │     │    storageClass: local-path                  │
│    postgresql: 1Gi                         │     │    postgresql: 20Gi                          │
│    mysql/store: 512Mi                      │     │    mysql/store: 5Gi                          │
│    wordpress/store: 1Gi                    │     │    wordpress/store: 10Gi                     │
│                                            │     │                                              │
│  resources: minimal                        │     │  resources: production-grade                 │
│                                            │     │                                              │
│  ─────────────────────────────             │     │  ─────────────────────────────               │
│  helm install urumi ./helm \               │     │  helm install urumi ./helm \                 │
│    -f values.yaml \                        │     │    -f values.yaml \                          │
│    -f values-local.yaml                    │     │    -f values-prod.yaml                       │
│                                            │     │                                              │
└────────────────────────────────────────────┘     └──────────────────────────────────────────────┘

                     ▲                                              ▲
                     │                                              │
                     └──────────── SAME HELM CHARTS ────────────────┘
                                  SAME TEMPLATES
                                  ZERO CODE CHANGES

  Upgrade:   helm upgrade urumi ./helm -f values-prod.yaml --atomic
             (--atomic: auto-rollback on failure)

  Rollback:  helm rollback urumi 1
             (PostgreSQL password preserved via lookup())
```

---

## 11. Delete & Cleanup Flow

```
  DELETE /api/stores/:id
          │
          ▼
  ┌───────────────────────────────────┐
  │  Validate: store exists, not      │
  │  already deleting/deleted         │
  │  Audit log: delete_requested      │
  └──────────────────┬────────────────┘
                     │
                     ▼
  ┌───────────────────────────────────┐
  │  UPDATE store SET status=deleting │
  │  Dashboard shows spinner          │
  └──────────────────┬────────────────┘
                     │
                     ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  kubectl delete namespace store-{id}                          │
  │  propagationPolicy: Foreground                                │
  │                                                               │
  │  K8s garbage collector removes in order:                      │
  │    1. Pods (WordPress, MySQL) → containers stop               │
  │    2. Services (ClusterIP, headless) → endpoints removed      │
  │    3. Ingress → route removed from controller                 │
  │    4. Secrets → credentials purged                            │
  │    5. PVCs → persistent volumes released/deleted              │
  │    6. Namespace → final removal                               │
  └──────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
  ┌───────────────────────────────────┐
  │  waitForDeletion()                │
  │  Polls every 2s until namespace   │
  │  returns 404 (fully gone)         │
  └──────────────────┬────────────────┘
                     │
                     ▼
  ┌───────────────────────────────────┐
  │  Soft-delete in PostgreSQL        │
  │  (record preserved for audit)     │
  │  Audit log: delete_succeeded      │
  │  Dashboard: store disappears      │
  └───────────────────────────────────┘

  Result: ZERO orphaned resources. Every PVC, Secret, Pod, Service, Ingress  gone.
```

---

## 12. Observability

### Structured Logging (Pino)

```json
{
  "level": 30,
  "time": 1707123456789,
  "storeId": "a1b2c3d4",
  "storeName": "demo-shop",
  "phase": "database",
  "msg": "MySQL StatefulSet ready after 45231ms",
  "password": "[REDACTED]",
  "secret": "[REDACTED]"
}
```

### Health Probes

| Endpoint | K8s Probe | What It Checks | Failure = |
|----------|-----------|----------------|-----------|
| `/health/live` | Liveness | Process alive | Pod restart |
| `/health/ready` | Readiness | K8s API + PostgreSQL reachable | Traffic stopped |
| `/health/metrics` |  | Uptime + memory usage |  |

### Audit Trail

```
GET /api/audit?storeId=a1b2c3d4

{
  "entries": [
    { "action": "create_requested", "timestamp": "...", "sourceIp": "10.0.0.1" },
    { "action": "create_started",   "timestamp": "..." },
    { "action": "status_changed",   "details": { "phase": "namespace" } },
    { "action": "status_changed",   "details": { "phase": "database" } },
    { "action": "status_changed",   "details": { "phase": "application" } },
    { "action": "create_succeeded", "timestamp": "...", "duration": 145231 }
  ],
  "stats": { "total": 6, "created": 1, "deleted": 0, "failed": 0 }
}
```

---

## 13. Extensibility: Adding MedusaJS

The architecture is designed so adding a second store engine requires **no changes to existing code**  only new service files:

```
 Current (WooCommerce)                    Future (MedusaJS)
 ─────────────────────                    ──────────────────
 services/k8s/mysql.ts                    services/k8s/postgres-medusa.ts
 services/k8s/wordpress.ts                services/k8s/medusa.ts
 services/k8s/woocommerce-setup.ts        services/k8s/medusa-setup.ts

 Orchestrator change: one if/else in provisionInBackground()
 Frontend change: enable the MedusaJS radio button
```

The namespace isolation, ResourceQuota, LimitRange, NetworkPolicy, audit logging, and state machine all apply identically regardless of engine.

---

## Design Tradeoffs

| Decision | Tradeoff | Why |
|----------|----------|-----|
| Async provisioning (202) | Dashboard must poll | Prevents HTTP timeout on 2-3 min operations |
| PostgreSQL for state | Extra component to deploy | Survives pod restarts; enables multi-replica API |
| Namespace-per-store | Higher namespace count | Strongest isolation boundary K8s offers |
| WP-CLI via kubectl exec | Requires pods/exec RBAC | No need for OAuth keys or REST API setup at provision time |
| In-memory audit log | Lost on pod restart | MVP tradeoff; structured logs captured externally; DB persistence is a TODO |
| Single-replica PostgreSQL | Not HA | Appropriate for local dev; production would use managed DB or operator |
| 5-min hard deadline | Long-running stores fail | Prevents zombie provisioning from consuming resources indefinitely |
| Soft deletes | DB grows over time | Preserves audit trail; can add periodic cleanup job |
