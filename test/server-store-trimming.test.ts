import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseContextInfo } from "../src/core.js";
import { Store } from "../src/server/store.js";
import type { CapturedEntry } from "../src/types.js";

const SESSION = "session_55555555-5555-5555-5555-555555555555";

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "context-lens-trim-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function stateFileOf(dir: string): string {
  return path.join(dir, "data", "state.jsonl");
}

function makeStore(dir: string, fullMessageEntries: number): Store {
  return new Store({
    dataDir: path.join(dir, "data"),
    stateFile: stateFileOf(dir),
    maxSessions: 10,
    maxCompactMessages: 4,
    fullMessageEntries,
  });
}

// Turn t sends m1..m(2t-1), alternating user/assistant and ending on a user
// message. With `reminder`, it also ends on a per-turn "r<t>" that the next
// request no longer carries, the way clients inject per-turn reminders.
function storeTurns(
  store: Store,
  turns: number,
  opts: { reminder?: boolean } = {},
): CapturedEntry[] {
  const entries: CapturedEntry[] = [];
  for (let t = 1; t <= turns; t++) {
    const messages = [];
    for (let i = 1; i <= 2 * t - 1; i++) {
      messages.push({ role: i % 2 ? "user" : "assistant", content: `m${i}` });
    }
    if (opts.reminder) messages.push({ role: "user", content: `r${t}` });
    const body = {
      model: "claude-sonnet-4",
      metadata: { user_id: SESSION },
      messages,
    };
    const ci = parseContextInfo("anthropic", body, "anthropic-messages");
    entries.push(
      store.storeRequest(
        ci,
        {
          model: "claude-sonnet-4",
          stop_reason: "end_turn",
          usage: { input_tokens: 100 * t, output_tokens: 5 },
        } as any,
        "claude",
        body,
      ),
    );
  }
  return entries;
}

const contents = (e: CapturedEntry) =>
  e.contextInfo.messages.map((m) => m.content);

// Window of 4, newest 2 turns kept whole, older turns keep only what was new.
const EXPECTED = [
  ["m1"],
  ["m2", "m3"],
  ["m4", "m5"],
  ["m6", "m7"],
  ["m6", "m7", "m8", "m9"],
  ["m8", "m9", "m10", "m11"],
];

function chronological(store: Store): CapturedEntry[] {
  return [...store.getCapturedRequests()].reverse();
}

describe("Store message window trimming", () => {
  it("keeps full windows on the newest turns and only new messages on older ones", () => {
    const { dir, cleanup } = tempDir();
    const store = makeStore(dir, 2);

    const entries = storeTurns(store, 6);

    assert.deepEqual(entries.map(contents), EXPECTED);
    assert.deepEqual(
      entries.map((e) => e.contextInfo.messagesDeltaOnly ?? false),
      [true, true, true, true, false, false],
    );
    // Totals still describe each whole request, not the trimmed messages.
    assert.deepEqual(
      entries.map((e) => e.contextInfo.totalTokens),
      [100, 200, 300, 400, 500, 600],
    );
    cleanup();
  });

  it("keeps each turn's new messages when every request ends on a per-turn reminder", () => {
    const { dir, cleanup } = tempDir();
    const store = makeStore(dir, 2);

    const entries = storeTurns(store, 6, { reminder: true });

    assert.deepEqual(entries.map(contents), [
      ["m1", "r1"],
      ["m2", "m3", "r2"],
      ["m4", "m5", "r3"],
      ["m6", "m7", "r4"],
      ["m7", "m8", "m9", "r5"],
      ["m9", "m10", "m11", "r6"],
    ]);
    cleanup();
  });

  it("restores trimmed turns unchanged from the state file", () => {
    const { dir, cleanup } = tempDir();
    storeTurns(makeStore(dir, 2), 6);

    const reloaded = makeStore(dir, 2);
    reloaded.loadState();

    assert.deepEqual(chronological(reloaded).map(contents), EXPECTED);
    cleanup();
  });

  it("trims a state file written before trimming existed and rewrites it smaller", () => {
    const { dir, cleanup } = tempDir();
    storeTurns(makeStore(dir, 100), 6);
    // Make the file look like one from an older version: no new-message
    // indexes, and thinking signatures still kept on assistant messages.
    const file = stateFileOf(dir);
    const legacy = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const raw = JSON.parse(line);
        if (raw.type === "entry") {
          delete raw.data.contextInfo.newMessageIndexes;
          for (const m of raw.data.contextInfo.messages) {
            if (m.role === "assistant") {
              m.contentBlocks = [
                { type: "thinking", thinking: "", signature: "SIG".repeat(50) },
                { type: "text", text: m.content },
              ];
            }
          }
        }
        return JSON.stringify(raw);
      })
      .join("\n");
    writeFileSync(file, `${legacy}\n`);
    const legacyBytes = statSync(file).size;

    const migrated = makeStore(dir, 2);
    migrated.loadState();

    assert.deepEqual(chronological(migrated).map(contents), EXPECTED);
    assert.ok(
      statSync(file).size < legacyBytes,
      "state file was rewritten smaller",
    );
    assert.ok(
      !readFileSync(file, "utf8").includes("SIG"),
      "signatures dropped",
    );
    const again = makeStore(dir, 2);
    again.loadState();
    assert.deepEqual(chronological(again).map(contents), EXPECTED);
    cleanup();
  });

  it("does not write to a state file it could not read", () => {
    const { dir, cleanup } = tempDir();
    // A directory where the file should be makes the read fail with EISDIR.
    mkdirSync(stateFileOf(dir), { recursive: true });
    const store = makeStore(dir, 2);

    store.loadState();
    storeTurns(store, 2);
    store.resetAll();

    assert.ok(statSync(stateFileOf(dir)).isDirectory());
    cleanup();
  });
});
