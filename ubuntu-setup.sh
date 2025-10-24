#!/bin/bash
set -e

echo "🚀 Bridge Infrastructure Automation - Ubuntu 22.04 Setup"
echo "========================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
  echo -e "${RED}❌ Please don't run this script as root${NC}"
  echo "Run as a regular user with sudo privileges"
  exit 1
fi

# Function to print status
print_status() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

# Check for required commands
if ! command -v curl &> /dev/null; then
  print_error "curl is not installed. Installing prerequisites..."
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates git
fi

# Step 1: Install Node.js 20
echo ""
echo "📦 Step 1: Installing Node.js 20..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v)
  print_warning "Node.js is already installed: $NODE_VERSION"
  read -p "Reinstall Node.js 20? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
print_status "Node.js installed: $(node -v)"
print_status "npm installed: $(npm -v)"

# Step 2: Install PostgreSQL
echo ""
echo "🗄️  Step 2: Installing PostgreSQL..."
if command -v psql &> /dev/null; then
  print_warning "PostgreSQL is already installed"
else
  sudo apt-get install -y postgresql postgresql-contrib
  sudo systemctl start postgresql
  sudo systemctl enable postgresql
fi
print_status "PostgreSQL installed: $(psql --version)"

# Step 3: Create Database
echo ""
echo "🔧 Step 3: Setting up database..."
DB_PASSWORD=${BRIDGE_DB_PASSWORD:-bridgepass}

sudo -u postgres psql <<SQL 2>/dev/null || {
  print_warning "Database might already exist"
}
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bridge') THEN
    CREATE ROLE bridge WITH LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bridge_db') THEN
    CREATE DATABASE bridge_db OWNER bridge;
  END IF;
END
\$\$;

GRANT ALL PRIVILEGES ON DATABASE bridge_db TO bridge;
SQL

print_status "Database 'bridge_db' ready"

# Step 4: Test database connection
echo ""
echo "🔍 Step 4: Testing database connection..."
if PGPASSWORD=$DB_PASSWORD psql -U bridge -d bridge_db -h localhost -c '\dt' &>/dev/null; then
  print_status "Database connection successful"
else
  print_error "Database connection failed"
  exit 1
fi

# Step 5: Application setup
echo ""
echo "📁 Step 5: Setting up Bridge application..."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file..."
  cat > .env <<ENV
DATABASE_URL=postgresql://bridge:$DB_PASSWORD@localhost:5432/bridge_db
PORT=5000
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
AUTH_DISABLE=false
ENV
  print_status ".env file created"
else
  print_warning ".env file already exists, skipping creation"
fi

# Install dependencies
echo ""
echo "📦 Step 6: Installing dependencies..."
npm ci
print_status "Dependencies installed"

# Push database schema
echo ""
echo "🗃️  Step 7: Pushing database schema..."
npm run db:push
print_status "Database schema created"

# Create admin user
echo ""
echo "👤 Step 8: Creating admin user..."
npm run db:seed
print_status "Admin user created"

# Build application
echo ""
echo "🔨 Step 9: Building application..."
npm run build

if [ -f "dist/index.js" ] && [ -d "dist/public" ]; then
  print_status "Build successful"
  print_status "  - Server bundle: dist/index.js"
  print_status "  - Client assets: dist/public/"
else
  print_error "Build failed - missing output files"
  exit 1
fi

# Final instructions
echo ""
echo "========================================================="
echo -e "${GREEN}✅ Bridge installation complete!${NC}"
echo "========================================================="
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Start the application:"
echo "   npm start"
echo ""
echo "2. Access the UI:"
echo "   http://$(hostname -I | awk '{print $1}'):5000"
echo ""
echo "3. Login credentials:"
echo "   Username: admin"
echo "   Password: admin"
echo ""
echo "4. (Optional) Set up as systemd service:"
echo "   See DEPLOY.md for instructions"
echo ""
echo "⚠️  Security reminders:"
echo "   - Change admin password after first login"
echo "   - Configure firewall (sudo ufw allow 5000/tcp)"
echo "   - Review .env file settings"
echo ""
echo "📚 For more information, see DEPLOY.md"
echo ""
