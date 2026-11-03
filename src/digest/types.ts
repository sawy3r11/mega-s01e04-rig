export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner of the latest event; an absent or null owner becomes null. */
  owner: string | null;
  /** Number of valid events for this job, including retries and failures. */
  runs: number;
  /** Number of events whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Latest provided error, retained after later events without an error. */
  lastError: string | null;
  /** Original timestamp strings, with their logged offsets preserved. */
  firstAt: string;
  lastAt: string;
  /** True if any event failed, even if a later event succeeded. */
  hasFailed: boolean;
};

export type DigestResult = {
  night: string;
  /** One row per job, sorted by job using ascending string comparison. */
  rows: DigestRow[];
  invalidLines: number;
  /** Event counts, not job counts; invalid lines are excluded. */
  totals: Record<RunStatus, number>;
};

/**
 * Contract for the synchronous readNight(runsDir, night) implementation.
 *
 * Read runsDir/<night>.jsonl. A night must match YYYY-MM-DD; reject other
 * identifiers without reading a path. Return null for an invalid identifier or
 * a missing file (ENOENT). Other filesystem errors propagate.
 *
 * Ignore blank lines. Count each malformed JSON or structurally invalid line
 * once in invalidLines and continue. A valid event is an object with a nonempty
 * job string, an ISO timestamp at with an explicit offset or Z, and a RunStatus.
 * owner and error may be absent, null, or strings; other values are invalid.
 * Missing/null owners normalize to null. Missing/null errors do not replace
 * lastError; if no event provides an error string, lastError is null.
 *
 * Order events by timestamp instant, breaking ties by their order in the file
 * (later line wins). firstAt/lastAt retain the original timestamp strings;
 * lastStatus and owner come from the latest event. lastError comes from the
 * latest event that provides an error string, using the same ordering.
 *
 * An existing empty file returns rows: [], invalidLines: 0, and all totals 0.
 * A file containing only invalid lines also has empty rows and zero totals,
 * but retains its invalidLines count. Never mutate the run log.
 */
export type ReadNight = (runsDir: string, night: string) => DigestResult | null;
