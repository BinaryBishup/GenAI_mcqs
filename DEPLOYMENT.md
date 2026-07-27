# Deploying to AWS (EC2 + RDS)

The app runs as a plain Next.js server behind nginx, with data in **RDS
Postgres** (direct connection — no Supabase data plane) and **auth still on
Supabase** (Phase 3 migrates it). One env var — `DATABASE_URL` — flips the data
plane: set → RDS, unset → Supabase. That is also the rollback lever.

## 1. Provision

**EC2**: t3.medium (2 vCPU / 4 GB), Ubuntu 22.04+, Elastic IP.
Security group: 80/443 from anywhere, 22 from your IP only.

**RDS Postgres 15/16**: db.t3.small to start, same VPC.
Security group: 5432 **only from the EC2 security group**. Enable automated
backups. No extensions to preinstall — the schema creates `pg_trgm` itself.

## 2. First-time server setup

```bash
# from your laptop — get the code up first so the setup script exists there
./deploy/deploy.sh ubuntu@<host>       # fails at the .env check — that's fine, code is synced
ssh ubuntu@<host>
bash /var/www/assessly/deploy/setup-server.sh
cp /var/www/assessly/.env.production.example /var/www/assessly/.env.production
vi /var/www/assessly/.env.production   # fill in every key
```

## 3. Database

**Fresh database** (no data to carry over):

```bash
psql "$DATABASE_URL" -f /var/www/assessly/deploy/schema.sql
```

**Migrating existing Supabase data**: Supabase exposes a direct Postgres
connection (Project Settings → Database). Then:

```bash
pg_dump "<supabase-conn-string>" --schema=public --no-owner --no-privileges -Fc -f assessly.dump
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" assessly.dump
```

The dump carries schema + data, so skip schema.sql in this path. Legacy `old_*`
tables can be excluded with `--exclude-table 'old_*'`.

## 4. Deploy (every release)

```bash
./deploy/deploy.sh ubuntu@<host>
```

That rsyncs the source, `npm ci && next build` on the server, and hot-reloads
PM2. Verify: `curl https://<domain>/api/health` and run one full generation.

## 5. TLS + DNS

Point the domain at the Elastic IP, put it in `deploy/nginx.conf`
(`server_name`), redeploy, then:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domain>
```

## What changed vs Vercel (already handled in code/config)

| Concern | How it's handled |
|---|---|
| Data access | `lib/pg-rest.ts` — direct-Postgres adapter behind `supabaseAdmin()`, active when `DATABASE_URL` is set. Tested by `scripts/test-pg-rest.ts` (run it against any new DB). |
| Auth | Still Supabase (`supabaseAuthAdmin()`), needs the Supabase env keys. Phase 3 replaces it. |
| Long generations | No serverless timeout on EC2 — the 800 s Vercel cap is gone; `maxDuration` exports become no-ops; `after()` works under `next start`. |
| SSE streaming | nginx: `proxy_buffering off` + 1800 s read timeout (deploy/nginx.conf). |
| 20 MB uploads | nginx `client_max_body_size 25m`. |
| Process lifecycle | PM2 (`ecosystem.config.cjs`): auto-restart, reboot persistence, 1.2 GB memory limit. |

## Rollback

- **Bad release**: `pm2 reload assessly` with the previous rsync, or redeploy the previous git commit.
- **RDS trouble**: comment out `DATABASE_URL` in `.env.production`, `pm2 restart assessly` — the app is back on Supabase data instantly (keep the two databases in sync until you're confident, or accept the fork).

## Ops checklist

- CloudWatch agent (or at minimum `pm2 monit`) + disk alarm — EC2 has no platform babysitter.
- `pm2 install pm2-logrotate` so logs don't fill the disk.
- RDS: automated backups on, 7-day retention minimum.
- Secrets: prefer SSM Parameter Store over the flat `.env.production` once things settle.
