// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * An incremental RFC 4180 row splitter.
 *
 * The instrument list's `name` column legitimately contains commas (company
 * names such as `"Bajaj Finance, Ltd"`-shaped entries), so `split(',')` would
 * silently shift every field after the first embedded comma into the wrong
 * column. This tracks quote state across arbitrarily many `push` calls so a
 * quoted field — or an escaped `""` inside one — can straddle two network
 * chunks without being misread.
 */
export class CsvRowSplitter {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  /**
   * True right after an unresolved `"` seen while `inQuotes`. The next
   * character decides whether it was an escaped `""` or the closing quote,
   * and that next character can arrive in a later chunk.
   */
  private awaitingQuoteDecision = false;
  private sawAnyContent = false;

  /** Feeds one chunk of decoded text, returning every row it completes. */
  push(chunk: string): string[][] {
    const rows: string[][] = [];
    let i = 0;

    while (i < chunk.length) {
      let c = chunk[i]!;

      if (this.awaitingQuoteDecision) {
        this.awaitingQuoteDecision = false;
        if (c === '"') {
          this.field += '"';
          i += 1;
          continue;
        }
        // The earlier quote was the closing one — fall through and process
        // this character as ordinary (unquoted) input below.
        this.inQuotes = false;
      }

      if (this.inQuotes) {
        if (c === '"') {
          this.awaitingQuoteDecision = true;
        } else {
          this.field += c;
        }
        i += 1;
        continue;
      }

      if (c === '"' && this.field.length === 0) {
        this.inQuotes = true;
        this.sawAnyContent = true;
        i += 1;
        continue;
      }
      if (c === ',') {
        this.endField();
        i += 1;
        continue;
      }
      if (c === '\r') {
        i += 1;
        continue;
      }
      if (c === '\n') {
        this.endField();
        rows.push(this.row);
        this.row = [];
        this.sawAnyContent = false;
        i += 1;
        continue;
      }
      this.field += c;
      this.sawAnyContent = true;
      i += 1;
    }

    return rows;
  }

  /**
   * Call once the input is exhausted. A file with no trailing newline on its
   * last line would otherwise lose that line entirely.
   */
  finish(): string[][] {
    this.awaitingQuoteDecision = false;
    this.inQuotes = false;
    if (!this.sawAnyContent && this.row.length === 0 && this.field.length === 0) return [];
    this.endField();
    const row = this.row;
    this.row = [];
    this.sawAnyContent = false;
    return [row];
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
  }
}
