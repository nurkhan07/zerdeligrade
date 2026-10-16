"use client";
import { AlertTriangle, Ban, CheckCircle2, Printer, RotateCcw, Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, RESULT_STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Notice } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { scoreAnswers } from "@/lib/grading/score";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import type { OptionLabel } from "@/lib/omr/layout";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { finalizeResultAction, reopenResultAction, reviewResultAction, voidResultAction } from "@/server/actions/results";

export interface ReviewQuestion {
  position: number;
  optionCount: number;
  points: number;
  correct: OptionLabel;
  recognized: OptionLabel | null;
  selected: OptionLabel | null;
  recognitionStatus: "ok" | "blank" | "multiple" | "uncertain" | null;
  confidence: number | null;
  fill: Partial<Record<OptionLabel, number>>;
}

export interface ReviewProps {
  resultId: string;
  status: string;
  openWarnings: number;
  sheetWarnings: Array<{ code: string; blocking: boolean }>;
  studentId: string | null;
  students: Array<{ id: string; name: string }>;
  questions: ReviewQuestion[];
  rules: { negativeMarking: boolean; negativePoints: number; passingScore: number };
  stored: { score: number; maxScore: number; percentage: number; passed: boolean; correct: number; incorrect: number; blank: number };
  canFinalize: boolean;
  canReopen: boolean;
  /** Whether this user may void the result now (see public.void_result). */
  canVoid: boolean;
  voidInfo: { at: string; reason: string } | null;
  photoUrl: string | null;
}

const LETTERS: OptionLabel[] = ["A", "B", "C", "D", "E"];

export function ResultReview(p: ReviewProps) {
  const { t, locale } = useI18n();
  const { run, pending } = useAction();
  const finalized = p.status === "finalized";
  const voided = p.status === "voided";
  const readOnly = finalized || voided;
  const [voidReason, setVoidReason] = useState("");
  const [answers, setAnswers] = useState<Record<number, OptionLabel | null>>(() => Object.fromEntries(p.questions.map((q) => [q.position, q.selected])));
  const [studentId, setStudentId] = useState(p.studentId ?? "");
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(p.openWarnings > 0);

  const changed = useMemo(() => p.questions.filter((q) => answers[q.position] !== q.selected), [answers, p.questions]);
  const preview = useMemo(
    () => scoreAnswers(p.questions.map((q) => ({ position: q.position, points: q.points, correct: q.correct })), p.rules, answers),
    [answers, p.questions, p.rules],
  );
  const dirty = changed.length > 0 || (studentId || null) !== p.studentId;
  const needsReview = p.status === "needs_review" && p.openWarnings > 0;
  const flagged = (q: ReviewQuestion) => q.recognitionStatus === "multiple" || q.recognitionStatus === "uncertain";
  const visible = onlyFlagged ? p.questions.filter((q) => flagged(q) || q.recognitionStatus === "blank") : p.questions;

  async function save() {
    const diff: Record<string, OptionLabel | null> = {};
    for (const q of changed) diff[String(q.position)] = answers[q.position] ?? null;
    await run(() => reviewResultAction(p.resultId, diff, studentId || null, comment));
    setComment("");
  }

  const statusLabel = t.results[`status_${p.status}` as "status_finalized"];
  const warningText = (code: string) => (t.warnings as Record<string, string>)[code] ?? code;

  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-sm text-muted">{t.common.status}</p>
              <Badge tone={RESULT_STATUS_TONE[p.status]} className="mt-1">
                {statusLabel}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted">{t.results.score}</p>
              <p className="tabular text-xl font-semibold">
                {formatNumber(p.stored.score, locale, 2)} / {formatNumber(p.stored.maxScore, locale, 2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">{t.results.percentage}</p>
              <p className="tabular text-xl font-semibold">{formatPercent(p.stored.percentage, locale)}</p>
            </div>
            <div>
              <p className="text-sm text-muted">
                {t.results.correctCount} / {t.results.incorrectCount} / {t.results.blankCount}
              </p>
              <p className="tabular text-xl font-semibold">
                {p.stored.correct} / {p.stored.incorrect} / {p.stored.blank}
              </p>
              <Badge tone={p.stored.passed ? "success" : "danger"} className="mt-1">
                {p.stored.passed ? t.results.passed : t.results.notPassed}
              </Badge>
            </div>
          </CardBody>
        </Card>

        {voided && p.voidInfo ? (
          <Notice tone="danger">
            <div className="flex items-start gap-2">
              <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{fmt(t.results.voidedBanner, { date: formatDateTime(p.voidInfo.at, locale), reason: p.voidInfo.reason })}</p>
            </div>
          </Notice>
        ) : null}

        {!voided && (needsReview || p.sheetWarnings.length) ? (
          <Notice tone="warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                {needsReview ? <p className="font-medium">{t.results.mustReviewFirst}</p> : null}
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {p.sheetWarnings.map((w, i) => (
                    <li key={i}>
                      <Badge tone={w.blocking ? "warning" : "neutral"}>{warningText(w.code)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Notice>
        ) : null}

        <Card>
          <CardHeader
            title={t.results.byQuestion}
            actions={
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
                {t.results.warnings}
              </label>
            }
          />
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">{t.results.recognized}</th>
                  <th className="px-4 py-2">{t.results.selected}</th>
                  <th className="px-4 py-2">{t.results.correct}</th>
                  <th className="px-4 py-2 text-right">{t.tests.pointsCol}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q) => {
                  const sel = answers[q.position] ?? null;
                  const isCorrect = sel !== null && sel === q.correct;
                  const pq = preview.perQuestion.find((x) => x.position === q.position);
                  return (
                    <tr key={q.position} className={cn("border-b border-line last:border-0", flagged(q) && "bg-warning-soft/60")}>
                      <td className="tabular px-4 py-2 font-semibold">{q.position}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-end gap-1" aria-label={t.results.fill}>
                            {LETTERS.slice(0, q.optionCount).map((l) => {
                              const v = q.fill[l] ?? 0;
                              return (
                                <div key={l} className="flex flex-col items-center gap-0.5" title={`${l}: ${Math.round(v * 100)}%`}>
                                  <div className="relative h-6 w-3 overflow-hidden rounded-sm bg-surface">
                                    <div className="absolute bottom-0 w-full bg-ink/70" style={{ height: `${Math.round(v * 100)}%` }} />
                                  </div>
                                  <span className="text-[10px] text-muted">{l}</span>
                                </div>
                              );
                            })}
                          </div>
                          {q.recognitionStatus && q.recognitionStatus !== "ok" ? (
                            <Badge tone={flagged(q) ? "warning" : "neutral"}>{warningText(q.recognitionStatus)}</Badge>
                          ) : null}
                          {q.confidence !== null ? (
                            <span className="text-xs text-muted">
                              {t.results.confidence}: {Math.round(q.confidence * 100)}%
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div role="radiogroup" aria-label={`${t.common.question} ${q.position}`} className="flex flex-wrap items-center gap-1">
                          {LETTERS.slice(0, q.optionCount).map((l) => {
                            const active = sel === l;
                            return (
                              <button
                                key={l}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                disabled={readOnly}
                                onClick={() => setAnswers((a) => ({ ...a, [q.position]: active ? null : l }))}
                                className={cn(
                                  "grid size-8 place-items-center rounded-full border text-xs font-semibold transition-colors",
                                  active ? (isCorrect ? "border-success bg-success text-white" : "border-danger bg-danger text-white") : "border-line bg-white hover:border-ink",
                                  q.recognized === l && !active && "ring-2 ring-ink/20",
                                )}
                              >
                                {l}
                              </button>
                            );
                          })}
                          {sel === null ? <span className="ml-1 text-xs text-muted">{t.results.blankOption}</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono font-semibold">{q.correct}</td>
                      <td className="tabular px-4 py-2 text-right">
                        {isCorrect ? <CheckCircle2 className="mr-1 inline size-4 text-success" aria-hidden /> : null}
                        {formatNumber(pq?.points ?? 0, locale, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={t.results.previewScore} description={t.results.previewNote} />
          <CardBody className="flex flex-col gap-4">
            <p className="tabular text-2xl font-semibold">
              {formatNumber(preview.score, locale, 2)} / {formatNumber(preview.maxScore, locale, 2)}
              <span className="ml-2 text-base font-normal text-muted">{formatPercent(preview.percentage, locale)}</span>
            </p>
            <Field id="link-student" label={t.results.linkStudent} hint={p.studentId ? undefined : t.results.linkStudentHelp}>
              <Select id="link-student" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={readOnly}>
                <option value="">{t.results.noStudent}</option>
                {p.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {voided ? null : !finalized ? (
              <>
                <Field id="review-comment" label={t.common.comment} optional optionalText={t.common.optional}>
                  <Textarea id="review-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={save} loading={pending} disabled={!studentId || (!dirty && !needsReview && p.status !== "needs_review")}>
                    <Save /> {t.results.saveReview}
                  </Button>
                  {p.canFinalize ? (
                    <ConfirmDialog
                      title={t.results.finalizeTitle}
                      description={t.results.finalizeText}
                      confirmLabel={t.results.finalize}
                      cancelLabel={t.common.cancel}
                      onConfirm={async () => {
                        await run(() => finalizeResultAction(p.resultId, comment));
                      }}
                      trigger={
                        <Button variant="accent" disabled={dirty || needsReview || !p.studentId}>
                          <ShieldCheck /> {t.results.finalize}
                        </Button>
                      }
                    />
                  ) : null}
                </div>
                {dirty ? <p className="text-xs text-muted">{t.results.previewNote}</p> : null}
              </>
            ) : p.canReopen ? (
              <ConfirmDialog
                title={t.results.reopenTitle}
                description={t.results.finalizeText}
                confirmLabel={t.results.reopen}
                cancelLabel={t.common.cancel}
                onConfirm={async () => {
                  const res = await run(() => reopenResultAction(p.resultId, reason));
                  if (res.ok) setReason("");
                  return res.ok;
                }}
                trigger={
                  <Button variant="secondary">
                    <RotateCcw /> {t.results.reopen}
                  </Button>
                }
              >
                <Field id="reopen-reason" label={t.results.reopenReason}>
                  <Textarea id="reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                </Field>
              </ConfirmDialog>
            ) : null}
            {p.canVoid ? (
              <ConfirmDialog
                danger
                title={t.results.voidTitle}
                description={t.results.voidText}
                confirmLabel={t.results.void}
                cancelLabel={t.common.cancel}
                onConfirm={async () => {
                  const res = await run(() => voidResultAction(p.resultId, voidReason));
                  if (res.ok) setVoidReason("");
                  return res.ok;
                }}
                trigger={
                  <Button variant="ghost" className="self-start text-danger hover:bg-danger-soft">
                    <Ban /> {t.results.void}
                  </Button>
                }
              >
                <Field id="void-reason" label={t.results.voidReason} hint={t.results.voidReasonHint}>
                  <Textarea id="void-reason" rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={1000} />
                </Field>
              </ConfirmDialog>
            ) : finalized && !voided ? (
              <p className="text-xs text-muted">{t.results.voidAdminOnly}</p>
            ) : null}
            <Button asChild variant="ghost" className="self-start">
              <Link href={`/print/results/${p.resultId}`} target="_blank">
                <Printer /> {t.results.printReport}
              </Link>
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.results.photo} />
          <CardBody>
            {p.photoUrl ? (
              <a href={p.photoUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, short-lived signed URL */}
                <img src={p.photoUrl} alt={t.results.photo} className="w-full rounded-[var(--radius-control)] border border-line" />
              </a>
            ) : (
              <p className="text-sm text-muted">{t.results.photoUnavailable}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
