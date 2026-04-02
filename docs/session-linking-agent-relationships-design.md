# Session Linking & Agent Relationships

## Problem

Context Lens creates separate conversation entries when it should group them as one session:

1. **Subagents**: Claude Code spawns subagents via the Agent tool. Each subagent makes API calls with a different `session_<uuid>` in `metadata.user_id`, producing a different fingerprint and a separate conversation in the UI.

2. **Session resume**: `claude --continue` starts a new CLI process with a new `session_<uuid>`. The store creates a new conversation instead of appending to the existing one.

Both problems stem from `computeFingerprint()` in `src/core/conversation.ts` relying on `metadata.user_id` which contains a per-process UUID.

Additionally, Context Lens has no concept of relationships between agents — there's a flat `AgentGroup[]` within each conversation but no parent/child, continuation, or team-member semantics.

## Design

### Two-layer architecture

**Layer 1 — Proxy-time grouping (per-client adapter as proxy plugin)**

A proxy plugin intercepts requests before they reach the store. It resolves all session UUIDs that belong to the same logical session back to a single **root session UUID** and overrides `ctx.sessionId`. The store sees one stable ID and groups all entries into one conversation.

The plugin is client-specific. For Claude Code, it reads `~/.claude/projects/` JSONL session files to discover which session UUIDs share the same file. For other clients (OpenCode, Copilot), different adapters produce the same output: an opaque stable session ID on `ctx.sessionId`.

The proxy and store are unaware of how the adapter derives the ID.

**Layer 2 — Relationship API (store-side, client-agnostic)**

The store exposes a `POST /api/relationships` endpoint. Adapters call it to register rich metadata: parent/child, continuation, team-member relationships between session UUIDs. The store resolves session UUIDs to conversation IDs via an internal index and persists the relationships.

This layer is optional — sessions are grouped correctly by Layer 1 alone. Layer 2 adds the metadata needed for the agent breakdown UI.

### Data model changes

#### New: SessionRelationship (persisted in store state file)

```typescript
interface SessionRelationship {
  sourceSessionUuid: string;   // child/continuation session UUID
  targetSessionUuid: string;   // parent/original session UUID
  type: "continuation" | "child" | "team-member";
  metadata?: {
    agentName?: string;        // "researcher", "coder", etc.
    adapterSource?: string;    // "claude-code", "opencode"
  };
}
```

#### Extended: Conversation (add session UUID index)

The `Conversation` type already has an optional `sessionId` field. Add a reverse lookup map to the store:

```typescript
// Store internal state
private sessionUuidToConversation = new Map<string, string>();
// session_<uuid> → conversationId
```

Populated when entries are stored. The relationship API uses this to resolve UUIDs → conversation IDs.

#### Extended: ConversationGroup API response

Only included when relationships exist (multi-agent sessions):

```typescript
interface ConversationGroup extends Conversation {
  agents: AgentGroup[];
  entries: ProjectedEntry[];
  // New (only present when relationships exist):
  relatedAgents?: RelatedAgent[];
}

interface RelatedAgent {
  sessionUuid: string;
  relationship: "root" | "child" | "continuation" | "team-member";
  agentName?: string;
  agentKey: string | null;
  model: string;
  turnCount: number;
  costUsd: number;
}
```

#### Extended: AgentGroup

```typescript
interface AgentGroup {
  key: string;
  label: string;
  model: string;
  entries: ProjectedEntry[];
  // New:
  relationship?: "root" | "child" | "continuation" | "team-member";
  parentKey?: string;   // agentKey of parent agent, if child
}
```

### Store changes

#### New: Relationship storage and persistence

- Store maintains `SessionRelationship[]` in memory
- Persisted as `{ type: "relationship", data: SessionRelationship }` lines in the state file (same JSONL format as existing conversation/entry lines)
- Loaded on startup in `loadState()`

#### New: Session UUID → conversation ID index

- `Map<string, string>` mapping `session_<uuid>` → `conversationId`
- Populated in `storeRequest()` when `rawSessionId` is extracted
- Used by the relationship API to resolve incoming session UUIDs

#### New: API endpoint

```
POST /api/relationships
{
  sourceSessionUuid: string,
  targetSessionUuid: string,
  type: "continuation" | "child" | "team-member",
  metadata?: { agentName?: string, adapterSource?: string }
}
```

**Race condition handling**: The adapter should `GET /api/session-uuid/{uuid}` to confirm the parent session UUID has been captured before POSTing the relationship. This is a new lightweight endpoint that returns `200 { conversationId }` or `404`. If the parent isn't known yet, the adapter holds the relationship in a small in-memory buffer and retries on its next `onRequest` cycle. This avoids both fire-and-forget failures and complex server-side queuing.

Response: `200 { ok: true }` or `404 { error: "unknown_session" }` if either session UUID can't be resolved.

#### Modified: Conversation grouping in API responses

When building `ConversationGroup` for API responses, the store checks for relationships associated with the conversation's entries. If found, populates `relatedAgents` and enriches `AgentGroup` with `relationship` and `parentKey`.

### Client adapter plugins

Both adapters are proxy plugins loaded via `CONTEXT_LENS_PROXY_PLUGINS`. They share the same contract: override `ctx.sessionId` for grouping, POST to `/api/relationships` for metadata. Each is a self-contained TypeScript module.

#### Claude Code adapter (~120 lines)

**Session identity**: Claude Code sends `metadata.user_id` containing `session_<uuid>` in the request body. Multiple session UUIDs map to the same logical session via Claude Code's JSONL session files at `~/.claude/projects/`.

**JSONL file scanning — kept minimal**:
- On startup: scan only the most recently modified JSONL file per project directory (not all files). This is O(project_count), not O(total_files).
- On cache miss: when a `session_<uuid>` isn't in the map, read only the JSONL files modified in the last 5 minutes (subagents/resumes create writes to the same file). This avoids full rescans.
- `fs.watch` on each project directory triggers incremental re-reads of changed files only.
- The map is `Map<string, { rootUuid: string, parentUuid: string | null }>` — lightweight, no message content stored.

**Per-request (`onRequest`)**:
1. Check `ctx.headers["user-agent"]` for `claude-cli/` or `ctx.body` system prompt for "You are Claude Code". Skip non-Claude requests.
2. Extract `session_<uuid>` from `ctx.body.metadata.user_id`
3. Lookup in map. On miss, re-scan recently modified JSONL files.
4. If found, set `ctx.sessionId` to the root UUID from that JSONL file
5. If this UUID has a `parentUuid` and the parent is already known to the store (check in-memory buffer from prior requests), POST to `/api/relationships`. Otherwise, buffer the relationship and retry on next request.
6. Return modified ctx

**What it does NOT do**:
- Does not modify `ctx.body` (API request to Anthropic is unchanged)
- Does not read message content from JSONL files (only `sessionId` and `parentUuid` fields)
- Does not depend on Context Lens internals — only uses the proxy plugin interface and the public relationship API

#### OpenCode adapter (~60 lines)

**Session identity**: OpenCode sends a `session_id` header and an `originator: "opencode"` header on every request. The `session_id` is stable for a given session and reused on resume — no JSONL scanning needed.

**Per-request (`onRequest`)**:
1. Check `ctx.headers["originator"] === "opencode"`. Skip non-OpenCode requests.
2. Read `ctx.headers["session_id"]` — this is the stable session ID.
3. Set `ctx.sessionId` to this value. (OpenCode already provides a stable ID, so Layer 1 works out of the box.)
4. For fork relationships: OpenCode's `session_id` changes on fork. The adapter maintains a small in-memory map of `session_id` → parent `session_id` populated from the `parentID` context if available in request metadata. When a fork is detected, POST to `/api/relationships`.
5. Return modified ctx

**Note**: OpenCode's stable `session_id` header means resume works automatically. The adapter's main value is fork/subagent relationship metadata.

### UI changes

#### Scope

Only sessions with multiple agents are affected. Single-agent sessions are untouched.

#### Sidebar (SessionRail)

- Sessions with `relatedAgents` show an "N agents" badge on the tile
- No other sidebar changes — one entry per root session

#### Inspector (multi-agent sessions only)

Add an **agent selector** bar between the session header and the tab bar:

- **"All agents" chip** (default): shows aggregate stats (total cost, tokens, turns, duration) and an agent breakdown table listing each agent with its relationship, model, turns, cost, and a proportional cost bar
- **Individual agent chips**: clicking one scopes the existing turn scrubber, context bars, and messages view to that agent's entries only
- Agent chips show `→` arrows to indicate parent/child relationships
- Each chip shows model family, turn count, and cost

#### Existing components extended (not replaced)

- `TurnScrubber.vue`: accepts optional `agentKey` filter prop. When set, shows only that agent's entries. When null, shows all (existing behavior).
- `OverviewTab.vue`: when "All agents" selected, renders the aggregate + breakdown view instead of the single-entry detail. When an agent is selected, existing behavior.
- `MessagesTab.vue`: existing Main/All toggle continues to work. When agent is selected via chips, messages filter to that agent.
- `classifyEntries()` in `ui/src/utils/messages.ts`: extended to use relationship metadata from `AgentGroup.relationship` instead of the majority-vote heuristic, when available.

#### New components

- `AgentSelector.vue`: the chip bar. Receives `AgentGroup[]` with relationship data. Emits selected agent key. Only rendered when `relatedAgents` exists.
- `AgentBreakdown.vue`: the aggregate table shown in "All agents" view. Receives `RelatedAgent[]`. Each row is clickable to select that agent.

### Persistence

Relationships are persisted in the same state JSONL file as conversations and entries:

```jsonl
{"type":"relationship","data":{"sourceSessionUuid":"session_BBB","targetSessionUuid":"session_AAA","type":"child","metadata":{"agentName":"researcher","adapterSource":"claude-code"}}}
```

Loaded on startup. Evicted when the associated conversation is evicted (cascade: when a conversation is deleted from the store, remove all relationships where either UUID resolves to that conversation, and remove the UUID entries from the session UUID index).

### What this does NOT change

- LHAR export format (relationships are a Context Lens concept, not LHAR)
- Capture file format
- `@contextio/core` or `@contextio/proxy` packages
- Codex/Gemini session handling (their existing TTL-based tracking is unaffected)
- Single-agent session UI
- Shared session viewer (contextlens.io)

### Request flow summary

```
Claude Code main agent
  → Proxy Plugin: extract session_AAA, lookup root → set ctx.sessionId
  → Store: create/append to conversation using stable ID
  → Plugin: POST /api/relationships (root agent)

Claude Code subagent  
  → Proxy Plugin: extract session_BBB, lookup root → SAME ctx.sessionId
  → Store: append to SAME conversation, different agentKey
  → Plugin: POST /api/relationships (child of session_AAA)

Claude Code resume
  → Proxy Plugin: extract session_CCC, lookup root → SAME ctx.sessionId
  → Store: append to SAME conversation
  → Plugin: POST /api/relationships (continuation of session_AAA)

OpenCode session
  → Proxy Plugin: read session_id header → set ctx.sessionId (stable, no file I/O)
  → Store: create/append to conversation
  → Plugin: POST /api/relationships on fork (if parentID detected)

UI
  → Sidebar: one tile with "4 agents" badge
  → Inspector: agent selector chips → aggregate or per-agent view
```
