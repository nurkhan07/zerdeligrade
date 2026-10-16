"use client";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Notice } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/form";
import { fmt } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { LABELS, type QuestionInput } from "@/lib/validation/schemas";
import { saveQuestionsAction } from "@/server/actions/tests";

type Label = (typeof LABELS)[number];

export interface EditorQuestion {
  position: number;
  type: "single_choice" | "true_false";
  option_count: number;
  prompt: string;
  points: number;
  correct: Label | null;
  options: string[];
}

function blank(position: number, optionCount = 5): EditorQuestion {
  return { position, type: "single_choice", option_count: optionCount, prompt: "", points: 1, correct: null, options: [] };
}

export function QuestionsEditor({ testId, initial, locked }: { testId: string; initial: EditorQuestion[]; locked: boolean }) {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const [items, setItems] = useState<EditorQuestion[]>(initial.length ? initial : [blank(1)]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [quickKey, setQuickKey] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const update = (i: number, patch: Partial<EditorQuestion>) => {
    setItems((prev) => prev.map((q, k) => (k === i ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const countFor = (q: EditorQuestion) => (q.type === "true_false" ? 2 : q.option_count);
  const maxScore = useMemo(() => items.reduce((s, q) => s + (Number(q.points) || 0), 0), [items]);
  const missing = items.map((q, i) => (q.correct ? null : i + 1)).filter((x): x is number => x !== null);

  function applyQuickKey() {
    const letters = quickKey.toUpperCase().replace(/[^A-Z]/g, "").split("");
    setQuickError(null);
    const next = [...items];
    for (let i = 0; i < letters.length && i < next.length; i++) {
      const q = next[i]!;
      const allowed = LABELS.slice(0, countFor(q)) as readonly string[];
      if (!allowed.includes(letters[i]!)) {
        setQuickError(fmt(t.tests.quickKeyInvalid, { position: i + 1 }));
        return;
      }
      next[i] = { ...q, correct: letters[i] as Label };
    }
    setItems(next);
    setDirty(true);
  }

  async function save() {
    const payload: QuestionInput[] = items.map((q, i) => ({
      position: i + 1,
      type: q.type,
      option_count: countFor(q),
      prompt: q.prompt,
      points: Number(q.points),
      correct: q.correct,
      options: q.options.slice(0, countFor(q)),
    }));
    const res = await run(() => saveQuestionsAction(testId, payload));
    if (res.ok) setDirty(false);
  }

  return (
    <Card>
      <CardHeader
        title={t.tests.questionsTitle}
        description={locked ? undefined : t.tests.questionsHelp}
        actions={
          <span className="tabular text-sm text-muted">
            {t.tests.questions}: {items.length} · {t.tests.maxScore}: {maxScore}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {locked ? <Notice tone="info">{t.tests.lockedNotice}</Notice> : null}
        {!locked ? (
          <div className="grid gap-2 rounded-[var(--radius-control)] bg-surface p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="quick-key" className="text-sm font-medium">
                {t.tests.quickKey}
              </label>
              <p className="mb-2 text-xs text-muted">{t.tests.quickKeyHelp}</p>
              <Input id="quick-key" value={quickKey} onChange={(e) => setQuickKey(e.target.value)} placeholder="ABCDE ABCDE" className="font-mono uppercase" />
              {quickError ? (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {quickError}
                </p>
              ) : null}
            </div>
            <Button variant="secondary" onClick={applyQuickKey} disabled={!quickKey.trim()}>
              {t.tests.quickKeyApply}
            </Button>
          </div>
        ) : null}

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 py-2">#</th>
                <th className="py-2">{t.tests.type}</th>
                <th className="py-2">{t.tests.options}</th>
                <th className="py-2">{t.tests.correct}</th>
                <th className="w-24 py-2">{t.tests.pointsCol}</th>
                <th className="w-10 py-2">
                  <span className="sr-only">{t.tests.prompt}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((q, i) => (
                <QuestionRow
                  key={i}
                  index={i}
                  q={q}
                  locked={locked}
                  expanded={expanded === i}
                  onToggle={() => setExpanded(expanded === i ? null : i)}
                  onChange={(patch) => update(i, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {!locked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={items.length >= 120}
                onClick={() => {
                  setItems((p) => [...p, blank(p.length + 1, p.at(-1)?.option_count ?? 5)]);
                  setDirty(true);
                }}
              >
                <Plus /> {t.common.add}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={items.length <= 1}
                onClick={() => {
                  setItems((p) => p.slice(0, -1));
                  setDirty(true);
                }}
              >
                <Minus /> {t.common.delete}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {missing.length ? (
                <span className="text-sm text-warning">{fmt(t.tests.missingKeys, { list: missing.slice(0, 15).join(", ") + (missing.length > 15 ? "…" : "") })}</span>
              ) : null}
              <Button onClick={save} loading={pending} disabled={!dirty}>
                {t.tests.saveQuestions}
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function QuestionRow({
  index,
  q,
  locked,
  expanded,
  onToggle,
  onChange,
}: {
  index: number;
  q: EditorQuestion;
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<EditorQuestion>) => void;
}) {
  const { t } = useI18n();
  const count = q.type === "true_false" ? 2 : q.option_count;
  const labels = LABELS.slice(0, count);
  return (
    <>
      <tr className="border-t border-line">
        <td className="tabular py-2 font-semibold">{index + 1}</td>
        <td className="py-2 pr-2">
          <select
            aria-label={`${t.tests.type} ${index + 1}`}
            disabled={locked}
            value={q.type}
            onChange={(e) => {
              const type = e.target.value as EditorQuestion["type"];
              onChange({ type, correct: type === "true_false" && q.correct && !["A", "B"].includes(q.correct) ? null : q.correct });
            }}
            className="h-9 rounded-[var(--radius-control)] border border-line bg-white px-2"
          >
            <option value="single_choice">{t.tests.typeSingle}</option>
            <option value="true_false">{t.tests.typeTrueFalse}</option>
          </select>
        </td>
        <td className="py-2 pr-2">
          <select
            aria-label={`${t.tests.options} ${index + 1}`}
            disabled={locked || q.type === "true_false"}
            value={count}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({ option_count: n, correct: q.correct && LABELS.indexOf(q.correct) >= n ? null : q.correct });
            }}
            className="h-9 rounded-[var(--radius-control)] border border-line bg-white px-2"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2 pr-2">
          <div role="radiogroup" aria-label={`${t.tests.correct} ${index + 1}`} className="flex gap-1.5">
            {labels.map((l) => {
              const active = q.correct === l;
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  title={q.type === "true_false" ? (l === "A" ? t.tests.trueLabel : t.tests.falseLabel) : l}
                  onClick={() => onChange({ correct: active ? null : l })}
                  className={cn(
                    "grid size-8 place-items-center rounded-full border text-xs font-semibold transition-colors",
                    active ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:border-primary",
                    locked && "cursor-default",
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </td>
        <td className="py-2 pr-2">
          <Input
            aria-label={`${t.tests.pointsCol} ${index + 1}`}
            type="number"
            min={0.5}
            max={100}
            step="0.5"
            disabled={locked}
            value={q.points}
            onChange={(e) => onChange({ points: Number(e.target.value) })}
            className="h-9 w-20"
          />
        </td>
        <td className="py-2">
          <Button variant="ghost" size="icon" aria-expanded={expanded} aria-label={t.tests.prompt} onClick={onToggle}>
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td />
          <td colSpan={5} className="pb-3">
            <div className="grid gap-2">
              <Textarea
                aria-label={t.tests.prompt}
                placeholder={`${t.tests.prompt} (${t.common.optional})`}
                disabled={locked}
                rows={2}
                value={q.prompt}
                onChange={(e) => onChange({ prompt: e.target.value })}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {labels.map((l, k) => (
                  <Input
                    key={l}
                    aria-label={`${l}`}
                    placeholder={q.type === "true_false" ? (l === "A" ? t.tests.trueLabel : t.tests.falseLabel) : `${l}`}
                    disabled={locked}
                    value={q.options[k] ?? ""}
                    onChange={(e) => {
                      const options = [...q.options];
                      options[k] = e.target.value;
                      onChange({ options });
                    }}
                  />
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
