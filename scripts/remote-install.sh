#!/bin/bash

# Agent Studio Remote Installation Script
# This script downloads and installs Agent Studio backend with all dependencies
# Usage: curl -fsSL https://raw.githubusercontent.com/git-men/agentstudio/main/scripts/remote-install.sh | bash

set -e

# Configuration
GITHUB_REPO="git-men/agentstudio"
GITHUB_BRANCH="main"
TEMP_DIR="/tmp/agent-studio-remote-$(date +%s)"
SERVICE_NAME="agent-studio"
SERVICE_PORT="4936"

# Detect if running as root or with sudo
if [ -n "$SUDO_USER" ] && [ "$EUID" -eq 0 ]; then
    # Running with sudo - use the original user's home
    ACTUAL_USER="$SUDO_USER"
    USER_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    ACTUAL_UID=$(id -u "$SUDO_USER")
    ACTUAL_GID=$(id -g "$SUDO_USER")
elif [ "$EUID" -eq 0 ]; then
    # Running as root directly - ask for target user
    ACTUAL_USER="root"
    USER_HOME="/root"
    ACTUAL_UID=0
    ACTUAL_GID=0
else
    # Running as normal user
    ACTUAL_USER="$USER"
    USER_HOME="$HOME"
    ACTUAL_UID=$(id -u)
    ACTUAL_GID=$(id -g)
fi

INSTALL_DIR="$USER_HOME/.agent-studio"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Check installation environment
check_environment() {
    log "Installing Agent Studio to user directory: $INSTALL_DIR"
    log "Target user: $ACTUAL_USER (UID: $ACTUAL_UID)"

    # Check if previous installation exists and is writable
    if [ -d "$INSTALL_DIR" ]; then
        log "Found existing installation directory..."
        log "Cleaning existing installation..."
        rm -rf "$INSTALL_DIR"
        success "Cleanup completed"
    fi

    # Ensure parent directory exists and has correct permissions
    mkdir -p "$USER_HOME"
    if [ "$ACTUAL_USER" != "root" ] && [ "$EUID" -eq 0 ]; then
        chown -R "$ACTUAL_UID:$ACTUAL_GID" "$USER_HOME"
    fi
}

# Detect operating system
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        if command -v apt-get >/dev/null 2>&1; then
            DISTRO="debian"
        elif command -v yum >/dev/null 2>&1; then
            DISTRO="redhat"
        elif command -v pacman >/dev/null 2>&1; then
            DISTRO="arch"
        else
            DISTRO="unknown"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        DISTRO="macos"
    else
        error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    log "Detected OS: $OS ($DISTRO)"
}

# Refresh shell environment to pick up newly installed tools
refresh_shell_env() {
    log "Refreshing shell environment..."
    
    # Source common profile files
    [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true
    [ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null || true
    [ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null || true
    [ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null || true
    
    # Source NVM if available
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 2>/dev/null || true
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion" 2>/dev/null || true
    
    # Update PATH to include common Node.js installation paths
    export PATH="$HOME/.nvm/versions/node/$(nvm current 2>/dev/null || echo 'system')/bin:$PATH" 2>/dev/null || true
    export PATH="/usr/local/bin:$PATH"
    export PATH="$HOME/.local/bin:$PATH"
}

# Check GLIBC version and determine compatible Node.js version
check_glibc_version() {
    if [[ "$OS" != "linux" ]]; then
        # Non-Linux systems don't have GLIBC version constraints
        echo "lts/*"
        return
    fi

    # Check GLIBC version - using more portable regex
    local GLIBC_VERSION=$(ldd --version 2>/dev/null | head -n1 | sed -n 's/.*[^0-9]\([0-9][0-9]*\.[0-9][0-9]*\)$/\1/p')
    if [ -z "$GLIBC_VERSION" ]; then
        GLIBC_VERSION="0.0"
    fi
    local GLIBC_MAJOR=$(echo "$GLIBC_VERSION" | cut -d. -f1)
    local GLIBC_MINOR=$(echo "$GLIBC_VERSION" | cut -d. -f2)

    # Output logs to stderr to avoid mixing with return value
    log "Detected GLIBC version: $GLIBC_VERSION" >&2

    # Node.js version requirements:
    # v22+: GLIBC 2.28+
    # v20+: GLIBC 2.28+
    # v18: GLIBC 2.27+
    # v16: GLIBC 2.17+

    if [ "$GLIBC_MAJOR" -gt 2 ] || ([ "$GLIBC_MAJOR" -eq 2 ] && [ "$GLIBC_MINOR" -ge 28 ]); then
        # GLIBC 2.28+: Use latest LTS (Node.js 22)
        log "GLIBC version is sufficient for latest Node.js LTS" >&2
        echo "lts/*"
    elif [ "$GLIBC_MAJOR" -eq 2 ] && [ "$GLIBC_MINOR" -ge 27 ]; then
        # GLIBC 2.27: Use Node.js 18
        warn "GLIBC version requires Node.js 18 (older LTS)" >&2
        echo "18"
    elif [ "$GLIBC_MAJOR" -eq 2 ] && [ "$GLIBC_MINOR" -ge 17 ]; then
        # GLIBC 2.17-2.26: Use Node.js 16
        warn "GLIBC version requires Node.js 16 (older LTS)" >&2
        echo "16"
    else
        # Very old GLIBC: warn user
        error "GLIBC version $GLIBC_VERSION is too old for modern Node.js" >&2
        error "Please upgrade your system or use a newer distribution" >&2
        return 1
    fi
}

# Install Node.js via NVM
install_nodejs_via_nvm() {
    log "Installing Node.js via NVM..."

    # Check if curl is available
    if ! command -v curl >/dev/null 2>&1; then
        error "curl is required but not found. Please install curl first."
        return 1
    fi

    # Download and install NVM
    log "Downloading NVM..."
    if ! curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash; then
        error "Failed to download or install NVM"
        return 1
    fi

    # Source NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

    # Check if NVM was installed successfully
    if ! command -v nvm >/dev/null 2>&1; then
        error "NVM installation failed"
        return 1
    fi

    # Determine compatible Node.js version based on GLIBC
    local NODE_VERSION=$(check_glibc_version)
    if [ -z "$NODE_VERSION" ]; then
        return 1
    fi

    # Install determined Node.js version
    log "Installing Node.js $NODE_VERSION..."
    log "Installing latest LTS version."
    if ! nvm install "$NODE_VERSION"; then
        error "Failed to install Node.js via NVM"
        return 1
    fi

    nvm use "$NODE_VERSION"
    nvm alias default "$NODE_VERSION"

    success "Node.js installed successfully via NVM"
}

# Install Node.js on Linux
install_nodejs_linux() {
    log "Installing Node.js on Linux..."

    # Determine if we need sudo
    local SUDO_CMD=""
    if [ "$EUID" -ne 0 ]; then
        SUDO_CMD="sudo"
    fi

    # Check GLIBC and determine compatible Node.js version
    local NODE_VERSION=$(check_glibc_version)
    if [ -z "$NODE_VERSION" ]; then
        error "Cannot determine compatible Node.js version"
        return 1
    fi

    # If not latest LTS, warn user and fall back to NVM for better version control
    if [ "$NODE_VERSION" != "lts/*" ]; then
        warn "System requires Node.js $NODE_VERSION due to GLIBC constraints"
        warn "Using NVM for precise version control..."
        install_nodejs_via_nvm
        return $?
    fi

    case "$DISTRO" in
        "debian")
            log "Using apt package manager..."
            # Add NodeSource repository
            if ! curl -fsSL https://deb.nodesource.com/setup_lts.x | $SUDO_CMD -E bash -; then
                error "Failed to add NodeSource repository"
                return 1
            fi
            if ! $SUDO_CMD apt-get install -y nodejs; then
                error "Failed to install Node.js via apt"
                return 1
            fi
            ;;
        "redhat")
            log "Using yum/dnf package manager..."
            # Add NodeSource repository
            if ! curl -fsSL https://rpm.nodesource.com/setup_lts.x | $SUDO_CMD bash -; then
                error "Failed to add NodeSource repository"
                return 1
            fi
            if command -v dnf >/dev/null 2>&1; then
                if ! $SUDO_CMD dnf install -y nodejs npm; then
                    error "Failed to install Node.js via dnf"
                    return 1
                fi
            else
                if ! $SUDO_CMD yum install -y nodejs npm; then
                    error "Failed to install Node.js via yum"
                    return 1
                fi
            fi
            ;;
        "arch")
            log "Using pacman package manager..."
            if ! $SUDO_CMD pacman -S --noconfirm nodejs npm; then
                error "Failed to install Node.js via pacman"
                return 1
            fi
            ;;
        *)
            log "Unknown Linux distribution, trying NVM..."
            install_nodejs_via_nvm
            ;;
    esac
}

# Install Node.js on macOS
install_nodejs_macos() {
    log "Installing Node.js on macOS..."
    
    if command -v brew >/dev/null 2>&1; then
        log "Using Homebrew..."
        brew install node
    else
        log "Homebrew not found, trying NVM..."
        install_nodejs_via_nvm
    fi
}

# Auto-install Node.js based on OS
auto_install_nodejs() {
    echo ""
    echo "Node.js is required but not found on your system."

    # Check if we're running in a non-interactive environment (piped input)
    if [ ! -t 0 ]; then
        # Non-interactive mode - automatically install Node.js
        log "Non-interactive mode detected - proceeding with automatic Node.js installation"
    else
        # Interactive mode - ask for confirmation
        read -p "Would you like to install Node.js automatically? (Y/n): " -n 1 -r
        echo ""

        if [[ $REPLY =~ ^[Nn]$ ]]; then
            error "Node.js is required to continue. Please install Node.js 18 or later first."
            error "Visit: https://nodejs.org/"
            exit 1
        fi
    fi

    case "$OS" in
        "linux")
            # Try package manager first, fallback to NVM
            # Check if we can use system package manager (either as root or with sudo)
            if [ "$DISTRO" != "unknown" ] && ([ "$EUID" -eq 0 ] || command -v sudo >/dev/null 2>&1); then
                if ! install_nodejs_linux; then
                    warn "System package manager installation failed, trying NVM..."
                    install_nodejs_via_nvm
                fi
            else
                log "Cannot use system package manager, using NVM..."
                install_nodejs_via_nvm
            fi
            ;;
        "macos")
            if ! install_nodejs_macos; then
                warn "Homebrew installation failed, trying NVM..."
                install_nodejs_via_nvm
            fi
            ;;
        *)
            install_nodejs_via_nvm
            ;;
    esac

    # Refresh environment and verify installation
    refresh_shell_env

    if command -v node >/dev/null 2>&1; then
        success "Node.js $(node --version) installed successfully"
    else
        error "Node.js installation failed. Please install manually."
        error "Visit: https://nodejs.org/"
        exit 1
    fi
}

# Check Node.js installation
check_nodejs() {
    log "Checking Node.js installation..."
    
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            success "Node.js $(node --version) is available"
            return
        else
            warn "Node.js version is too old: $(node --version). Need version 18 or later."
            auto_install_nodejs
        fi
    else
        log "Node.js is not installed."
        auto_install_nodejs
    fi
}

# Install pnpm
install_pnpm() {
    log "Installing pnpm..."
    
    if command -v npm >/dev/null 2>&1; then
        npm install -g pnpm
        success "pnpm installed successfully"
    else
        error "npm is not available, cannot install pnpm"
        return 1
    fi
}

# Check pnpm installation
check_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        success "pnpm is available"
        return
    fi

    echo ""

    # Check if we're running in a non-interactive environment (piped input)
    if [ ! -t 0 ]; then
        # Non-interactive mode - automatically install pnpm
        log "Non-interactive mode detected - installing pnpm automatically"
        install_pnpm
        refresh_shell_env
        if ! command -v pnpm >/dev/null 2>&1; then
            warn "pnpm installation failed, will use npm instead"
        fi
    else
        # Interactive mode - ask for confirmation
        read -p "pnpm not found. Would you like to install it for faster package management? (Y/n): " -n 1 -r
        echo ""

        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            install_pnpm
            refresh_shell_env
            if ! command -v pnpm >/dev/null 2>&1; then
                warn "pnpm installation failed, will use npm instead"
            fi
        else
            log "Will use npm instead of pnpm"
        fi
    fi
}

# Check git installation
check_git() {
    if command -v git >/dev/null 2>&1; then
        success "Git is available"
        return
    fi
    
    error "Git is not installed. Please install git first."
    exit 1
}

# Download and extract Agent Studio
download_agent_studio() {
    log "Downloading Agent Studio..."
    
    # Clean up any existing temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    
    # Download the repository
    if command -v git >/dev/null 2>&1; then
        git clone "https://github.com/$GITHUB_REPO.git" .
        git checkout "$GITHUB_BRANCH"
    else
        # Fallback to downloading tarball
        curl -fsSL "https://github.com/$GITHUB_REPO/archive/$GITHUB_BRANCH.tar.gz" | tar -xz --strip-components=1
    fi
    
    success "Agent Studio downloaded successfully"
}

# Run the main installation
run_installation() {
    log "Installing Agent Studio to user directory..."
    
    # Create directories
    log "Creating directories..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$USER_HOME/.agent-studio-logs"
    mkdir -p "$USER_HOME/.agent-studio-config"
    mkdir -p "$USER_HOME/slides"
    
    # Copy files
    log "Copying application files..."
    cd "$TEMP_DIR"
    cp -r ./* "$INSTALL_DIR/"

    # Set correct ownership if running as root
    if [ "$ACTUAL_USER" != "root" ] && [ "$EUID" -eq 0 ]; then
        chown -R "$ACTUAL_UID:$ACTUAL_GID" "$INSTALL_DIR"
    fi
    
    cd "$INSTALL_DIR"
    
    # Install dependencies and try to build
    log "Installing dependencies..."
    BUILD_SUCCESS=false
    
    # Set CI environment variable to handle TTY issues
    export CI=true
    
    if command -v pnpm >/dev/null 2>&1; then
        log "Using pnpm for installation..."
        
        # Install all dependencies (including dev dependencies)
        pnpm install
        
        # Try to build backend - if it fails, continue with development mode
        log "Attempting to build backend..."
        if pnpm run build:backend 2>/dev/null; then
            BUILD_SUCCESS=true
            success "Build successful - will run in production mode"
        else
            log "Build failed or skipped - will run in development mode"
            BUILD_SUCCESS=false
        fi
    else
        log "Using npm for installation..."
        
        # Install all dependencies (including dev dependencies)
        npm install
        
        # Try to build backend - if it fails, continue with development mode
        log "Attempting to build backend..."
        if npm run build:backend 2>/dev/null; then
            BUILD_SUCCESS=true
            success "Build successful - will run in production mode"
        else
            log "Build failed or skipped - will run in development mode"
            BUILD_SUCCESS=false
        fi
    fi
    
    # Create start script in installation directory
    log "Creating start script..."
    if [ "$BUILD_SUCCESS" = true ]; then
        # Production mode
        cat > "$INSTALL_DIR/start.sh" << 'EOF'
#!/bin/bash
echo "🚀 Starting Agent Studio Backend (Production Mode)..."
cd "$HOME/.agent-studio"
export NODE_ENV=production
export PORT=4936
export SLIDES_DIR="$HOME/slides"
echo "📂 Working directory: $(pwd)"
echo "🌐 Backend port: 4936"
echo "📑 Slides directory: $HOME/slides"
echo ""
echo "✨ Access the application at:"
echo "   https://agentstudio-frontend.vercel.app/"
echo ""
echo "💡 Configure the backend URL in the web interface:"
echo "   Settings → API Configuration → http://localhost:4936"
echo ""
node backend/dist/index.js
EOF
    else
        # Development mode
        cat > "$INSTALL_DIR/start.sh" << 'EOF'
#!/bin/bash
echo "🚀 Starting Agent Studio Backend (Development Mode)..."
cd "$HOME/.agent-studio"
export NODE_ENV=development
export PORT=4936
export SLIDES_DIR="$HOME/slides"
echo "📂 Working directory: $(pwd)"
echo "🌐 Backend port: 4936"
echo "📑 Slides directory: $HOME/slides"
echo ""
echo "✨ Access the application at:"
echo "   https://agentstudio-frontend.vercel.app/"
echo ""
echo "💡 Configure the backend URL in the web interface:"
echo "   Settings → API Configuration → http://localhost:4936"
echo ""
if command -v pnpm >/dev/null 2>&1; then
    pnpm run dev:backend
else
    npm run dev:backend
fi
EOF
    fi

    chmod +x "$INSTALL_DIR/start.sh"

    # Create stop script
    cat > "$INSTALL_DIR/stop.sh" << 'EOF'
#!/bin/bash
echo "🛑 Stopping Agent Studio Backend..."
pkill -f "node backend" || echo "No process running"
pkill -f "tsx backend" || echo "No development process running"
EOF

    chmod +x "$INSTALL_DIR/stop.sh"
    
    # Create config file
    log "Creating configuration file..."
    cat > "$USER_HOME/.agent-studio-config/config.env" << EOF
# Agent Studio 配置
NODE_ENV=production
PORT=$SERVICE_PORT
SLIDES_DIR=$USER_HOME/slides

# 可选: AI 提供商
# OPENAI_API_KEY=your_key_here
# ANTHROPIC_API_KEY=your_key_here
EOF
    
    success "Agent Studio installation completed"
    
    if [ "$BUILD_SUCCESS" = true ]; then
        success "Build successful - will run in production mode"
    else
        warn "Build failed - will run in development mode (slower startup)"
    fi
}

# Cleanup temp files
cleanup() {
    log "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    success "Cleanup completed"
}

# Install systemd service (Linux only)
install_systemd_service() {
    if [ "$OS" != "linux" ] || [ "$EUID" -ne 0 ]; then
        return 0
    fi

    echo ""
    echo "=== System Service Configuration ==="
    echo ""
    read -p "Would you like to install Agent Studio as a system service? (y/N): " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        return 0
    fi

    log "Installing systemd service..."

    # Create systemd service file
    local SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Agent Studio Backend
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$INSTALL_DIR
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NODE_ENV=production
Environment=PORT=$SERVICE_PORT
Environment=SLIDES_DIR=$USER_HOME/slides
ExecStart=$INSTALL_DIR/start.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME.service"

    success "Systemd service installed and enabled"
    echo ""
    echo "Service commands:"
    echo "  sudo systemctl start $SERVICE_NAME"
    echo "  sudo systemctl stop $SERVICE_NAME"
    echo "  sudo systemctl restart $SERVICE_NAME"
    echo "  sudo systemctl status $SERVICE_NAME"
    echo "  sudo journalctl -u $SERVICE_NAME -f"
    echo ""

    read -p "Would you like to start the service now? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        systemctl start "$SERVICE_NAME"
        sleep 3
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            success "Service started successfully!"
        else
            error "Service failed to start. Check logs: journalctl -u $SERVICE_NAME"
        fi
    fi
}

# Service configuration (optional)
configure_service() {
    echo ""
    echo "=== Service Configuration ==="
    echo ""
    success "Agent Studio Backend is ready to use!"
    echo ""
    echo "The service can run without additional configuration."
    echo "API keys can be added later if needed by editing:"
    echo "  $USER_HOME/.agent-studio-config/config.env"

    # Offer systemd service installation on Linux with root privileges
    if [ "$OS" = "linux" ] && [ "$EUID" -eq 0 ]; then
        install_systemd_service
    fi
}

# Start the service
start_service() {
    echo ""
    read -p "Would you like to start the Agent Studio backend now? (y/N): " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "Starting Agent Studio backend..."

        if [ -f "$INSTALL_DIR/start.sh" ]; then
            log "Running start script..."
            "$INSTALL_DIR/start.sh" &

            # Wait a moment and check if service started
            sleep 5
            if curl -s http://localhost:4936/api/health >/dev/null 2>&1; then
                success "Backend started successfully!"
                echo ""
                echo "✨ Access the application at:"
                echo "   https://agentstudio-frontend.vercel.app/"
                echo ""
                echo "💡 Configure the backend URL in the web interface:"
                echo "   Settings → API Configuration → http://localhost:4936"
            else
                warn "Backend may still be starting up..."
                log "You can check the status by running the start script again"
            fi
        else
            error "Start script not found. Please check the installation."
        fi
    else
        echo ""
        echo "To start the backend later, run:"
        echo "  $INSTALL_DIR/start.sh"
    fi
}

# Main installation function
main() {
    echo "╔══════════════════════════════════════════╗"
    echo "║       Agent Studio Remote Installer      ║"
    echo "║                                          ║"
    echo "║  This will install:                      ║"
    echo "║  • Agent Studio Backend (user-local)    ║"
    echo "║  • Node.js (if not available)           ║"
    echo "║  • Dependencies (npm/pnpm)              ║"
    echo "║  • Start/Stop scripts                   ║"
    echo "║  • Configuration files                  ║"
    if [ "$OS" = "linux" ] && [ "$EUID" -eq 0 ]; then
        echo "║  • Systemd service (optional)          ║"
    fi
    echo "╚══════════════════════════════════════════╝"
    echo ""

    if [ -n "$SUDO_USER" ] && [ "$EUID" -eq 0 ] && [ "$ACTUAL_USER" != "root" ]; then
        warn "Running with sudo - installing for user: $ACTUAL_USER"
        echo ""
    elif [ "$EUID" -eq 0 ] && [ "$ACTUAL_USER" = "root" ]; then
        warn "Running as root - installing for root user"
        echo ""
    fi
    
    check_environment
    detect_os
    check_git
    check_nodejs
    check_pnpm
    download_agent_studio
    run_installation
    configure_service
    start_service
    
    echo ""
    echo "🎉 Installation Complete!"
    echo ""
    echo "Agent Studio Backend is now installed in: $INSTALL_DIR"
    echo "Target user: $ACTUAL_USER"
    echo ""

    if [ "$EUID" -eq 0 ] && [ "$OS" = "linux" ]; then
        echo "🔧 System service available:"
        echo "   sudo systemctl start $SERVICE_NAME"
        echo "   sudo systemctl status $SERVICE_NAME"
        echo ""
    fi

    echo "🚀 Manual startup commands:"
    echo "  $INSTALL_DIR/start.sh    # Start the backend"
    echo "  $INSTALL_DIR/stop.sh     # Stop the backend"
    echo ""
    echo "⚙️  Configuration file:"
    echo "  $USER_HOME/.agent-studio-config/config.env"
    echo ""
    echo "✨ Access the application at:"
    echo "   https://agentstudio-frontend.vercel.app/"
    echo ""
    echo "💡 After starting the backend, configure the backend URL in the web interface:"
    echo "   Settings → API Configuration → http://localhost:4936"
    echo ""
    echo "📁 Slides directory: $USER_HOME/slides"
    echo ""
    echo "For more information, visit:"
    echo "  https://github.com/$GITHUB_REPO"
    echo ""
    
    # Clean up temp files at the end
    cleanup
}

# Handle script interruption (but not normal exit)
trap cleanup INT TERM

# Run main function
main "$@"