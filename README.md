# Andri Braun Portfolio CMS

A headless CMS built with [Payload CMS](https://payloadcms.com) v3 and Next.js for managing portfolio projects, technologies, and media.

## Overview

This CMS powers my portfolio website by managing projects, technologies, and media assets. It features an AI-powered technology extraction system that automatically identifies and catalogs technologies mentioned in project descriptions.

## Key Features

### AI Technology Extraction

The standout feature is intelligent technology extraction powered by Claude AI:

- **Automatic Detection**: Analyzes project descriptions to identify technologies, frameworks, and tools
- **Smart Cataloging**: Creates new technology entries automatically with proper categorization
- **Relationship Management**: Links extracted technologies to projects seamlessly
- **Data Validation**: Validates URLs, required fields, and categories before saving
- **Error Reporting**: Provides detailed logging and user feedback for troubleshooting

Access it via the "Extract Technologies" button when editing any project in the admin panel.

### Collections Architecture

**Projects**: Portfolio projects with rich text descriptions, markdown support, and technology associations

**Technologies**: Centralized database of technologies with:

- Name, description, and official documentation links
- Category classification (Frontend, Backend, Database, DevOps, etc.)
- Automatic extraction from project descriptions

**Tags**: Flexible tagging system for content organization

**Media**: Image and asset management with Cloudflare R2 cloud storage

**Users**: Authentication-enabled admin access control

## Tech Stack

- **CMS**: Payload CMS 3.69.0
- **Framework**: Next.js 16.1.1 (App Router)
- **Database**: PostgreSQL
- **Storage**: Cloudflare R2 (S3-compatible)
- **AI**: Claude (Anthropic)
- **Testing**: Vitest, Playwright
- **Language**: TypeScript

## Architecture

Built on modern web technologies with type safety throughout:

- Server Actions for data mutations
- Auto-generated TypeScript types from Payload collections
- PostgreSQL migrations for schema management
- Cloud-native storage with Cloudflare R2
- AI integration for intelligent content processing

## Development Workflow

### Local Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Access admin panel at http://localhost:3001/admin
```

### Database Migrations

**⚠️ CRITICAL: Database migrations are essential to prevent database corruption.**

#### Migration Rules

1. **NEVER run migrations in development** - The dev server should run against a stable database
2. **ALWAYS create migrations before committing** - Schema changes must be tracked
3. **Server automatically runs migrations on build** - Production deployment applies migrations

#### Creating Migrations

When you make changes to Payload collections (schemas), you **MUST** create a migration:

```bash
pnpm payload migrate:create
```

This generates a migration file in `src/migrations/` that tracks your schema changes.

#### Automated Pre-Commit Hook

This project uses Husky to **automatically** run the following before every commit:

- ✅ ESLint (with auto-fix)
- ✅ Prettier formatting
- ✅ Migration file creation (`payload migrate:create`)

You don't need to remember to create migrations manually - the pre-commit hook handles it!

#### What Happens on Deployment

The build script (`pnpm build`) automatically runs `payload migrate` before building:

```json
"build": "payload migrate && next build"
```

This applies all pending migrations to your production database before deploying the new code.

#### Manual Migration Commands

```bash
# Create a new migration (done automatically on commit)
pnpm payload migrate:create

# Apply pending migrations (done automatically on build)
pnpm payload migrate

# Check migration status
pnpm payload migrate:status
```

**Reference**: [Payload CMS Migrations Documentation](https://payloadcms.com/docs/database/migrations)

## Deployment

### Pre-Deployment Checklist

1. ✅ Make schema changes to collections
2. ✅ Commit your changes (pre-commit hook creates migration automatically)
3. ✅ Verify migration file was created in `src/migrations/`
4. ✅ Push to repository
5. ✅ Deploy (migrations run automatically during build)

### Deployment Process

The server automatically:

1. Runs `payload migrate` to apply all pending migrations
2. Builds the Next.js application
3. Starts the production server

**Never skip migrations** - they ensure your database schema matches your code.
