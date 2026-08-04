# Local Development

This workflow starts Rovelink, optional local NetBox, demo VM data, public Git
project sync, and localhost-only Ansible execution.

## Start Rovelink

```powershell
docker compose up -d --build
```

Rovelink is available at:

```text
http://localhost:5000
```

Default local login values come from `docker-compose.yml`:

```text
username: admin
password: changeme
```

Docker Compose also sets:

```text
ROVELINK_LOCAL_DEV=true
ROVELINK_GIT_ALLOWED_HOSTS=github.com
ROVELINK_LOCAL_RUNNER_ENABLED=true
```

That marker is what allows the intentionally weak `changeme` password for local
first-run development. Do not use `ROVELINK_LOCAL_DEV=true` in production.
`ROVELINK_GIT_ALLOWED_HOSTS` controls where server-side Git sync may connect,
and production must set a non-empty allowlist. Local Ansible execution is also
guarded by `ROVELINK_LOCAL_RUNNER_ENABLED`; keep it disabled in production
unless the app host is intentionally allowed to run `ansible-playbook`.

Bootstrap seeding is idempotent. If the admin user already exists, the seed step
does not reset or overwrite the existing password.

Docker Compose stores synced Git project checkouts in a named volume mounted at:

```text
/data/git-projects
```

The app uses this path through:

```text
ROVELINK_PROJECTS_ROOT=/data/git-projects
```

This keeps synced project checkouts available after app container rebuilds.

## Start NetBox

Create a local env file if needed:

```powershell
Copy-Item .env.netbox.example .env.netbox
```

Edit `.env.netbox` and set local-only values for passwords, token, secret key,
and API token pepper. Then start NetBox:

```powershell
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml up -d
```

NetBox is available at:

```text
http://localhost:8000
```

## Seed Demo VMs

After NetBox is running and `.env.netbox` has `NETBOX_URL` and `NETBOX_TOKEN`,
run:

```powershell
npm.cmd run netbox:seed:demo
```

The seed script is optional and never runs automatically.

## Configure Rovelink CMDB

When Rovelink runs in Docker, configure the NetBox CMDB URL as:

```text
http://host.docker.internal:8000
```

Use the local NetBox API token from `.env.netbox`.

## Sync A Public Git Project

In Rovelink, create or update a Project with a public HTTPS Git URL. For example:

```text
https://github.com/ansible/ansible-examples.git
```

Then click `Sync`. The checkout path should be under:

```text
/data/git-projects/<org-id>/<project-id>/repo
```

Private Git URLs, SSH Git URLs, and embedded URL credentials are intentionally
not supported in local slice 1. Git hosts must be listed in
`ROVELINK_GIT_ALLOWED_HOSTS`, and localhost/private/link-local addresses are
rejected.

## Run A Localhost Playbook

Create a Job Template that uses:

```text
runnerMode: local
playbook: path/to/localhost-playbook.yml
```

For this local slice, the playbook must target only:

```text
localhost
127.0.0.1
::1
```

Rovelink still computes and stores the gate snapshot before execution. For
localhost-only playbooks, it uses a generated local inventory with
`ansible_connection: local`.

Remote SSH execution and SSH/private key credential storage are not implemented
in this local workflow yet.

Local runner execution is bounded by:

```text
ROVELINK_LOCAL_RUNNER_TIMEOUT_MS=600000
ROVELINK_LOCAL_RUNNER_MAX_OUTPUT_BYTES=1048576
```

## Stop Commands

Stop Rovelink:

```powershell
docker compose down
```

Stop NetBox:

```powershell
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml down
```
