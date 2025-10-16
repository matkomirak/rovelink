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
- **jobRuns**: Execution history with logs and results
- **settings**: Key-value configuration storage

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

### Settings
- NetBox URL and token configuration
- Connection test capability
- Environment variable display

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
- `GET /api/runs` - List all job runs
- `GET /api/runs/:id` - Get run details
- `GET /api/runs/:id/csv` - Download run results as CSV
- `WS /ws/runs/:id` - WebSocket stream for live logs

### Reports
- `GET /api/reports/inventory-health` - Inventory coverage metrics

### Settings
- `GET /api/settings` - Get configuration
- `POST /api/settings` - Update configuration
- `POST /api/settings/test-connection` - Test NetBox connectivity

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
- Add limit expression autocomplete
- JSON Schema validation for extra_vars
- Run comparison view
- Configurable notifications (email/webhook)
- Advanced scheduling with persistent job queue
- Multi-tenancy support
- Audit logging

## Recent Changes
- 2025-01-16: Initial MVP implementation completed
  - Full authentication system with JWT
  - NetBox integration with preflight validation
  - Complete CRUD for projects, credentials, templates
  - FakeRunner with real-time WebSocket log streaming
  - Reports dashboard with inventory health metrics
  - Dark-first UI with professional design system
