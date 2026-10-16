"use client";
import { Keyboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Select } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { createManualResultAction } from "@/server/actions/results";

type L = "A" | "B" | "C" | "D" | "E";
const LETTERS: L[] = ["A", "B", "C", "D", "E"];

export function ManualEntryDialog({
  tests,
  students,
}: {
  tests: Array<{ id: string; title: string; optionCounts: number[] }>;
  students: Array<{ id: string; name: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [testId, setTestId] = useState(tests[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
  const [answers, setAnswers] = useState<Record<string, L | null>>({});
  const [error, setError] = useState<string | null>(null);
  const test = tests.find((x) => x.id === testId);

  return (
    <Dialog
      wide
      open={open}
      onOpenChange={setOpen}
      closeLabel={t.common.close}
      title={t.scan.manualTitle}
      description={t.scan.manualHelp}
      trigger={
        <Button variant="secondary" disabled={!tests.length}>
          <Keyboard /> {t.scan.manualEntry}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="m-test" label={t.common.test}>
            <Select
              id="m-test"
              value={testId}
              onChange={(e) => {
                setTestId(e.target.value);
                setAnswers({});
              }}
            >
              {tests.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="m-student" label={t.common.student}>
            <Select id="m-student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">{t.common.select}</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {test ? (
          <div className="grid max-h-[50vh] grid-cols-1 gap-x-6 gap-y-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {test.optionCounts.map((n, i) => {
              const pos = String(i + 1);
              return (
                <div key={pos} role="radiogroup" aria-label={`${t.common.question} ${pos}`} className="flex items-center gap-2 py-1">
                  <span className="tabular w-7 text-right text-sm font-semibold">{pos}</span>
                  {LETTERS.slice(0, n).map((l) => {
                    const active = answers[pos] === l;
                    return (
                      <button
                        key={l}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setAnswers((p) => ({ ...p, [pos]: active ? null : l }))}
                        className={cn(
                          "grid size-7 place-items-center rounded-full border text-xs font-semibold",
                          active ? "border-ink bg-ink text-white" : "border-line hover:border-ink",
                        )}
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
          <Button
            loading={pending}
            disabled={!testId || !studentId}
            onClick={async () => {
              setError(null);
              const res = await run(() => createManualResultAction(testId, studentId, answers), { refresh: false });
              if (res.ok && res.data) router.push(`/results/${res.data.id}`);
              else if (!res.ok) setError(res.error);
            }}
          >
            {t.common.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
