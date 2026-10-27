# Charchokkha Empire — Architecture Constraints

## 1. Project Goal

Build a browser-based, real-time multiplayer property-trading board game inspired by classic property-trading games.

The working title is **Charchokkha Empire**.

Build incrementally. Do not attempt the entire game in one milestone. Preserve existing working code and inspect the repository before making changes.

## 2. Technology Stack

- Package manager: pnpm workspaces
- Frontend: React, Vite, TypeScript
- Backend: Node.js, TypeScript, Socket.IO
- Validation and shared contracts: Zod
- Game engine: pure TypeScript
- Unit tests: Vitest
- Browser and end-to-end tests: Playwright
- Shared-package bundling: tsup
- Persistence: none for live rooms in version 1; see Section 9

Use one consistent ESM strategy across the repository. Do not mix incompatible CommonJS and ESM configurations.

## 3. Monorepo Structure

    apps/
      web/
      server/
    packages/
      shared/
      game-engine/
    ARCHITECTURE.md
    package.json
    pnpm-workspace.yaml
    tsconfig.base.json

### Package responsibilities

**`apps/web`**
- React application and user interface.
- Board rendering using SVG and CSS.
- Lobby, player actions, game display, and connection status.
- Must not decide authoritative game outcomes.

**`apps/server`**
- Socket.IO server and HTTP health endpoint.
- Guest sessions, room membership, reconnection, and authorization.
- Authoritative game state and action processing.
- Server-side validation of all incoming messages.

**`packages/shared`**
- Zod schemas for client/server messages.
- Shared event contracts and inferred TypeScript types.
- Shared data types that do not depend on application packages.

**`packages/game-engine`**
- Pure game rules and state transitions.
- No React, browser APIs, Socket.IO, database, or server-framework dependencies.
- Accept explicit inputs and produce deterministic results where practical.
- Accept an injectable random-number function for randomized game mechanics.

### Dependency direction

- `shared` depends on no internal package.
- `game-engine` may depend on `shared`.
- `server` may depend on `shared` and `game-engine`.
- `web` depends on `shared`.
- `web` may depend on `game-engine` only for non-authoritative previews or calculations.
- No package may import from `apps/*`.

Enforce these boundaries through package exports and TypeScript configuration where practical.

## 4. Shared Package Build Strategy

Use **tsup to build `shared` and `game-engine` into their respective `dist` directories**.

Both applications must consume these packages through their declared package exports, rather than using inconsistent source aliases in development and compiled paths in production.

Configure workspace dependencies explicitly.

Provide scripts for:
- Development
- Build
- Type checking
- Unit testing
- Production startup

Add a CI smoke test that verifies each shared package can be imported by both applications wherever that dependency is permitted. Run the smoke test against the built package output, not only the TypeScript source.

Do not consider a successful Vite build or `tsx` startup to be proof of successful TypeScript type checking.

## 5. Authoritative Game State

The server is the sole authority for:
- Dice results
- Player movement
- Money and payments
- Property ownership
- Rent
- Purchases and trades
- Game phases and turn order
- Bankruptcy and game completion

Never accept client-supplied outcomes as authoritative.

Validate every incoming Socket.IO event with its shared Zod schema on the server. Valid shape does not imply permission to perform the action.

Derive the authenticated player and room membership from the server-side socket/session association. Do not trust client-supplied player IDs or room IDs for authorization.

Check the current game phase, active player, turn, and action permissions before applying an action.

## 6. Action Processing and Idempotency

For version 1, live room state is in memory.

Apply each action synchronously through a **per-room action queue**. Do not `await` database, network, or other asynchronous operations between reading the authoritative state and applying its state transition.

If persistence or other asynchronous work is introduced, perform it after the in-memory transition and handle failures explicitly. Do not assume the in-memory state and a database write are automatically atomic.

Use phase, turn, and permission checks as the primary defense against duplicate or illegal actions.

For actions that require retry-safe responses, accept a request ID and scope its idempotency record to the authenticated session. A repeated request with the same ID must return the original result rather than applying the action again.

Keep idempotency records for a bounded period. Define behavior for expired records and conflicting reuse of a request ID.

Do not add database transactions to in-memory game logic when no database operation is involved.

## 7. Guest Identity and Reconnection

Guest players do not need an account.

Issue a cryptographically random, server-generated guest session token. Associate it with a server-side player identity and seat.

For version 1:
- Store the guest token in `localStorage`.
- Use HTTPS in production.
- Apply a strict Content Security Policy and avoid unsafe script execution.
- Never put tokens in URLs, query strings, logs, or analytics.
- Send the token through the Socket.IO `auth` handshake.
- Validate the token on the server before granting access to a seat.
- Do not accept a client-supplied player ID as proof of identity.

If tokens are rotated, keep the previous token valid for a short, defined overlap period. A lost response containing a replacement token must not immediately lock the player out.

Implement reconnection using the existing server-side session and seat association.

### State synchronization

Every room state has a monotonically increasing sequence number.

On successful connection or reconnection:
1. Authenticate the guest session.
2. Send a full, authorized room-state snapshot with its sequence number.
3. Send subsequent incremental state events with increasing sequence numbers.
4. Let the client detect missing sequence numbers.
5. If a gap is detected, let the client request a fresh snapshot.
6. Ensure the snapshot reflects a consistent state at its sequence number.

Never expose private session tokens or other players' private authentication data in room snapshots.

## 8. Socket.IO Security and Reliability

Implement:
- An explicit CORS allowlist for configured frontend origins.
- Socket.IO origin checks appropriate to the deployment.
- Server-side authentication and per-action authorization.
- Zod validation for every client-to-server event.
- A maximum inbound payload size.
- Per-session rate limits for sensitive or frequently invoked events.
- Structured logs that exclude guest tokens and other secrets.
- A basic HTTP health endpoint for deployment health checks.
- Clear handling of malformed messages, rejected actions, disconnects, and reconnects.

Do not expose stack traces, secrets, or internal server details to clients.

## 9. Room Lifecycle, Persistence, and Scaling

Define explicit room states:
- `waiting`
- `starting`
- `in_progress`
- `finished`
- `abandoned`

Define valid transitions and behavior for host departure, player departure, disconnects, timeouts, and insufficient players.

### Version 1 persistence policy

Live rooms and active matches exist only in server memory. They are lost when the server process restarts or is redeployed.

This is an intentional version 1 limitation. Do not imply that live games survive a restart.

Persistent accounts, match history, and recoverable active games are future milestones. If active-game recovery becomes a requirement, design and implement explicit snapshots and recovery logic using PostgreSQL or Redis.

### Scaling constraint

Start with one authoritative server process.

If multiple server instances are introduced later:
- Each active room must have one authoritative owner instance.
- Routing must ensure room actions reach that owner.
- Socket.IO deployment must use an appropriate adapter and any required sticky-session configuration.
- Shared room ownership and recovery must be designed explicitly.

Do not claim that multiple instances can safely share in-memory room state.

## 10. Randomness and Testing

Use Node.js `crypto.randomInt(1, 7)` for each six-sided die. The upper bound is exclusive.

Keep randomness injectable in the game engine so tests can provide deterministic results.

Add tests verifying that each die result is an integer from 1 through 6. Include deterministic tests for important game rules and illegal actions.

Use:
- Vitest for schemas, game rules, and server-side unit tests.
- Playwright for browser workflows and end-to-end tests.
- A Socket.IO smoke test for the validated client/server event flow.

## 11. Milestone 1 — Foundation Only

Do not implement the complete board game in this milestone.

Inspect the repository first. Preserve useful existing work and document any necessary deviations from this architecture.

Establish:
- The pnpm workspace and package structure.
- Consistent ESM and TypeScript configuration.
- The shared Zod schema package.
- The game-engine package with a minimal pure function and test.
- A minimal React/Vite frontend.
- A minimal Node.js/Socket.IO backend.
- Explicit package exports and the shared-package build strategy.
- Root scripts for installation workflows, type checking, tests, and builds.
- A basic HTTP health endpoint.
- A minimal validated Socket.IO request/response.
- A smoke test for the socket flow.
- Basic development and production startup instructions.

Use a small, harmless example event for the smoke test. It must validate the incoming payload, return a response, and avoid pretending to implement real game mechanics.

## 12. Milestone 1 Acceptance Criteria

From a clean checkout, these commands must pass:

    pnpm install
    pnpm typecheck
    pnpm test
    pnpm build

Also verify:
- The frontend starts.
- The backend starts.
- The health endpoint responds successfully.
- One Zod schema from `shared` is imported and used by both applications.
- The built shared packages can be imported using their declared package exports.
- The Socket.IO smoke test connects, sends a valid event, and receives the expected response.
- Invalid payloads are rejected by the server.
- The tests include a six-sided die range assertion.
- TypeScript type checking runs explicitly and is not inferred from a successful bundler build.

Report the actual commands executed and their results. Clearly identify anything not run, any failure, and any unresolved issue. Never claim a test passed unless it was actually run.

## 13. Rules for Every Future Milestone

Before changing code:
1. Read `ARCHITECTURE.md`.
2. Inspect the existing implementation.
3. Identify the requested milestone and its acceptance criteria.
4. Preserve unrelated working behavior.

After changing code:
1. Run the relevant type checks and tests.
2. Run the build when applicable.
3. Report changed files and architectural decisions.
4. Include actual command output or concise, faithful excerpts.
5. List known limitations and the next recommended milestone.

Implement only the requested milestone. Do not silently expand scope or replace established technologies.