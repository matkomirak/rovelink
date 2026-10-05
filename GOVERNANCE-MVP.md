# Governance MVP

This document describes the current Rovelink Governance MVP and the local testing flow for validating it.

## What Rovelink Does Now

Rovelink is a TypeScript full-stack infrastructure automation platform. The React/Vite frontend talks to an Express API backed by Drizzle and Postgres. The current MVP connects inventory, CMDB visibility, governance evaluation, and automation readiness in one workflow:

- CMDB accounts store external CMDB connection details with secrets encrypted at rest.
- NetBox VM data can be browsed and cached locally.
- Governance blueprints define how cached CMDB objects should be evaluated.
- Governance evaluation runs produce scores, findings, recommended actions, and automation readiness.
- Automation inventories remain protected by the Automation GATE, with optional inventory-level governance enforcement layered on top.

## CMDB Object Browser

The CMDB object browser currently focuses on NetBox virtual machines first. NetBox VM records are imported into Rovelink's local database cache and can be inspected from the app without making NetBox the write target for governance decisions.

The browser is intended to help operators answer:

- Which CMDB objects are visible to Rovelink?
- Which source did an object come from?
- Has the object been evaluated by a governance blueprint?
- Is the object governance-ready for automation?
- What findings or recommended actions apply?

NetBox VM browsing is the supported first object type. Broader CMDB object browsing is future work.

## Governance Blueprints

Governance blueprints are versioned policy definitions for evaluating CMDB objects. The current default blueprint targets `netbox_vm` objects and checks data management, ownership, relevance, and automation readiness signals.

Blueprints are organization-scoped. A blueprint can be bound to a NetBox inventory source, activated through an explicit active-version flow, and used to evaluate cached NetBox VMs. Directly setting a blueprint to active is intentionally avoided; activation goes through the dedicated activation path.

## Cached CMDB Evaluation

Governance evaluation runs use cached CMDB objects. For NetBox VMs, Rovelink imports VM data from the configured NetBox source into local `netbox_vms` records, then evaluates those cached records.

This keeps the Governance MVP deterministic and inspectable:

- Evaluation operates on the data Rovelink has already imported.
- Results are stored as governance evaluation runs and object evaluations.
- The latest evaluation can be shown beside the relevant object or inventory host.
- Evaluation does not write governance state back to NetBox.

Because evaluation uses cached data, users should refresh/import the relevant NetBox VM cache before treating findings as current.

## Governance Findings And Readiness

Each object evaluation stores:

- governance score
- data management score
- ownership score
- relevance-weighted priority
- automation readiness
- findings
- recommended actions

Findings are grouped into layers such as data management, ownership, relevance, and automation readiness. Recommended actions can include operational follow-up such as improving CMDB data or blocking automation.

Readiness is a governance signal, not a replacement for the Automation GATE. A VM can have governance context shown in the UI while still being subject to normal gate checks.

## Automation GATE Awareness

The Automation GATE remains the authoritative safety layer for automation inventory generation. It checks CMDB governance requirements such as tenant, role, active state, and the `automatable` custom field before a VM can be included for automation.

Governance evaluation adds context around those gate decisions:

- Allowed and blocked inventory views can display governance score, readiness, finding count, and recommended actions.
- Generated inventory can include governance object identity metadata for cached NetBox VMs.
- Gate decisions avoid relying on VM names for governance enforcement; enforcement requires explicit governance object identity.

Do not bypass or weaken GATE logic when extending governance features.

## Optional Governance Enforcement

Governance enforcement is configured at the automation inventory level. The default mode is `observe_only`, so governance information is displayed but does not block automation.

Available modes:

- `observe_only`: show governance context only.
- `warn_only`: show governance warnings without blocking execution.
- `enforce`: allow governance policy to block inventory export or run eligibility.

Inventory policy can require an existing governance evaluation, set a minimum governance score, block on a `block_automation` recommendation, and require ready governance state. Enforcement is inventory-level and opt-in; it is not global.

## Sidebar And Account Menu UX

The app sidebar includes a Governance entry that opens the Governance workspace. From there, users can create or inspect blueprints, launch cached NetBox VM evaluations, and review evaluation runs.

The account menu and authenticated layout continue to use HttpOnly cookie-based login state. Governance documentation and future UX work must preserve the current auth model and tenant-aware navigation behavior.

## Manual Local Test Checklist

Use this checklist for local validation before claiming Governance MVP work is complete.

1. Start the main stack:

   ```powershell
   docker compose up -d --build
   ```

2. Open Rovelink:

   ```text
   http://localhost:5000/login
   ```

3. Log in with local bootstrap credentials unless overridden:

   ```text
   username: admin
   password: changeme
   ```

4. Optional: start local NetBox:

   ```powershell
   docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml up -d
   ```

5. Configure a NetBox CMDB in Rovelink. When Rovelink runs in Docker and NetBox runs on the Windows host, use:

   ```text
   http://host.docker.internal:8000
   ```

6. Import or refresh cached NetBox VM data.

7. Open Governance from the sidebar.

8. Create or activate a NetBox VM governance blueprint.

9. Run a cached NetBox VM governance evaluation.

10. Open the evaluation run and confirm object scores, findings, recommended actions, and readiness are visible.

11. Open a linked automation inventory and confirm Governance context appears alongside allowed or blocked GATE results.

12. Leave governance enforcement in `observe_only` unless specifically testing `warn_only` or `enforce`.

13. Run repository checks:

   ```powershell
   npm.cmd run check
   npm.cmd test
   npm.cmd run build
   ```

## Known Limitations

- Governance evaluation uses cached CMDB objects.
- NetBox VM browsing is supported first.
- Other CMDB object types are future work.
- Enforcement is inventory-level and `observe_only` by default.
- No NetBox write-back from governance evaluation. Legacy CMDB pipelines and
  the optional NetBox demo seed are separate write paths.
- No ServiceNow, i-doit, or BMC integrations yet for governance object browsing/evaluation.
