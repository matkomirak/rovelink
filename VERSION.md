# Bridge Version History

## v1.0 - "no-bridge-pipeline-code" (Pre-Pipeline Implementation)
**Date:** October 20, 2025  
**Status:** Baseline version before pipeline orchestration

### Features Included

#### Core Infrastructure
- ✅ Authentication & Authorization (JWT, bcrypt, role-based access control)
- ✅ PostgreSQL database with Drizzle ORM
- ✅ WebSocket support for real-time log streaming
- ✅ RESTful API for all resources

#### NetBox Integration
- ✅ Multi-source NetBox inventory management
- ✅ VM import with detailed metadata (OS, IP, tags, custom fields)
- ✅ Custom fields display in VMs table and edit dialog
- ✅ Keyed groups for dynamic host targeting
  - `wave_*` - Patch wave groups
  - `customer_*` - Customer/tenant groups
  - `os_*` - Operating system groups
  - `role_*` - Device role groups
- ✅ Preflight validation and autocomplete for limit expressions
- ✅ Group cache with rebuild functionality
- ✅ Inventory health reporting

#### Job Management
- ✅ Project management (Git repositories, playbook discovery)
- ✅ Credentials management (SSH, WinRM, sudo, vault)
- ✅ Job templates with limit expressions, extra vars, check/diff mode
- ✅ Job runs with simulated Ansible execution (FakeRunner)
- ✅ Real-time log streaming via WebSockets
- ✅ Job scheduling (deferred execution)
- ✅ CSV export of job logs

#### Provider System
- ✅ Extensible factory pattern for virtualization providers
- ✅ Provider account management
- ✅ Sync workers for VM collection
- ✅ External object mapping
- ✅ Sync run history
- ✅ Housekeeping operations (cache rebuild, schema ensure, prune stale, retry failed)

#### Additional Features
- ✅ Reports dashboard (inventory health, run statistics)
- ✅ Configurable notifications (email, webhook)
- ✅ Settings management
- ✅ Dark-first UI with Inter font and JetBrains Mono for code

### What's NOT Included
- ❌ Bridge pipeline orchestration code
- ❌ Pipeline builder/editor
- ❌ Multi-step workflow definitions
- ❌ Pipeline execution engine

### Technical Stack
- **Frontend:** React 18 + TypeScript + Tailwind CSS + Shadcn UI
- **Backend:** Express.js + TypeScript
- **Database:** PostgreSQL (Neon serverless) + Drizzle ORM
- **Real-time:** WebSockets
- **Auth:** JWT + bcrypt

### Key Files
- `inventory/netbox.yml` - NetBox inventory with keyed_groups configuration
- `shared/schema.ts` - Database schema definitions
- `server/routes.ts` - API endpoints
- `server/services/fake-runner.ts` - Simulated Ansible execution
- `server/services/netbox.ts` - NetBox API integration
- `client/src/pages/` - React page components

---

## Future Versions

### v2.0 - "bridge-pipeline-code" (Planned)
Will include Bridge pipeline orchestration functionality:
- Pipeline builder/editor UI
- Multi-step workflow definitions
- Pipeline execution engine
- Pipeline templates and versioning
- Advanced orchestration features
