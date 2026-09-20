const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

export function nfc(value: string): string {
  return value.normalize("NFC");
}

export function trimSurrounding(value: string): string {
  return value.trim();
}

export function compareKey(value: string): string {
  return trimSurrounding(nfc(value));
}

export function graphemeCount(value: string): number {
  const normalized = nfc(value);
  if (segmenter) {
    return Array.from(segmenter.segment(normalized)).length;
  }
  return Array.from(normalized).length;
}

export function isEmptyAfterTrim(value: string | null | undefined): boolean {
  return compareKey(value ?? "") === "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const NON_LATIN =
  /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

export function hasUnsupportedOperationalLanguage(text: string): boolean {
  const trimmed = trimSurrounding(text);
  if (!trimmed) return false;
  if (NON_LATIN.test(trimmed)) return true;
  return false;
}

export function sourceRefPath(lineItemGid: string, sourceKey: string, occurrenceIndex: number): string {
  const key = sourceKey.replaceAll("/", "_");
  return `lineItems/${lineItemGid}/attributes/${key}/${occurrenceIndex}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
