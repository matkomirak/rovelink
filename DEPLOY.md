# Bridge - Ubuntu 22.04 Deployment Guide

This guide will help you deploy the Bridge infrastructure automation platform on a fresh Ubuntu 22.04 VM.

## Prerequisites

- Ubuntu 22.04 LTS (fresh installation)
- Root or sudo access
- Internet connection

## Quick Start (Production Deployment)

### 1. Install System Dependencies

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install required packages
sudo apt-get install -y curl ca-certificates git postgresql postgresql-contrib

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installations
node --version  # Should be v20.x
npm --version
psql --version
```

### 2. Set Up PostgreSQL Database

```bash
# Switch to postgres user and create database
sudo -u postgres psql <<'SQL'
CREATE ROLE bridge WITH LOGIN PASSWORD 'bridgepass';
CREATE DATABASE bridge_db OWNER bridge;
GRANT ALL PRIVILEGES ON DATABASE bridge_db TO bridge;
SQL

# Test connection
PGPASSWORD=bridgepass psql -U bridge -d bridge_db -h localhost -c '\dt'
```

### 3. Clone and Configure the Application

```bash
# Clone repository (replace with your repo URL)
git clone https://github.com/your-username/bridge-app.git /opt/bridge
cd /opt/bridge

# Create environment file from example
cp .env.example .env

# Edit .env file with your settings
nano .env
```

**Important:** Update these values in `.env`:
- `DATABASE_URL` - Your PostgreSQL connection string
- `JWT_SECRET` - A strong random string (use `openssl rand -hex 32`)
- `SESSION_SECRET` - Another strong random string (use `openssl rand -hex 32`)
- `PORT` - Default is 5000

### 4. Install Dependencies and Build

```bash
# Install npm dependencies
npm ci

# Push database schema
npm run db:push

# Create admin user
npm run db:seed

# Build the application
npm run build
```

Expected build output:
- `dist/public/` - Client static files
- `dist/index.js` - Server bundle

### 5. Start the Application

```bash
# Start in production mode
npm start
```

You should see:
```
serving on port 5000
```

### 6. Access the Application

Open your browser and navigate to:
```
http://your-vm-ip:5000
```

**Default Login Credentials:**
- Username: `admin`
- Password: `admin`

**⚠️ Security:** Change the admin password immediately after first login!

## Firewall Configuration

If you're using UFW (Ubuntu Firewall):

```bash
# Allow SSH (if not already allowed)
sudo ufw allow 22/tcp

# Allow Bridge app port
sudo ufw allow 5000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

## Running as a Service (systemd)

For production, run Bridge as a systemd service:

```bash
# Create service file
sudo nano /etc/systemd/system/bridge.service
```

Add this content:

```ini
[Unit]
Description=Bridge Infrastructure Automation Platform
After=network.target postgresql.service

[Service]
Type=simple
User=bridge
WorkingDirectory=/opt/bridge
Environment="NODE_ENV=production"
EnvironmentFile=/opt/bridge/.env
ExecStart=/usr/bin/node /opt/bridge/dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Create a dedicated user for the service:

```bash
# Create bridge user
sudo useradd -r -s /bin/false bridge

# Set ownership
sudo chown -R bridge:bridge /opt/bridge

# Start and enable service
sudo systemctl daemon-reload
sudo systemctl enable bridge
sudo systemctl start bridge

# Check status
sudo systemctl status bridge

# View logs
sudo journalctl -u bridge -f
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `PORT` | No | 5000 | Server port |
| `JWT_SECRET` | Yes | - | JWT signing secret |
| `SESSION_SECRET` | Yes | - | Session encryption secret |
| `AUTH_DISABLE` | No | false | Disable authentication (testing only) |
| `NETBOX_URL` | No | - | Default NetBox URL (can set via UI) |
| `NETBOX_TOKEN` | No | - | Default NetBox token (can set via UI) |

## Troubleshooting

### Application Won't Start

Check the build directory exists:
```bash
ls -la /opt/bridge/dist/
```

You should see:
- `dist/index.js` - Server bundle
- `dist/public/` - Static files directory

If missing, run:
```bash
npm run build
```

### Database Connection Errors

Test database connectivity:
```bash
PGPASSWORD=bridgepass psql -U bridge -d bridge_db -h localhost -c 'SELECT version();'
```

Verify `DATABASE_URL` in `.env` matches your database settings.

### Can't Login

Reset admin password:
```bash
# Run seed script again (it will skip if user exists)
npm run db:seed
```

Or manually via SQL:
```bash
sudo -u postgres psql bridge_db <<'SQL'
UPDATE users SET password = '$2a$10$YourHashedPasswordHere' WHERE username = 'admin';
SQL
```

### Port Already in Use

Check what's using port 5000:
```bash
sudo lsof -i :5000
```

Change the port in `.env`:
```
PORT=8080
```

## Updating the Application

```bash
cd /opt/bridge

# Pull latest changes
git pull

# Install any new dependencies
npm ci

# Rebuild
npm run build

# Restart service
sudo systemctl restart bridge
```

## Backup and Restore

### Backup Database

```bash
pg_dump -U bridge -h localhost bridge_db > bridge_backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
psql -U bridge -h localhost bridge_db < bridge_backup_20250123.sql
```

## Security Checklist

- [ ] Change default admin password
- [ ] Set strong `JWT_SECRET` and `SESSION_SECRET`
- [ ] Configure firewall (UFW or iptables)
- [ ] Keep system and Node.js updated
- [ ] Use HTTPS (nginx reverse proxy recommended)
- [ ] Limit database access to localhost only
- [ ] Regular database backups
- [ ] Review user permissions

## Next Steps

Once deployed:
1. **Change admin password** via Settings → Users
2. **Configure CMDBs** - Add NetBox or i-doit connections
3. **Set up Providers** - Configure fake provider or other sources
4. **Create Pipelines** - Build data sync workflows
5. **Set up Automation Inventories** - Link to your CMDBs

## Support

For issues or questions:
- Check application logs: `sudo journalctl -u bridge -f`
- Review system logs: `/var/log/syslog`
- Check browser console for frontend errors

## License

MIT License - See LICENSE file for details
