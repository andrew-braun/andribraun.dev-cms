# Docker Build Instructions

This document outlines how to build and run the andribraun.dev CMS Docker image.

## Prerequisites

- Docker with BuildKit support (enabled by default in Docker 23.0+)
- `output: 'standalone'` configured in `next.config.mjs`
- Database credentials (for running migrations during build)

## Building the Image

**Important:** Docker doesn't automatically load `.env` files during builds. You must explicitly provide secrets via environment variables or files.

### Option 1: Using Environment Variables

First, export the required secrets:

```bash
export DATABASE_URI="postgresql://user:password@host:5432/dbname"
export PAYLOAD_SECRET="your-secret-key"

DOCKER_BUILDKIT=1 docker build \
  --secret id=database_uri,env=DATABASE_URI \
  --secret id=payload_secret,env=PAYLOAD_SECRET \
  -t andribraun-dev-cms:latest .
```

Or load from your `.env` file:

```bash
set -a && source .env && set +a && \
DOCKER_BUILDKIT=1 docker build \
  --secret id=database_uri,env=DATABASE_URI_BUILD \
  --secret id=payload_secret,env=PAYLOAD_SECRET \
  -t andribraun-dev-cms:latest .
```

**Using a separate build database:** If you want to use a different database for builds (recommended), set `DATABASE_URI_BUILD` in your `.env` file and reference it:

```bash
set -a && source .env && set +a && \
DOCKER_BUILDKIT=1 docker build \
  --secret id=database_uri,env=DATABASE_URI_BUILD \
  --secret id=payload_secret,env=PAYLOAD_SECRET \
  -t andribraun-dev-cms:latest .
```

Note: Inside the container, this will be mapped to `DATABASE_URI` (which Payload requires), but the value comes from your `DATABASE_URI_BUILD` variable.

### Option 2: Using Secret Files (Recommended for Local Development)

Create a `.docker-secrets` directory:

```bash
mkdir -p .docker-secrets
echo "$DATABASE_URI" > .docker-secrets/database_uri
echo "$PAYLOAD_SECRET" > .docker-secrets/payload_secret
```

Add to `.gitignore`:

```
.docker-secrets/
```

Then build:

```bash
DOCKER_BUILDKIT=1 docker build \
  --secret id=database_uri,src=.docker-secrets/database_uri \
  --secret id=payload_secret,src=.docker-secrets/payload_secret \
  -t andribraun-dev-cms:latest .
```

**Important:** Add `*.txt` and `.docker-secrets/` to `.gitignore` to avoid committing secrets!

## Running the Container

```bash
docker run -p 3000:3000 \
  -e DATABASE_URI="postgresql://user:password@host:5432/dbname" \
  -e PAYLOAD_SECRET="your-secret-key" \
  andribraun-dev-cms:latest
```

## Build Process

The Dockerfile performs these steps:

1. **Dependencies Stage**: Installs pnpm dependencies
2. **Builder Stage**:
   - Copies dependencies and source code
   - Mounts BuildKit secrets for database access
   - Runs `pnpm build` which executes:
     - `payload migrate` - Runs database migrations
     - `next build` - Builds the Next.js application
3. **Runner Stage**: Creates minimal production image

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Build Docker Image
  env:
    DATABASE_URI: ${{ secrets.DATABASE_URI }}
    PAYLOAD_SECRET: ${{ secrets.PAYLOAD_SECRET }}
  run: |
    DOCKER_BUILDKIT=1 docker build \
      --secret id=database_uri,env=DATABASE_URI \
      --secret id=payload_secret,env=PAYLOAD_SECRET \
      -t andribraun-dev-cms:${{ github.sha }} .
```

### Docker Compose

If using `docker-compose.yml`:

```bash
DOCKER_BUILDKIT=1 docker-compose build
```

Make sure to configure secrets in your compose file or environment.

## Security Notes

- **BuildKit Secrets**: Secrets are mounted during build but never persisted in the image
- **No ARG/ENV for secrets**: Prevents secrets from appearing in image history
- **Runtime secrets**: Still need to pass environment variables when running the container

## Troubleshooting

### BuildKit not enabled

If you see errors about `--secret`, enable BuildKit:

```bash
export DOCKER_BUILDKIT=1
```

Or set it permanently in `/etc/docker/daemon.json`:

```json
{
  "features": {
    "buildkit": true
  }
}
```

### Migration failures

Ensure your DATABASE_URI is accessible from the build environment. Some CI/CD platforms may require special networking configuration to reach databases during builds.

### Out of memory during build

The build script includes `--max-old-space-size=8000`. If builds still fail, increase Docker's memory limit in Docker Desktop settings or on your host.

## Image Details

- **Base Image**: node:22.12.0-alpine
- **Package Manager**: pnpm (auto-detected from lockfile)
- **Exposed Port**: 3000
- **User**: nextjs (non-root)
- **Working Directory**: /app
