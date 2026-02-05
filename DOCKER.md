# Docker Deployment Guide

AgentStudio can be deployed as a Docker container with multiple runtime options.

## Quick Start (Default: Bun Runtime)

```bash
# Build Docker image (uses Bun for faster runtime)
docker build -t agentstudio:latest .

# Run with mounted HOME directory
docker run -d \
  --name agentstudio \
  -p 4936:4936 \
  -e ANTHROPIC_API_KEY=your_key_here \
  -v $(pwd)/data/home:/home/agentstudio \
  agentstudio:latest
```

## Runtime Options

| Dockerfile | Runtime | Build | Memory | Startup | Use Case |
|-----------|---------|-------|--------|---------|----------|
| `Dockerfile` | **Bun** | Docker | 6GB+ | **Fast** | Default, recommended |
| `Dockerfile.node` | Node.js | Docker | 6GB+ | Normal | Full compatibility |
| `Dockerfile.prebuilt` | Node.js | Local | 2GB | Normal | Development |
| `Dockerfile.npm` | Node.js | NPM | 2GB | Normal | Quick deploy |

### Using Node.js Runtime

```bash
docker build -f Dockerfile.node -t agentstudio:node .
docker run -d --name agentstudio -p 4936:4936 agentstudio:node
```

## Docker Compose Usage

### Using Source Build (default)

```bash
# Set your user ID to avoid permission issues (optional)
export USER_ID=$(id -u)
export GROUP_ID=$(id -g)

# Start
docker-compose up -d

# View logs
docker-compose logs -f agentstudio

# Stop
docker-compose down
```

### Using NPM Build

```bash
# Start with npm profile
docker-compose --profile npm up -d agentstudio-npm
```

## Mounting Local Directory as HOME

The container supports mounting a local directory as the user's HOME directory, which allows:
- Data persistence across container restarts
- Easy backup of all configurations
- Sharing data between host and container

### Examples

**Mount entire HOME (recommended):**
```bash
docker run -d \
  --name agentstudio \
  -p 4936:4936 \
  -v /path/to/local/home:/home/agentstudio \
  agentstudio:latest
```

**Mount specific directories:**
```bash
docker run -d \
  --name agentstudio \
  -p 4936:4936 \
  -v ./data/agent-studio:/home/agentstudio/.agent-studio \
  -v ./data/claude:/home/agentstudio/.claude \
  agentstudio:latest
```

**With docker-compose.yml:**
```yaml
services:
  agentstudio:
    image: agentstudio:latest
    volumes:
      # Option 1: Mount entire home
      - ./data/home:/home/agentstudio
      
      # Option 2: Mount specific directories
      # - ./data/agent-studio:/home/agentstudio/.agent-studio
      # - ./data/claude:/home/agentstudio/.claude
```

### Environment Variable

You can also set the home directory path via environment variable:

```bash
export AGENTSTUDIO_HOME=/path/to/local/home
docker-compose up -d
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `PORT` | Backend port | 4936 |
| `NODE_ENV` | Environment mode | production |
| `USER_ID` | Container user ID (build arg) | 1000 |
| `GROUP_ID` | Container group ID (build arg) | 1000 |
| `AGENTSTUDIO_HOME` | Local directory to mount as HOME | ./data/home |

## Build Comparison

| Feature | From Source | From NPM |
|---------|-------------|----------|
| Build time | Longer (requires local build) | Shorter |
| Image size | Smaller | Larger |
| Customization | Full control | Limited |
| Development | Better for dev | Better for deployment |
| Prerequisites | `pnpm run build` | None |

## Troubleshooting

### Permission Issues with Mounted Volumes

If you encounter permission issues, match the container user ID with your host user:

```bash
# Build with your user ID
docker build \
  --build-arg USER_ID=$(id -u) \
  --build-arg GROUP_ID=$(id -g) \
  -t agentstudio:latest .
```

### Container Exits Immediately

Check logs for errors:
```bash
docker logs agentstudio
```

Common issues:
- Missing API keys
- Port already in use
- Invalid volume mount paths

### Build Fails with Memory Error

If Docker build fails with exit code 137 (OOM), use the source build approach:

```bash
# Build locally (more memory available)
pnpm run build

# Then build Docker image (just copies files)
docker build -t agentstudio:latest .
```

## Health Check

The container includes a health check at `/api/health`:

```bash
# Check container health
docker ps
# Look for "healthy" status

# Manual check
curl http://localhost:4936/api/health
```

## Data Persistence

### Container Data Directories

```
/home/agentstudio/
├── .agent-studio/      # AgentStudio data
│   ├── data/           # Application data
│   ├── config/         # Configuration files
│   ├── logs/           # Log files
│   └── backup/         # Backup files
├── .claude/            # Claude configurations
│   └── projects/       # Project-specific data
└── .claude-agent/      # Claude agent data
```

### Backup

```bash
# Backup mounted home directory
tar czf agentstudio-backup.tar.gz ./data/home/

# Restore
tar xzf agentstudio-backup.tar.gz
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         Docker Container                     │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  Node.js Backend (port 4936)           │ │
│  │  - Express API server                  │ │
│  │  - Serves frontend static files        │ │
│  │  - Manages all application logic       │ │
│  └────────────────────────────────────────┘ │
│                  │                           │
│                  ↓                           │
│  ┌────────────────────────────────────────┐ │
│  │  Mounted Volume (/home/agentstudio)    │ │
│  │  - All user data and configurations    │ │
│  │  - Persists on host filesystem         │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ↑
    Port 4936
   (Frontend + API)
```

## Production Deployment

1. **Use specific image tags:**
   ```bash
   docker build -t agentstudio:v0.3.4 .
   ```

2. **Set resource limits:**
   ```yaml
   services:
     agentstudio:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 2G
   ```

3. **Use secrets for API keys:**
   ```yaml
   services:
     agentstudio:
       secrets:
         - anthropic_api_key
   
   secrets:
     anthropic_api_key:
       external: true
   ```

4. **Enable logging:**
   ```yaml
   services:
     agentstudio:
       logging:
         driver: "json-file"
         options:
           max-size: "10m"
           max-file: "3"
   ```
