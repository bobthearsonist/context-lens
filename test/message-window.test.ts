import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  messageSignature,
  newMessageIndexes,
} from "../src/server/message-window.js";
import type { ParsedMessage } from "../src/types.js";

const msg = (content: string, tokens = 1): ParsedMessage => ({
  role: "user",
  content,
  tokens,
});
const sigs = (...contents: string[]) =>
  contents.map((c) => messageSignature(msg(c)));

describe("newMessageIndexes", () => {
  it("returns the messages added when the window slides", () => {
    assert.deepEqual(
      newMessageIndexes(sigs("a", "b", "c"), sigs("b", "c", "d")),
      [2],
    );
  });

  it("returns the messages added when the window grows", () => {
    assert.deepEqual(
      newMessageIndexes(sigs("a", "b"), sigs("a", "b", "c", "d")),
      [2, 3],
    );
  });

  it("ignores a previous turn's message that was dropped before this request", () => {
    // A per-turn reminder ("r1") ends the previous request and is gone from this one.
    assert.deepEqual(
      newMessageIndexes(sigs("a", "b", "r1"), sigs("a", "b", "c", "r2")),
      [2, 3],
    );
  });

  it("counts a genuinely repeated message as new", () => {
    assert.deepEqual(
      newMessageIndexes(sigs("a", "ok"), sigs("a", "ok", "ok")),
      [2],
    );
  });

  it("returns nothing for a repeated request and everything for an unrelated one", () => {
    assert.deepEqual(newMessageIndexes(sigs("a", "b"), sigs("a", "b")), []);
    assert.deepEqual(newMessageIndexes(sigs("a", "b"), sigs("x", "y")), [0, 1]);
  });
});

describe("messageSignature", () => {
  it("ignores token counts, which are rescaled per turn", () => {
    assert.equal(messageSignature(msg("a", 5)), messageSignature(msg("a", 9)));
  });

  it("ignores cache_control markers, which move between turns", () => {
    const block = { type: "thinking", thinking: "t" };
    const withMarker: ParsedMessage = {
      ...msg(""),
      contentBlocks: [
        { ...block, cache_control: { type: "ephemeral" } } as any,
      ],
    };
    const without: ParsedMessage = {
      ...msg(""),
      contentBlocks: [block as any],
    };
    assert.equal(messageSignature(withMarker), messageSignature(without));
  });

  it("treats string content and a single text block as the same message", () => {
    const asBlock: ParsedMessage = {
      ...msg(""),
      contentBlocks: [{ type: "text", text: "hello" }],
    };
    assert.equal(messageSignature(msg("hello")), messageSignature(asBlock));
  });

  it("distinguishes messages with different content", () => {
    assert.notEqual(messageSignature(msg("a")), messageSignature(msg("b")));
  });
});
