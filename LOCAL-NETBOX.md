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

## Rovelink Docker Access

When Rovelink is running in Docker, configure its NetBox URL as:

```text
http://host.docker.internal:8000
```

Use the local NetBox API token from `.env.netbox`.
