import fs from "node:fs";

const NEWLINE = 0x0a;

/**
 * Read a file line by line, synchronously, without ever holding the whole file
 * in one string. `fs.readFileSync(path, "utf8")` fails once a file passes V8's
 * maximum string length (~512 MB), and long-running state files get there.
 *
 * Lines are split on the raw newline byte before decoding, so a multi-byte
 * UTF-8 character that straddles two read chunks is never cut in half.
 * Empty lines are skipped. Errors from open/read propagate to the caller.
 */
export function readLinesSync(
  filePath: string,
  onLine: (line: string) => void,
  chunkSize = 8 * 1024 * 1024,
): number {
  const fd = fs.openSync(filePath, "r");
  let bytesRead = 0;
  try {
    const chunk = Buffer.allocUnsafe(chunkSize);
    let carry: Buffer | null = null;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunkSize, null);
      if (n === 0) break;
      bytesRead += n;
      const data: Buffer = carry
        ? Buffer.concat([carry, chunk.subarray(0, n)])
        : chunk.subarray(0, n);
      let start = 0;
      let nl = data.indexOf(NEWLINE, start);
      while (nl !== -1) {
        if (nl > start) onLine(data.toString("utf8", start, nl));
        start = nl + 1;
        nl = data.indexOf(NEWLINE, start);
      }
      // Copy the partial tail: `chunk` is reused by the next read.
      carry = start < data.length ? Buffer.from(data.subarray(start)) : null;
    }
    if (carry && carry.length > 0) onLine(carry.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
  return bytesRead;
}

/**
 * Write lines to `filePath` atomically: stream them into a sibling temp file,
 * then rename it over the target. A crash or a full disk mid-write leaves the
 * previous file intact instead of a truncated one. Returns bytes written.
 */
export function writeLinesAtomicSync(
  filePath: string,
  lines: Iterable<string>,
): number {
  const tmpPath = `${filePath}.tmp`;
  const fd = fs.openSync(tmpPath, "w");
  let bytesWritten = 0;
  try {
    // Batch small lines into ~1 MB writes to keep syscalls down on slow mounts.
    let batch: string[] = [];
    let batchLength = 0;
    const flush = () => {
      if (batch.length === 0) return;
      bytesWritten += fs.writeSync(fd, batch.join(""));
      batch = [];
      batchLength = 0;
    };
    for (const line of lines) {
      batch.push(line, "\n");
      batchLength += line.length + 1;
      if (batchLength >= 1024 * 1024) flush();
    }
    flush();
  } catch (err) {
    fs.closeSync(fd);
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return bytesWritten;
}
