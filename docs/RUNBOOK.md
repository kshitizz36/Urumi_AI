# Urumi Platform Runbook

## Overview

This runbook provides operational procedures for managing the Urumi Platform in production.

---

## Quick Reference

| Task | Command |
|------|---------|
| Check API health | `curl http://urumi.localhost/health/ready` |
| List stores | `curl http://urumi.localhost/api/stores` |
| View API logs | `kubectl logs -n urumi-platform -l app=urumi-api -f` |
| View store pods | `kubectl get pods -n store-{id}` |
| Force delete store | `kubectl delete ns store-{id}` |

---

## Common Operations

### Deploy New Version

```bash
# Build new images
docker build -t urumi/api:v1.1.0 ./backend
docker build -t urumi/dashboard:v1.1.0 ./frontend

# If using Kind
kind load docker-image urumi/api:v1.1.0 urumi/dashboard:v1.1.0 --name urumi-dev

# Upgrade Helm release
helm upgrade urumi ./helm/urumi-platform \
  --set api.image.tag=v1.1.0 \
  --set dashboard.image.tag=v1.1.0
```

### Scale API Replicas

```bash
kubectl scale deployment urumi-api -n urumi-platform --replicas=3
```

### View Logs

```bash
# API logs
kubectl logs -n urumi-platform -l app=urumi-api -f

# Store logs (WordPress)
kubectl logs -n store-{id} -l app.kubernetes.io/name=wordpress -f

# Store logs (MySQL)
kubectl logs -n store-{id} -l app.kubernetes.io/name=mysql -f
```

---

## Troubleshooting

### Store Stuck in "Provisioning"

**Symptoms:** Status never changes from `provisioning`

**Diagnosis:**
```bash
# Check store namespace
kubectl get all -n store-{id}

# Check MySQL pod
kubectl describe pod -n store-{id} -l app.kubernetes.io/name=mysql

# Check WordPress pod
kubectl describe pod -n store-{id} -l app.kubernetes.io/name=wordpress

# Check events
kubectl get events -n store-{id} --sort-by='.lastTimestamp'
```

**Common Causes:**
1. **Image pull failure** - Check imagePullSecrets
2. **Insufficient resources** - Check ResourceQuota limits
3. **PVC pending** - Check StorageClass availability
4. **MySQL not starting** - Check MySQL logs for errors

**Resolution:**
```bash
# Force cleanup (delete the whole namespace)
kubectl delete ns store-{id}

# Then retry via API
curl -X DELETE http://urumi.localhost/api/stores/{id}
```

### Store Shows "Failed"

**Symptoms:** Store status is `failed` with error message

**Diagnosis:**
```bash
# Get store details via API
curl http://urumi.localhost/api/stores/{id} | jq

# Field 'errorMessage' and 'errorPhase' indicate where it failed
```

**Resolution:**
1. Delete the failed store
2. Check API logs for error details
3. Fix underlying issue
4. Retry creation

### Dashboard Not Loading

**Symptoms:** http://urumi.localhost returns 502/504

**Diagnosis:**
```bash
# Check ingress
kubectl get ingress -n urumi-platform

# Check dashboard pod
kubectl get pods -n urumi-platform -l app=urumi-dashboard

# Check nginx ingress logs
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller
```

### API Returns 500 Errors

**Diagnosis:**
```bash
# Check API pod status
kubectl get pods -n urumi-platform -l app=urumi-api

# View recent logs
kubectl logs -n urumi-platform -l app=urumi-api --tail=100

# Check readiness
curl http://urumi.localhost/health/ready
```

**Common Causes:**
1. K8s cluster unreachable
2. RBAC misconfigured
3. PostgreSQL connection failed

---

## Disaster Recovery

### Restore After Cluster Rebuild

1. Reinstall nginx ingress
2. Reinstall Helm chart
3. Stores must be recreated (data not persisted outside PVCs)

```bash
# Fresh install
./scripts/setup-local.sh
```

### Backup Store Data

For production, backup WordPress content:

```bash
# Export WordPress database
kubectl exec -n store-{id} -it sts/mysql -- \
  mysqldump -u wordpress -p wordpress > backup.sql

# Backup WordPress files
kubectl exec -n store-{id} -it deploy/wordpress -- \
  tar -czf - /opt/bitnami/wordpress > wordpress-files.tar.gz
```

---

## Monitoring

### Key Metrics to Watch

1. **API health** - `/health/ready` returns 200
2. **Store count** - Total stores vs failed stores
3. **Provisioning time** - Average/P95/P99
4. **Pod restarts** - Should be 0 in steady state

### Alerting Recommendations

| Alert | Threshold | Severity |
|-------|-----------|----------|
| API unhealthy | 2+ minutes | Critical |
| Store provisioning failed | Any | Warning |
| Provisioning time > 5min | P95 | Warning |
| Node memory > 80% | 5+ minutes | Warning |

---

## Maintenance

### Cleanup Orphaned Resources

```bash
# List all store namespaces
kubectl get ns | grep "^store-"

# Compare with API state
curl http://urumi.localhost/api/stores | jq '.[].namespace'

# Delete orphaned namespaces
kubectl delete ns store-orphaned-id
```

### Resource Cleanup

```bash
# Delete old completed jobs
kubectl delete jobs --field-selector status.successful=1 --all-namespaces

# Clean up unused PVs
kubectl delete pv --field-selector status.phase=Released
```
