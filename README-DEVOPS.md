# FinOps Platform — DevOps Guide

Stack: React/Vite · FastAPI · PostgreSQL 16 · Helm 3 · k3s · GitLab CI

---

## 1. Prerequisites

```bash
# Local tools required
docker --version      # ≥ 24
helm version          # ≥ 3.14
kubectl version       # any recent
k3s --version         # optional — for local cluster
```

---

## 2. k3s — Local Kubernetes Cluster

```bash
# Install k3s (single-node, includes kubectl + built-in nginx ingress)
curl -sfL https://get.k3s.io | sh -

# Verify
sudo k3s kubectl get nodes

# Make kubectl usable without sudo
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER ~/.kube/config
chmod 600 ~/.kube/config

# Test
kubectl get nodes
kubectl get pods -A
```

---

## 3. Local Docker Build & Test

Test each service independently before pushing to the registry.

### Backend

```bash
# Build
docker build -t finops-backend:local ./backend

# Run (pass env vars directly for local test)
docker run --rm -p 8000:8000 \
  -e DATABASE_URL="postgresql://admin:admin123@host.docker.internal:5432/finops_db" \
  -e SECRET_KEY="local-dev-secret-key-32-chars-min" \
  -e JWT_SECRET="local-dev-jwt-secret-32-chars-min" \
  finops-backend:local

# Verify
curl http://localhost:8000/
```

### Frontend

```bash
# Build
docker build -t finops-frontend:local ./frontend

# Run
docker run --rm -p 3000:80 finops-frontend:local

# Verify (SPA routing works)
curl http://localhost:3000/
curl http://localhost:3000/some-react-route  # should return index.html
```

### Full stack with Docker Compose (optional local dev)

```bash
# Create docker-compose.yml at project root (not generated — for dev only):
cat > docker-compose.yml <<'EOF'
version: "3.9"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: finops_db
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: admin123
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data/pgdata

  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql://admin:admin123@postgres:5432/finops_db
      SECRET_KEY: local-dev-secret-key-32-chars-min
      JWT_SECRET: local-dev-jwt-secret-32-chars-min
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/"]
      interval: 10s
      retries: 5

  frontend:
    build: ./frontend
    ports: ["3000:80"]
    depends_on: [backend]

volumes:
  pgdata:
EOF

docker compose up --build
```

---

## 4. Helm Deploy — Local Cluster (k3s)

```bash
# 1. Create the namespace (Helm handles this with --create-namespace too)
kubectl create namespace finops

# 2. Create the GitLab registry pull secret if images are in GitLab registry
#    (skip if using local images)
kubectl create secret docker-registry gitlab-registry \
  --docker-server=registry.gitlab.com \
  --docker-username=<your-gitlab-username> \
  --docker-password=<your-deploy-token-or-pat> \
  --namespace finops

# 3. Deploy with Helm (development defaults from values.yaml)
helm upgrade --install finops-platform ./helm \
  --namespace finops \
  --create-namespace \
  --set postgres.password=admin123 \
  --set secrets.secretKey="local-dev-secret-key-32-chars-min" \
  --set secrets.jwtSecret="local-dev-jwt-secret-32-chars-min" \
  --wait \
  --timeout 5m

# 4. Check all resources
kubectl get all -n finops

# 5. Check ingress
kubectl get ingress -n finops
```

### Deploy with custom image tags

```bash
helm upgrade --install finops-platform ./helm \
  --namespace finops \
  --set backend.image=registry.gitlab.com/your-group/finops-platform/backend \
  --set backend.tag=abc123def456 \
  --set frontend.image=registry.gitlab.com/your-group/finops-platform/frontend \
  --set frontend.tag=abc123def456 \
  --set postgres.password="${POSTGRES_PASSWORD}" \
  --set secrets.secretKey="${SECRET_KEY}" \
  --set secrets.jwtSecret="${JWT_SECRET}" \
  --wait
```

### Uninstall

```bash
helm uninstall finops-platform -n finops
kubectl delete namespace finops   # also deletes PVC — data will be lost
```

---

## 5. /etc/hosts Setup (Local Access)

After deploying, map the Ingress hostname to your local machine or cluster IP.

```bash
# Get the Ingress IP (k3s uses 127.0.0.1 for traefik / nginx by default)
kubectl get ingress -n finops

# Add the entry (Linux/macOS)
echo "127.0.0.1  finops.local" | sudo tee -a /etc/hosts

# Windows (PowerShell as Administrator)
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "127.0.0.1  finops.local"

# Verify
curl http://finops.local/          # → React SPA
curl http://finops.local/api/      # → FastAPI ({"detail":"Not Found"} or root response)
```

---

## 6. Alembic Migrations

Run migrations manually after the first deploy (before the app receives traffic):

```bash
# Get the backend pod name
kubectl get pods -n finops -l app=backend

# Run alembic inside the running pod
kubectl exec -n finops deploy/backend -- \
  alembic upgrade head

# Or run a one-off job pod
kubectl run alembic-migrate \
  --image=registry.gitlab.com/your-group/finops-platform/backend:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://admin:admin123@postgres-service.finops.svc.cluster.local:5432/finops_db" \
  --command -- alembic upgrade head \
  -n finops

kubectl logs alembic-migrate -n finops
kubectl delete pod alembic-migrate -n finops
```

---

## 7. GitLab CI/CD Variables Setup

Go to **GitLab → Project → Settings → CI/CD → Variables** and add:

| Variable          | Type     | Protected | Masked | Description                                      |
|-------------------|----------|-----------|--------|--------------------------------------------------|
| `KUBE_CONFIG`     | Variable | ✅        | ✅     | Base64-encoded kubeconfig for the target cluster |
| `SECRET_KEY`      | Variable | ✅        | ✅     | App secret key (min 32 chars)                    |
| `JWT_SECRET`      | Variable | ✅        | ✅     | JWT signing key (min 32 chars)                   |
| `POSTGRES_PASSWORD` | Variable | ✅      | ✅     | Strong postgres password                         |

### Generate the KUBE_CONFIG variable

```bash
# On the server where kubectl is configured for your cluster:
cat ~/.kube/config | base64 -w 0

# Paste the output as the value of KUBE_CONFIG in GitLab
```

### Generate strong secrets

```bash
# SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"

# JWT_SECRET
openssl rand -hex 32
```

---

## 8. Verification Commands

### Check pod health

```bash
# All pods should be Running / Completed
kubectl get pods -n finops -w

# Describe a failing pod
kubectl describe pod <pod-name> -n finops

# Tail logs
kubectl logs -f deploy/backend  -n finops
kubectl logs -f deploy/frontend -n finops
kubectl logs -f statefulset/postgres -n finops
```

### Check secrets (values are base64)

```bash
kubectl get secret finops-secrets  -n finops -o yaml
kubectl get secret postgres-secret -n finops -o yaml

# Decode a specific key
kubectl get secret finops-secrets -n finops \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d
```

### Check services and ingress

```bash
kubectl get svc     -n finops
kubectl get ingress -n finops
kubectl describe ingress finops-ingress -n finops
```

### Check PVC

```bash
kubectl get pvc -n finops
kubectl describe pvc postgres-pvc -n finops
```

### End-to-end API test

```bash
# Health
curl -s http://finops.local/api/ | python3 -m json.tool

# Anomalies endpoint
curl -s http://finops.local/api/v1/anomalies/ | python3 -m json.tool

# Resources endpoint
curl -s http://finops.local/api/v1/resources/ | python3 -m json.tool
```

### Force pod restart (after config change)

```bash
kubectl rollout restart deploy/backend  -n finops
kubectl rollout restart deploy/frontend -n finops
kubectl rollout status  deploy/backend  -n finops
```

### Helm status & diff

```bash
helm status  finops-platform -n finops
helm history finops-platform -n finops

# Dry-run before apply
helm upgrade finops-platform ./helm \
  --namespace finops \
  --dry-run \
  --set postgres.password=admin123 \
  --set secrets.secretKey=local-key
```

---

## 9. Architecture Overview

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  Kubernetes Ingress (nginx)             │
│  finops.local                           │
│   /api/*  ──────────────► backend:8000  │
│   /*       ─────────────► frontend:80   │
└─────────────────────────────────────────┘
         │                     │
         ▼                     ▼
  ┌─────────────┐     ┌──────────────────┐
  │   FastAPI   │     │  nginx (React)   │
  │  (backend)  │     │   SPA routing    │
  └──────┬──────┘     └──────────────────┘
         │
         ▼
  ┌─────────────┐
  │ PostgreSQL  │  ← PVC 5Gi
  │  (postgres) │
  └─────────────┘
```

**Secrets flow:**
- `postgres-secret` → postgres StatefulSet (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)
- `finops-secrets`  → backend Deployment (DATABASE_URL, SECRET_KEY, JWT_SECRET) via `envFrom`

**Startup order:**
1. PostgreSQL StatefulSet starts
2. Backend initContainer (`wait-for-postgres`) loops until `pg_isready` succeeds
3. Backend main container starts uvicorn
4. Frontend starts nginx (no DB dependency)
