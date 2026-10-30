import type { ParsedMessage } from "../types.js";

/**
 * Identity of a compacted message for comparing one turn's capture with the
 * next. Token counts are left out because they are rescaled per turn to match
 * API usage, and `cache_control` markers because clients move them to the
 * newest message on every request. Plain string content and a single text
 * block compare equal, since clients send the same message in either form.
 */
export function messageSignature(m: ParsedMessage): string {
  const blocks = m.contentBlocks?.length
    ? m.contentBlocks
    : m.content
      ? [{ type: "text", text: m.content }]
      : [];
  return JSON.stringify([m.role, blocks], (key, value) =>
    key === "cache_control" ? undefined : value,
  );
}

/**
 * Indexes of the messages in `current` that were not in `previous`, compared
 * as multisets so a message that genuinely repeats still counts as new.
 *
 * Membership rather than position: clients drop or rewrite per-turn messages
 * (trailing system reminders, hook output) before the next request, so the
 * previous window rarely lines up with the start of the current one.
 */
export function newMessageIndexes(
  previous: readonly string[],
  current: readonly string[],
): number[] {
  const remaining = new Map<string, number>();
  for (const s of previous) remaining.set(s, (remaining.get(s) ?? 0) + 1);
  const fresh: number[] = [];
  current.forEach((s, i) => {
    const left = remaining.get(s) ?? 0;
    if (left > 0) remaining.set(s, left - 1);
    else fresh.push(i);
  });
  return fresh;
}
