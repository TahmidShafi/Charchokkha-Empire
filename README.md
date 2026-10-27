# Charchokkha Empire — Monorepo

Multilanguage & real-time multiplayer property-trading board game platform.

## Architecture

This monorepo follows the architecture specified in `ARCHITECTURE.md`:

```
apps/
  web/          - React + Vite + TypeScript frontend
  server/       - Node.js + Socket.IO + HTTP health backend
packages/
  shared/       - Zod validation schemas, inferred types, and event contracts
  game-engine/  - Pure deterministic game mechanics (dice rolling, rules)
tests/          - Root CI smoke tests validating built package exports and socket flows
```

### Dependency Direction

- `packages/shared` depends on no internal package.
- `packages/game-engine` depends on `packages/shared`.
- `apps/server` depends on `packages/shared` and `packages/game-engine`.
- `apps/web` depends on `packages/shared` and `packages/game-engine`.
- No package imports from `apps/*`.

---

## Quickstart & Verification

From the repository root:

```bash
# 1. Install dependencies across all workspaces
pnpm install

# 2. Typecheck all packages and apps with strict TypeScript
pnpm typecheck

# 3. Run all unit and CI smoke tests
pnpm test

# 4. Build all shared packages and application bundles
pnpm build
```

---

## Development

Run both the server and the web client simultaneously in development mode:

```bash
pnpm dev
```

Or run individual services:

```bash
# Backend server (watches and restarts on changes)
pnpm dev:server

# Frontend Vite dev server (runs at http://localhost:5173)
pnpm dev:web
```

---

## Production Startup

```bash
# 1. Build all packages and applications
pnpm build

# 2. Start the production backend server
pnpm start:server
# Server will listen on http://0.0.0.0:3001
# Health check available at: http://0.0.0.0:3001/health

# 3. Preview or serve the production web build
pnpm preview:web
```
