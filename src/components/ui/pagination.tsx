import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmt, type Dictionary } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** Link-based pagination that preserves the other search params. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
  t,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
  t: Dictionary;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const link = "inline-flex h-9 items-center gap-1 rounded-full border border-line bg-white px-3 text-sm hover:bg-surface";
  return (
    <nav aria-label="pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>{fmt(t.common.shownOf, { count: Math.min(total, Math.max(0, total - (page - 1) * pageSize), pageSize), total })}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={link} href={href(page - 1)} rel="prev">
            <ChevronLeft className="size-4" aria-hidden />
            {t.common.previous}
          </Link>
        ) : null}
        <span className="tabular px-2">{fmt(t.common.pageOf, { page, pages })}</span>
        {page < pages ? (
          <Link className={cn(link)} href={href(page + 1)} rel="next">
            {t.common.next}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
