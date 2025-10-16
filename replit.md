# Bridge - Infrastructure Automation Platform

## Overview
Bridge is a full-stack infrastructure automation UI that integrates with NetBox inventory, manages job templates, and orchestrates execution runs with simulated Ansible playbooks. Built with React, Express, PostgreSQL, and WebSocket for real-time log streaming.

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Neon serverless) via Drizzle ORM
- **Real-time**: WebSocket for live log streaming
- **Authentication**: JWT-based with bcrypt password hashing
- **External Integration**: NetBox REST API (read-only)

### Database Schema
- **users**: Authentication with role-based access (admin/operator/viewer)
- **projects**: Git repositories with Ansible playbooks
- **credentials**: Mock credential references (no real secrets stored)
- **jobTemplates**: Job configuration with playbook, limits, extra vars
- **jobRuns**: Execution history with logs, results, and archive status
- **notifications**: Email/webhook configurations with trigger conditions
- **settings**: Key-value configuration storage
- **providerAccounts**: Provider configurations (Proxmox/VMware/Azure) with credentials
- **syncRuns**: Provider sync execution history with status and logs
- **externalObjects**: Provider-to-NetBox object mappings (VMs, IPs) with external IDs
- **groupCache**: Performance cache for NetBox inventory groups (autocomplete optimization)
- **netboxVms**: Imported NetBox VMs with name, IP, OS, custom fields, and tags

## Features Implemented

### Authentication & Authorization
- Username/password authentication with JWT tokens
- Role-based access control (admin, operator, viewer)
- Protected routes with server-side middleware

### NetBox Integration
- Read-only inventory access via REST API
- Group and host browsing
- Preflight validation for limit expressions
- Inventory health reporting (coverage %, missing IPs/users)
- **VM Import**: Import virtual machines from NetBox with full metadata
  - Fetches VMs via NetBox virtualization API
  - Captures: Name, IP address, Operating System, Custom Fields, Tags
  - Operating system normalization (Linux/Windows/Other/Unknown)
  - Full replacement sync with persistence
  - Admin-only import capability

### Project Management
- Git repository CRUD operations
- Mock repository sync with playbook discovery
- Sync status tracking (pending, syncing, success, error)

### Credentials Management
- CRUD for credential references
- Support for SSH key, WinRM, sudo, vault types
- Non-secret metadata storage with external secret references

### Job Templates
- Template creation with project, playbook, credential selection
- Limit expression configuration with inline preflight
- Extra variables (JSON), check mode, diff mode support
- Launch and schedule capabilities

### Job Runs
- FakeRunner simulates Ansible execution (10-30s duration)
- Real-time log streaming via WebSocket
- Status transitions: queued → running → ok/failed
- Persistent logs and result summaries in database
- CSV export functionality

### Scheduling
- Date/time picker for deferred execution
- Scheduled runs stored with scheduledAt timestamp
- Background execution trigger (simplified for MVP)

### Reports Dashboard
- Inventory Health widget: coverage %, hosts with IP/user
- Run Statistics: success rate, total counts, recent failures
- Visual metrics with progress bars and status indicators

### Notifications
- Configurable email and webhook notifications
- Trigger conditions: on success, on failure, specific templates
- Email templates with variable interpolation ({{run.id}}, {{run.status}}, etc.)
- Webhook delivery with retry logic and exponential backoff
- Enable/disable toggle for each notification
- Mock email sender (console logging for MVP)
- Real webhook delivery with custom headers and body

### Provider System
- **Provider Architecture**: Factory pattern with extensible registry for multiple provider types
- **Proxmox Integration**: Full VM inventory collection with dual authentication (password/API token)
- **Provider Accounts**: CRUD operations with enable/disable, scheduled sync configuration
- **Sync Worker**: Orchestrates VM collection, normalization, and NetBox upsert operations
- **External Objects**: Tracks provider-to-NetBox mappings with unique constraint on (providerAccountId, externalId)
- **Sync Runs**: Complete execution history with logs, status tracking, and error handling
- **Group Cache**: Performance-optimized autocomplete cache rebuilt from NetBox inventory
- **Housekeeping Operations**:
  - Rebuild Cache: Refresh autocomplete suggestions from NetBox groups
  - Ensure Schema: Create/update custom fields in NetBox (bridge_provider_id, bridge_external_id)
  - Prune Stale: Remove objects from disabled/deleted providers
  - Retry Failed: Re-queue failed sync runs for automatic retry
- **Provider UI**: Test connection, manual sync trigger, status monitoring, enable/disable toggle
- **NetBox Write Operations**: Mock upsert for VMs, IPs, and custom field updates

### Settings
- NetBox URL and token configuration
- Connection test capability
- Environment variable display
- Provider housekeeping dashboard with maintenance operations

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/login` - Authenticate and get JWT token
- `GET /api/auth/me` - Get current user info

### Inventory (NetBox)
- `GET /api/inventory/groups` - List inventory groups
- `GET /api/inventory/hosts?group=<name>` - List hosts in group
- `POST /api/inventory/preflight` - Validate limit expression

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `POST /api/projects/:id/sync` - Sync repository and discover playbooks

### Credentials
- `GET /api/credentials` - List all credentials
- `POST /api/credentials` - Create new credential

### Templates
- `GET /api/templates` - List all job templates
- `POST /api/templates` - Create new template
- `POST /api/templates/:id/launch` - Launch immediate run
- `POST /api/templates/:id/schedule` - Schedule future run

### Runs
- `GET /api/runs` - List all job runs with filters (status, archived, date range)
- `GET /api/runs/:id` - Get run details
- `POST /api/runs/:id/archive` - Archive a run
- `POST /api/runs/:id/unarchive` - Unarchive a run
- `GET /api/runs/:id/csv` - Download run results as CSV
- `WS /ws/runs/:id` - WebSocket stream for live logs

### Reports
- `GET /api/reports/inventory-health` - Inventory coverage metrics

### Settings
- `GET /api/settings` - Get configuration
- `POST /api/settings` - Update configuration
- `POST /api/settings/test-connection` - Test NetBox connectivity

### Notifications
- `GET /api/notifications` - List all notification configurations
- `POST /api/notifications` - Create new notification
- `PATCH /api/notifications/:id` - Update notification
- `DELETE /api/notifications/:id` - Delete notification

### Providers
- `GET /api/providers` - List all provider accounts
- `POST /api/providers` - Create new provider account
- `PATCH /api/providers/:id` - Update provider account
- `POST /api/providers/:id/test` - Test provider connection
- `POST /api/providers/:id/sync` - Trigger manual sync
- `GET /api/stats/providers` - Get provider statistics and last sync status

### NetBox VM Import
- `POST /api/netbox/import` - Import VMs from NetBox (admin only, full replacement sync)
- `GET /api/netbox/vms` - List all imported NetBox VMs

### Housekeeping
- `POST /api/housekeeping/rebuild-cache` - Rebuild group cache from NetBox
- `POST /api/housekeeping/ensure-schema` - Ensure NetBox custom fields exist
- `POST /api/housekeeping/prune-stale` - Remove objects from disabled providers
- `POST /api/housekeeping/retry-failed` - Re-queue failed sync runs

## Environment Variables

Required secrets (configure in Replit Secrets):
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `NETBOX_URL` - NetBox instance base URL (e.g., https://netbox.example.com)
- `NETBOX_TOKEN` - Read-only NetBox API token
- `JWT_SECRET` - Secret key for JWT signing (generate with `openssl rand -base64 48`)

## Development

### Running the App
```bash
npm run dev  # Starts Express backend + Vite frontend
```

### Database Migrations
```bash
npm run db:push  # Push schema changes to PostgreSQL
```

### File Structure
```
client/
  src/
    components/       # Reusable UI components
    pages/           # Route-based page components
    lib/             # Utilities (queryClient, theme)
server/
  services/        # Business logic (NetBox, FakeRunner)
  db.ts           # Database connection
  storage.ts      # Data access layer
  routes.ts       # API endpoints + WebSocket
shared/
  schema.ts       # Database schema + TypeScript types
```

## Design System

### Colors (Dark-first)
- Primary: Blue (#3B82F6) for actions
- Success: Green for completed/ok status
- Warning: Amber for pending/warnings
- Danger: Red for failed/errors
- Background: Dark slate (220 15% 8%)
- Card: Elevated dark (220 15% 12%)

### Typography
- UI: Inter font family
- Code/Logs: JetBrains Mono (monospace)
- Hierarchy: Display (24px) → Heading (18px) → Body (14px) → Label (12px)

### Components
- Sidebar navigation with active state highlighting
- Cards with subtle borders and elevated backgrounds
- Tables with sticky headers and row hover states
- Log console with dark monospace background
- Status badges with semantic colors
- Real-time WebSocket connection indicator
- Skeleton loading states

## MVP Constraints (Replit)
- No real Ansible/SSH execution (simulated via FakeRunner)
- No real Git operations (mocked sync)
- No real secret storage (placeholder references only)
- No provider collectors (NetBox integration only)
- Simplified job scheduling (no persistent queue like GoodJob)

## Next Steps (Post-MVP)
- Implement real Git sync using simple-git library
- Advanced scheduling with persistent job queue (e.g., BullMQ, GoodJob)
- Real email delivery via SMTP (nodemailer integration)
- Multi-tenancy support with organization scoping
- Audit logging for all CRUD operations
- Role-based permission enforcement on API routes
- Advanced notification features (Slack, PagerDuty integrations)
- Template versioning and rollback capability

## Recent Changes
- 2025-01-16: Initial MVP implementation completed
  - Full authentication system with JWT
  - NetBox integration with preflight validation
  - Complete CRUD for projects, credentials, templates
  - FakeRunner with real-time WebSocket log streaming
  - Reports dashboard with inventory health metrics
  - Dark-first UI with professional design system
  
- 2025-01-16: Advanced features implementation
  - Limit expression autocomplete with real-time host suggestions
  - JSON Schema validation for extra_vars with inline error display
  - Run comparison view with side-by-side diff analysis
  - Run archival system with advanced filtering (status, date range, archived state)
  - Configurable notifications (email/webhook) with retry logic
  - Variable interpolation in notification templates
  - Automatic notification triggering on run completion/failure

- 2025-10-16: Provider system implementation
  - Complete provider architecture with factory pattern and registry
  - Proxmox provider collector with password/API token authentication
  - Provider sync worker orchestrating VM collection and NetBox upsert
  - Housekeeping operations: cache rebuild, schema ensure, prune stale, retry failed
  - Provider accounts CRUD with enable/disable and scheduled sync support
  - Sync runs tracking with status (queued, running, ok, failed) and logs
  - External objects mapping with provider-to-NetBox relationship tracking
  - Group cache optimization for autocomplete performance
  - Provider UI with test connection, manual sync, and status monitoring
  - Housekeeping dashboard in Settings for maintenance operations

- 2025-10-16: NetBox VM import feature
  - Direct VM import from NetBox virtualization API
  - New netbox_vms database table with complete VM metadata storage
  - VM attributes captured: Name, IP address, Operating System, Custom Fields, Tags
  - Operating system normalization (Linux/Windows/Other/Unknown)
  - Full replacement sync model with persistence
  - NetBox Inventory page with table view and import button
  - Admin-only import capability
  - E2E tested: Successfully imports 50 VMs from NetBox demo instance

- 2025-10-16: Multi-source NetBox inventory system
  - Implemented netboxInventorySources table for multiple NetBox instances
  - Each source has independent URL, token, and enabled status
  - Complete CRUD operations for NetBox sources (add/edit/delete)
  - Renamed "NetBox Inventory" to "NetBox Inventories" (plural)
  - Moved NetBox configuration from Settings to NetBox Inventories page
  - Settings page now focuses on housekeeping operations only
  - VM table with composite unique constraint (sourceId, netboxId) for multi-source support
  - Selectable VMs with checkboxes (individual and select-all)
  - Clear selection functionality with visual feedback
  - VM import targets specific NetBox source via sourceId parameter
  - Projects and Credentials pages enhanced with edit/delete capabilities
  - E2E tested: Source management and VM selection functionality verified
