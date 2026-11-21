# Infra (OpenTofu, Scaleway)

The smallest setup for the practice site with sessions and a database:

| Resource | Type | Notes |
|---|---|---|
| Web server | `STARDUST1-S` (1 vCPU, 1 GB RAM, 10 GB SSD) | Ubuntu 24.04, 2 GB swap, Docker |
| Web / HTTPS | Caddy container | serves this repo as a static site; gets a certificate once `domain` is set |
| Sessions | Redis container (sidecar) | not exposed; 64 MB, password from `.env` |
| Database | Managed PostgreSQL `DB-DEV-S`, 5 GB | only the web server's IP may connect |
| DNS | A records `xuexi.nl` and `www.xuexi.nl` | in the existing Scaleway DNS zone |

## Use

```bash
export SCW_ACCESS_KEY=...          # Scaleway console → IAM → API keys
export SCW_SECRET_KEY=...
export SCW_DEFAULT_PROJECT_ID=...
export AWS_ACCESS_KEY_ID=$SCW_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$SCW_SECRET_KEY   # for the state bucket
cp terraform.tfvars.example terraform.tfvars   # add your SSH public key
tofu init -backend-config="bucket=<your state bucket>"
tofu plan
tofu apply
```

## GitHub Actions

`.github/workflows/infra.yml` runs `tofu plan` on every push or pull request that touches `infra/`.
To create or change resources, run the workflow by hand (Actions → Infra (OpenTofu) → Run workflow)
and tick **apply**. It uses the `production` environment:

| Name | Kind | Value |
|---|---|---|
| `SCWACCESSKEYID` | secret | API access key of the `xuexi` application |
| `SCWSECRETKEY` | secret | its secret key |
| `SCW_DEFAULT_PROJECT_ID` | secret or variable | the project id |
| `SSH_PUBLIC_KEY` | secret or variable | your SSH public key |
| `TF_STATE_BUCKET` | variable | name of the Object Storage bucket for the state |

The IAM policy of `xuexi` needs: InstancesFullAccess, RelationalDatabasesFullAccess, SSHKeysFullAccess,
DomainsDNSFullAccess (for the xuexi.nl records) and ObjectStorageFullAccess (for the state bucket).

After `apply`:

- The A records for `xuexi.nl` and `www.xuexi.nl` point at the server automatically; Caddy fetches HTTPS certificates once DNS has spread (usually a few minutes). `www` redirects to the bare domain. Changing `domain` later recreates the server, because cloud-init only runs on first boot.
- `tofu output -raw database_url` and `tofu output -raw redis_password` give the secrets. They are also in `/opt/app/.env` on the server.
- On the server, everything is in `/opt/app` (`docker compose ps`, `docker compose logs`). Update the site with `cd /opt/app/site && git pull`.

Stardust is not always in stock. If `apply` fails on the server, try another zone (`zone = "fr-par-1"`).

The state file holds the database and Redis passwords. It lives in the private state bucket (see `backend.tf`), never in git.
