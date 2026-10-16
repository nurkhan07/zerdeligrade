"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { useAction, useFieldError } from "@/lib/use-action";
import { testMetaSchema, type TestMetaInput } from "@/lib/validation/schemas";
import { createTestAction, updateTestMetaAction } from "@/server/actions/tests";

type Output = z.output<typeof testMetaSchema>;

export function TestMetaForm({
  subjects,
  value,
  testId,
  disabled,
  canHq,
  hasCenter,
}: {
  subjects: Array<{ id: string; name: string }>;
  value?: TestMetaInput;
  testId?: string;
  disabled?: boolean;
  canHq?: boolean;
  hasCenter?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { run, pending } = useAction();
  const fe = useFieldError();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<TestMetaInput, unknown, Output>({
    resolver: zodResolver(testMetaSchema),
    defaultValues: value ?? {
      title: "",
      subject_id: subjects[0]?.id ?? "",
      grade: "",
      language: locale,
      instructions: "",
      question_count: 20,
      negative_marking: false,
      negative_points: 0,
      passing_score: 0,
      time_limit_minutes: "",
      is_template: false,
      hq_template: !hasCenter && Boolean(canHq),
    },
  });
  const errors = form.formState.errors;
  const negative = useWatch({ control: form.control, name: "negative_marking" });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    if (testId) {
      const res = await run(() => updateTestMetaAction(testId, values));
      if (!res.ok) setServerError(res.error);
    } else {
      const res = await run(() => createTestAction(values), { refresh: false });
      if (res.ok && res.data) router.push(`/tests/${res.data.id}`);
      else if (!res.ok) setServerError(res.error);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <fieldset disabled={disabled} className="grid gap-5 disabled:opacity-80">
        <Field id="title" label={t.tests.fieldTitle} error={fe(errors.title?.message)}>
          <Input id="title" aria-invalid={!!errors.title} {...form.register("title")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="subject_id" label={t.tests.fieldSubject} error={fe(errors.subject_id?.message)}>
            <Select id="subject_id" {...form.register("subject_id")}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="grade" label={t.tests.fieldGrade} optional optionalText={t.common.optional} error={fe(errors.grade?.message)}>
            <Input id="grade" type="number" min={0} max={12} {...form.register("grade")} />
          </Field>
          <Field id="language" label={t.tests.fieldLanguage}>
            <Select id="language" {...form.register("language")}>
              <option value="kk">{t.common.kk}</option>
              <option value="ru">{t.common.ru}</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {!testId ? (
            <Field id="question_count" label={t.tests.fieldQuestionCount} error={fe(errors.question_count?.message)}>
              <Input id="question_count" type="number" min={1} max={120} {...form.register("question_count")} />
            </Field>
          ) : null}
          <Field id="passing_score" label={t.tests.fieldPassing} error={fe(errors.passing_score?.message)}>
            <Input id="passing_score" type="number" min={0} step="0.5" {...form.register("passing_score")} />
          </Field>
          <Field id="time_limit_minutes" label={t.tests.fieldTimeLimit} optional optionalText={t.common.optional} error={fe(errors.time_limit_minutes?.message)}>
            <Input id="time_limit_minutes" type="number" min={1} max={600} {...form.register("time_limit_minutes")} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...form.register("negative_marking")} />
            {t.tests.fieldNegative}
          </label>
          {negative ? (
            <Field id="negative_points" label={t.tests.fieldNegativePoints} error={fe(errors.negative_points?.message)} className="w-48">
              <Input id="negative_points" type="number" min={0} max={10} step="0.25" {...form.register("negative_points")} />
            </Field>
          ) : null}
        </div>
        <Field id="instructions" label={t.tests.fieldInstructions} optional optionalText={t.common.optional} error={fe(errors.instructions?.message)}>
          <Textarea id="instructions" rows={3} {...form.register("instructions")} />
        </Field>
        {!testId ? (
          <div className="flex flex-wrap gap-6">
            {hasCenter ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...form.register("is_template")} />
                {t.tests.fieldIsTemplate}
              </label>
            ) : null}
            {canHq && hasCenter ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...form.register("hq_template")} />
                {t.templates.saveAsHq}
              </label>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      <FormError message={serverError} />
      {!disabled ? (
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            {testId ? t.common.save : t.common.create}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
