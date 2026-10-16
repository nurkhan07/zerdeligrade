import { str, uuidParam } from "@/lib/utils";

export const RESULT_FILTER_STATUSES = ["needs_review", "reviewed", "finalized", "failed", "voided"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared filter parsing for the list and the CSV export. */
export function parseResultFilters(sp: Record<string, string | string[] | undefined>) {
  const status = (RESULT_FILTER_STATUSES as readonly string[]).includes(str(sp.status)) ? str(sp.status) : "";
  return {
    status,
    classId: uuidParam(sp.class),
    subject: uuidParam(sp.subject),
    test: uuidParam(sp.test),
    from: DATE_RE.test(str(sp.from)) ? str(sp.from) : "",
    to: DATE_RE.test(str(sp.to)) ? str(sp.to) : "",
  };
}

