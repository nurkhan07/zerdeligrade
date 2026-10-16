import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import type { Dictionary } from "@/lib/i18n/config";

/**
 * Filter bar as a plain GET form: works without JavaScript, keeps filters in
 * the URL (shareable, back-button friendly).
 */
export function FilterBar({ children, t, resetHref }: { children: ReactNode; t: Dictionary; resetHref: string }) {
  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4">
      {children}
      <div className="flex gap-2">
        <Button type="submit" size="md">
          {t.common.apply}
        </Button>
        <Button asChild variant="secondary">
          <a href={resetHref}>{t.common.reset}</a>
        </Button>
      </div>
    </form>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel?: string;
}) {
  const id = `f-${name}`;
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted">
        {label}
      </Label>
      <select id={id} name={name} defaultValue={value} className="h-10 rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm">
        {allLabel !== undefined ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterInput({ name, label, value, type = "text", placeholder }: { name: string; label: string; value: string; type?: string; placeholder?: string }) {
  const id = `f-${name}`;
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted">
        {label}
      </Label>
      <input id={id} name={name} type={type} defaultValue={value} placeholder={placeholder} className="h-10 rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm" />
    </div>
  );
}
