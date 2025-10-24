# Bridge - Ubuntu Quick Start Guide

## 🚀 Automated Installation (Recommended)

For the fastest setup on Ubuntu 22.04, use our automated setup script:

```bash
cd /opt/bridge  # or wherever you cloned the repo
./ubuntu-setup.sh
```

This script will:
- ✅ Install Node.js 20
- ✅ Install and configure PostgreSQL
- ✅ Create the `bridge_db` database
- ✅ Generate secure secrets
- ✅ Install dependencies
- ✅ Push database schema
- ✅ Create admin user (admin/admin)
- ✅ Build the application

**After the script completes:**

```bash
# Start the application
npm start

# Access at http://your-vm-ip:5000
# Login: admin / admin
```

## 📋 Manual Installation

If you prefer manual setup, see [DEPLOY.md](DEPLOY.md) for detailed step-by-step instructions.

## 🔧 Available Commands

```bash
# Development
npm run dev              # Start development server with hot reload

# Production
npm run build:client     # Build frontend assets
npm run build:server     # Build backend bundle
npm run build            # Build everything
npm start                # Start production server

# Database
npm run db:push          # Push schema changes to database
npm run db:seed          # Create admin user (admin/admin)

# Utilities
npm run check            # TypeScript type checking
```

## 🗂️ Project Structure

```
bridge/
├── client/              # React frontend
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Page components
│       └── lib/         # Client utilities
├── server/              # Express backend
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   └── db/              # Database connection
├── shared/              # Shared types & schemas
├── dist/                # Production build output
│   ├── index.js         # Server bundle
│   └── public/          # Client static files
├── .env                 # Environment variables
├── .env.example         # Environment template
└── ubuntu-setup.sh      # Automated setup script
```

## 🔐 Default Credentials

After running `npm run db:seed`, you can login with:

- **Username:** admin
- **Password:** admin

**⚠️ IMPORTANT:** Change this password immediately after first login!

## 🌐 Production Deployment

For production use, we recommend:

1. **Run as a systemd service** (see DEPLOY.md)
2. **Use a reverse proxy** (nginx) with SSL/TLS
3. **Configure firewall** (UFW or iptables)
4. **Set up automated backups**
5. **Monitor logs** with journald or similar

See [DEPLOY.md](DEPLOY.md) for complete production deployment guide.

## 🐛 Troubleshooting

### Can't login with admin/admin

Run the seed script:
```bash
npm run db:seed
```

### Build fails

Make sure you've installed dependencies:
```bash
npm ci
```

### Database connection error

Check your `.env` file and verify PostgreSQL is running:
```bash
sudo systemctl status postgresql
```

### Port 5000 already in use

Change the port in `.env`:
```
PORT=8080
```

## 📚 Features

Once logged in, you can:

- **CMDBs** - Connect to NetBox, i-doit, or ServiceNow
- **Providers** - Configure fake providers or real infrastructure sources
- **Pipelines** - Create data sync workflows between providers and CMDBs
- **Automation Inventories** - Manage unified inventory from multiple sources
- **Job Templates** - Define and schedule automation tasks
- **Reports** - View infrastructure health and sync statistics

## 🔗 Related Documentation

- [DEPLOY.md](DEPLOY.md) - Comprehensive deployment guide
- [replit.md](replit.md) - Technical architecture and system design
- [design_guidelines.md](design_guidelines.md) - UI/UX design principles

## 🆘 Getting Help

If you encounter issues:

1. Check application logs: `sudo journalctl -u bridge -f`
2. Review browser console for frontend errors
3. Verify database connectivity: `psql -U bridge -d bridge_db`
4. Check environment variables in `.env`

## 📄 License

MIT License - See LICENSE file for details
