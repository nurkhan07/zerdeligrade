import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface text-muted border-line",
  info: "bg-primary-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  brand: "bg-brand-soft text-brand-dark border-brand/20",
  accent: "bg-accent-soft text-ink border-accent/50",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export const RESULT_STATUS_TONE: Record<string, Tone> = {
  uploaded: "neutral",
  processing: "info",
  needs_review: "warning",
  reviewed: "brand",
  finalized: "success",
  failed: "danger",
  voided: "neutral",
};

export const TEST_STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
};
