import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionsEditor, type EditorQuestion } from "@/components/tests/questions-editor";
import { TestActions, TestAssignments } from "@/components/tests/test-actions";
import { TestMetaForm } from "@/components/tests/test-meta-form";
import { Badge, TEST_STATUS_TONE } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/context";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import type { LABELS } from "@/lib/validation/schemas";
import { getClasses, getSubjects, subjectName, type TestRow } from "@/server/queries";

const STATUS_KEY = { draft: "statusDraft", published: "statusPublished", archived: "statusArchived" } as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tests.editTitle };
}

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("tests");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, locale } = await getI18n();
  const supabase = await createClient();

  const [{ data: test }, { data: questions }, { data: canEdit }, { data: assignments }, subjects] = await Promise.all([
    supabase.from("tests").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("test_questions")
      .select("position, question_type, prompt, points, answer_options(label, text), answer_keys(correct_label)")
      .eq("test_id", id)
      .order("position"),
    supabase.rpc("can_edit_test", { p_test: id }),
    supabase.from("test_assignments").select("class_id, classes(name)").eq("test_id", id),
    getSubjects(supabase),
  ]);
  if (!test) notFound();
  const tr = test as TestRow;
  const classes = tr.center_id ? await getClasses(supabase, tr.center_id) : [];

  type Q = {
    position: number;
    question_type: "single_choice" | "true_false";
    prompt: string;
    points: number;
    answer_options: Array<{ label: string; text: string }>;
    answer_keys: { correct_label: string } | Array<{ correct_label: string }> | null;
  };
  const initial: EditorQuestion[] = ((questions ?? []) as unknown as Q[]).map((q) => {
    const opts = [...q.answer_options].sort((a, b) => a.label.localeCompare(b.label));
    const key = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
    return {
      position: q.position,
      type: q.question_type,
      option_count: Math.max(2, opts.length),
      prompt: q.prompt,
      points: Number(q.points),
      correct: (key?.correct_label ?? null) as (typeof LABELS)[number] | null,
      options: opts.map((o) => o.text),
    };
  });
  const editable = Boolean(canEdit) && tr.status === "draft";
  const assigned = ((assignments ?? []) as unknown as Array<{ class_id: string; classes: { name: string } | null }>).map((a) => ({
    id: a.class_id,
    name: a.classes?.name ?? "—",
  }));
  const subject = subjects.find((s) => s.id === tr.subject_id);

  return (
    <>
      <PageHeader
        title={tr.title}
        subtitle={[subjectName(subject, locale), tr.center_id === null ? t.tests.hqTemplate : tr.is_template ? t.tests.template : null].filter(Boolean).join(" · ")}
        actions={<Badge tone={TEST_STATUS_TONE[tr.status]}>{t.tests[STATUS_KEY[tr.status]]}</Badge>}
      />
      <div className="mb-6">
        <TestActions
          testId={tr.id}
          status={tr.status}
          canEdit={Boolean(canEdit)}
          canDuplicate={ctx.activeCenterId !== null || ctx.isHq}
          isTemplate={tr.is_template}
        />
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <QuestionsEditor testId={tr.id} initial={initial} locked={!editable} />
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title={t.tests.editTitle} />
            <CardBody>
              <TestMetaForm
                testId={tr.id}
                disabled={!editable}
                subjects={subjects.filter((s) => s.is_active || s.id === tr.subject_id).map((s) => ({ id: s.id, name: subjectName(s, locale) }))}
                value={{
                  title: tr.title,
                  subject_id: tr.subject_id,
                  grade: tr.grade ?? "",
                  language: tr.language,
                  instructions: tr.instructions,
                  question_count: tr.question_count,
                  negative_marking: tr.negative_marking,
                  negative_points: Number(tr.negative_points),
                  passing_score: Number(tr.passing_score),
                  time_limit_minutes: tr.time_limit_minutes ?? "",
                  is_template: tr.is_template,
                  hq_template: tr.center_id === null,
                }}
              />
            </CardBody>
          </Card>
          {tr.center_id && !tr.is_template ? (
            <Card>
              <CardHeader title={t.tests.assignTitle} />
              <CardBody>
                <TestAssignments
                  testId={tr.id}
                  assigned={assigned}
                  classes={classes.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
                  canAssign={Boolean(canEdit) || ctx.role !== "teacher"}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
