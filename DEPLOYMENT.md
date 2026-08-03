# Deploying to AWS (EC2 + RDS)

The app runs as a plain Next.js server behind nginx, with all state in **RDS
Postgres**. There is no external identity provider and no hosted data API — the
only outbound calls are to the Anthropic API and, optionally, Tavily.
Everything else works inside the VPC.

## 1. Provision

**EC2**: t3.medium (2 vCPU / 4 GB), Ubuntu 22.04+, Elastic IP. Runs **Node 24 LTS** —
`setup-server.sh` installs it from NodeSource. Node 20 is end-of-life (April 2026);
Next.js itself only requires >= 20, but do not deploy onto an unpatched runtime.
Security group: 80/443 from anywhere, 22 from your IP only.

**RDS Postgres 15/16**: db.t3.small to start, same VPC.
Security group: 5432 **only from the EC2 security group**. Enable automated
backups. No extensions to preinstall — the schema creates `pg_trgm` itself.

## 2. First-time server setup

```bash
# from your laptop — get the code up first so the setup script exists there
./deploy/deploy.sh ubuntu@<host>       # fails at the .env check — that's fine, code is synced
ssh ubuntu@<host>
bash /var/www/smartcogen/deploy/setup-server.sh
cp /var/www/smartcogen/.env.production.example /var/www/smartcogen/.env.production
vi /var/www/smartcogen/.env.production   # fill in every key
```

Generate the session signing key while you are there:

```bash
openssl rand -base64 48     # paste into AUTH_JWT_SECRET
```

It must be **identical on every app instance** behind a load balancer, or a
session issued by one will not validate on another. Rotating it signs everyone
out — which is also the emergency "revoke all sessions" lever.

## 3. Database

**Fresh database** (no data to carry over):

```bash
psql "$DATABASE_URL" -f /var/www/smartcogen/deploy/schema.sql
```

**Existing database** that predates self-hosted auth — add the `users` table in
place rather than recreating anything:

```bash
psql "$DATABASE_URL" -f /var/www/smartcogen/deploy/migrations/001_local_auth.sql
```

**Moving data between environments**: `pg_dump`/`pg_restore` the whole public
schema.

```bash
pg_dump "<source-conn-string>" --schema=public --no-owner --no-privileges -Fc -f smartcogen.dump
pg_restore --no-owner --no-privileges -d "$DATABASE_URL" smartcogen.dump
```

The dump carries schema + data, so skip schema.sql in that path. Legacy `old_*`
tables can be excluded with `--exclude-table 'old_*'`.

## 4. Create accounts

The app has no self-signup, so a fresh database has no way in until you
provision one. From the server (or anywhere with `DATABASE_URL` set):

```bash
cd /var/www/smartcogen
npm run user:create -- --email you@company.com --password 'choose-a-password' --name "Your Name" --team ALL
```

You choose the password explicitly — nothing is generated, nothing is temporary,
and there is no forced reset on first sign-in. Repeat per user; `--team` accepts any of
`HACK, Cognitive, Domain, Psychometric, SEG, ALL`, and `--teams A,B` grants
extras beyond the primary. `npm run user:list` shows who exists.

Password hashes are bcrypt. If you are carrying users over from another system
that also used bcrypt, the hashes can be inserted into `users.password_hash`
directly and those users keep their passwords.

## 5. Deploy (every release)

```bash
./deploy/deploy.sh ubuntu@<host>
```

That rsyncs the source, `npm ci && next build` on the server, and hot-reloads
PM2. Verify: `curl https://<domain>/api/health` — `env.database` must be `true`,
which means a real query round-tripped — then sign in and run one full generation.

## 6. TLS + DNS

Point the domain at the Elastic IP, put it in `deploy/nginx.conf`
(`server_name`), redeploy, then:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domain>
```

TLS is not optional: the session cookie is issued with `Secure` in production,
so the app cannot be signed into over plain HTTP.

## Runtime notes

| Concern | How it's handled |
|---|---|
| Data access | `lib/db.ts` — a node-postgres pool plus a narrow query builder. Every value is a bound parameter; identifiers are validated against a strict pattern. |
| Auth | `lib/auth.ts` — bcrypt (cost 12) hashes in `users`, HS256 session JWT in an httpOnly, SameSite=Lax, Secure cookie. Team grants are signed into the token. |
| Long generations | No platform timeout under `next start`; `after()` keeps a run alive past client disconnect. |
| SSE streaming | nginx: `proxy_buffering off` + 1800 s read timeout (deploy/nginx.conf). |
| 20 MB uploads | nginx `client_max_body_size 25m`. |
| Process lifecycle | PM2 (`ecosystem.config.cjs`): auto-restart, reboot persistence, 1.2 GB memory limit. |
| Connection pool | `DATABASE_POOL_MAX` (default 10) per app process. Keep `instances × pool_max` under the RDS `max_connections`. |

## Rollback

- **Bad release**: `pm2 reload smartcogen` with the previous rsync, or redeploy the previous git commit.
- **Compromised session key**: change `AUTH_JWT_SECRET` and `pm2 restart smartcogen` — every outstanding session is invalidated immediately.
- **Locked-out admin**: `npm run user:passwd -- --email you@company.com --password 'new-password'` from the server.

## Ops checklist

- CloudWatch agent (or at minimum `pm2 monit`) + disk alarm — EC2 has no platform babysitter.
- `pm2 install pm2-logrotate` so logs don't fill the disk.
- RDS: automated backups on, 7-day retention minimum.
- Secrets: prefer SSM Parameter Store over the flat `.env.production` once things settle — `AUTH_JWT_SECRET` and `DATABASE_URL` especially.
- Rate-limit `POST /api/auth/login` at nginx or the load balancer if the app is internet-facing; the app does not throttle sign-in attempts itself.
