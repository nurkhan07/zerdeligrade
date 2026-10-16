"use client";
import { FileDown, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction } from "@/lib/use-action";
import { generateSheetsAction } from "@/server/actions/sheets";

interface Props {
  tests: Array<{ id: string; title: string; language: "kk" | "ru"; question_count: number }>;
  classes: Array<{ id: string; name: string }>;
  students: Array<{ id: string; name: string; class_id: string | null }>;
  initialTest?: string;
}

export function SheetGenerator({ tests, classes, students, initialTest }: Props) {
  const { t, locale } = useI18n();
  const { run, pending } = useAction();
  const [testId, setTestId] = useState(initialTest && tests.some((x) => x.id === initialTest) ? initialTest : (tests[0]?.id ?? ""));
  const test = tests.find((x) => x.id === testId);
  const [language, setLanguage] = useState<"kk" | "ru">(test?.language ?? locale);
  const [mode, setMode] = useState<"class" | "student" | "blank">("class");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
  const [count, setCount] = useState(10);
  const [paperSize, setPaperSize] = useState<"a4" | "a5">("a4");
  const a5Allowed = (test?.question_count ?? 0) <= 40;
  const paper = a5Allowed ? paperSize : "a4";
  const [batch, setBatch] = useState<{ id: string; count: number } | null>(null);
  const classStudents = useMemo(() => students.filter((s) => !classId || s.class_id === classId), [students, classId]);

  if (!tests.length) return <Notice>{t.sheets.onlyPublished}</Notice>;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="sheet-test" label={t.sheets.chooseTest}>
          <Select
            id="sheet-test"
            value={testId}
            onChange={(e) => {
              setTestId(e.target.value);
              const nt = tests.find((x) => x.id === e.target.value);
              if (nt) setLanguage(nt.language);
              setBatch(null);
            }}
          >
            {tests.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} ({x.question_count} {t.common.questionsShort})
              </option>
            ))}
          </Select>
        </Field>
        <Field id="sheet-lang" label={t.sheets.language}>
          <Select id="sheet-lang" value={language} onChange={(e) => setLanguage(e.target.value as "kk" | "ru")}>
            <option value="kk">{t.common.kk}</option>
            <option value="ru">{t.common.ru}</option>
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.sheets.paper}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="paper" checked={paper === "a4"} onChange={() => setPaperSize("a4")} className="accent-primary" />
          {t.sheets.paperA4}
        </label>
        <label className={`flex items-center gap-2 text-sm ${a5Allowed ? "" : "text-muted"}`}>
          <input type="radio" name="paper" disabled={!a5Allowed} checked={paper === "a5"} onChange={() => setPaperSize("a5")} className="accent-primary" />
          {t.sheets.paperA5}
        </label>
        {!a5Allowed ? <p className="text-xs text-muted">{t.sheets.a5TooMany}</p> : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.sheets.mode}</legend>
        {(
          [
            ["class", t.sheets.modeClass],
            ["student", t.sheets.modeStudent],
            ["blank", t.sheets.modeBlank],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="accent-primary" />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="sheet-class" label={t.sheets.class} optional={mode === "blank"} optionalText={t.common.optional}>
          <Select id="sheet-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {mode !== "class" ? <option value="">{t.common.all}</option> : null}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "student" ? (
          <Field id="sheet-student" label={t.sheets.student}>
            <Select id="sheet-student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">{t.common.select}</option>
              {classStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {mode === "blank" ? (
          <Field id="sheet-count" label={t.sheets.count}>
            <Input id="sheet-count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
        ) : null}
      </div>

      <p className="text-sm text-muted">{t.sheets.questionsNote}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          loading={pending}
          disabled={!testId || (mode === "class" && !classId) || (mode === "student" && !studentId)}
          onClick={async () => {
            const res = await run(() =>
              generateSheetsAction({ testId, language, mode, classId: classId || null, studentId: studentId || null, count, paperSize: paper }),
            );
            if (res.ok && res.data) setBatch({ id: res.data.batchId, count: res.data.count });
          }}
        >
          {pending ? t.sheets.generating : t.sheets.generate}
        </Button>
        {batch ? (
          <>
            <Button asChild variant="accent">
              <a href={`/print/answer-sheets?batch=${batch.id}`} target="_blank" rel="noopener">
                <Printer /> {t.sheets.printBatch}
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={`/api/answer-sheets/pdf?batch=${batch.id}`}>
                <FileDown /> {t.sheets.downloadPdf}
              </a>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
