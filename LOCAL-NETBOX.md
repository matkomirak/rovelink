# Local NetBox

This optional stack runs NetBox separately from the main Rovelink Docker Compose stack.
It uses its own Postgres, Redis services, and Docker volumes.

## Start

```bash
cp .env.netbox.example .env.netbox
# Edit .env.netbox and replace the placeholder passwords, secret key, API token, and API token pepper.
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml up -d
```

## Stop

```bash
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml down
```

## Login

Open NetBox at:

```text
http://localhost:8000
```

The initial admin username/password come from:

```text
NETBOX_SUPERUSER_NAME
NETBOX_SUPERUSER_PASSWORD
```

The API token comes from:

```text
NETBOX_SUPERUSER_API_TOKEN
```

NetBox also requires `API_TOKEN_PEPPERS` to save and use v2 API tokens. The Docker image populates that setting from:

```text
NETBOX_API_TOKEN_PEPPER_1
```

For Rovelink and local seed scripts, create or copy a NetBox API token from the NetBox UI:

```text
Admin menu -> API Tokens -> Add a token
```

Copy the token into `.env.netbox` as:

```text
NETBOX_TOKEN=<local-netbox-api-token>
```

Use the base NetBox URL in the same file:

```text
NETBOX_URL=http://localhost:8000
```

## Optional Demo Seed

The demo seed is opt-in only and never runs automatically during `docker compose up`.

After NetBox is running and `.env.netbox` has `NETBOX_URL` and `NETBOX_TOKEN`, run:

```powershell
npm.cmd run netbox:seed:demo
```

The script creates or reuses:

```text
site: rovelink-lab
cluster type: docker-lab
cluster: local-netbox-lab
VMs: demo-vm-001 through demo-vm-020
```

## Rovelink Docker Access

When Rovelink is running in Docker, configure its NetBox URL as:

```text
http://host.docker.internal:8000
```

Use a base URL such as `https://netbox.example.com`, without `/api` at the end.
If Rovelink runs in Docker and NetBox runs on the host at `http://localhost:8000`,
set the CMDB connection URL to `http://host.docker.internal:8000`.
Inside the Rovelink container, `localhost` points to that container, not the host.
Your browser and seed scripts running directly on the host can still use
`http://localhost:8000`.

Enter the raw NetBox API token only, for example `nbt_xxx` (a placeholder).
Do not paste a `Bearer` or `Token` prefix into the token field.
