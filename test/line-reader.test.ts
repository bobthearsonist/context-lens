import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  readLinesSync,
  writeLinesAtomicSync,
} from "../src/server/line-reader.js";

function tempFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "context-lens-lines-"));
  return {
    file: path.join(dir, "state.jsonl"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("readLinesSync", () => {
  it("returns every line when lines and multi-byte characters straddle chunks", () => {
    const { file, cleanup } = tempFile();
    const lines = ["é🙂 first", "x".repeat(50), "", "naïve 🙂🙂", "last"];
    writeFileSync(file, `${lines.join("\n")}\n`);

    const seen: string[] = [];
    const bytes = readLinesSync(file, (l) => seen.push(l), 3);

    assert.deepEqual(
      seen,
      lines.filter((l) => l.length > 0),
    );
    assert.equal(bytes, readFileSync(file).length);
    cleanup();
  });

  it("returns a final line that has no trailing newline", () => {
    const { file, cleanup } = tempFile();
    writeFileSync(file, "one\ntwo");

    const seen: string[] = [];
    readLinesSync(file, (l) => seen.push(l), 2);

    assert.deepEqual(seen, ["one", "two"]);
    cleanup();
  });

  it("throws ENOENT for a missing file", () => {
    const { file, cleanup } = tempFile();
    assert.throws(
      () => readLinesSync(file, () => {}),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
    cleanup();
  });
});

describe("writeLinesAtomicSync", () => {
  it("replaces the file's content and leaves no temp file behind", () => {
    const { file, cleanup } = tempFile();
    writeFileSync(file, "old content\n");

    const bytes = writeLinesAtomicSync(file, ["a", "é", "c"]);

    assert.equal(readFileSync(file, "utf8"), "a\né\nc\n");
    assert.equal(bytes, Buffer.byteLength("a\né\nc\n"));
    assert.equal(existsSync(`${file}.tmp`), false);
    cleanup();
  });

  it("keeps the previous file when producing the lines fails", () => {
    const { file, cleanup } = tempFile();
    writeFileSync(file, "keep me\n");
    function* failing(): Generator<string> {
      yield "partial";
      throw new Error("boom");
    }

    assert.throws(() => writeLinesAtomicSync(file, failing()), /boom/);
    assert.equal(readFileSync(file, "utf8"), "keep me\n");
    assert.equal(existsSync(`${file}.tmp`), false);
    cleanup();
  });
});
