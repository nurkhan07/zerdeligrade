import type { Metadata } from "next";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { ImportStudentsDialog, StudentFormDialog, StudentStatusButton } from "@/components/students/student-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { pageParam, searchPattern, str, uuidParam } from "@/lib/utils";
import { getClasses } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.students.title };
}

const PAGE_SIZE = 25;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("students");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const q = str(sp.q).trim().slice(0, 100);
  const classId = uuidParam(sp.class);
  const status = ["active", "inactive", "graduated"].includes(str(sp.status)) ? str(sp.status) : "";
  const page = pageParam(sp.page);
  const center = ctx.activeCenterId;
  const manage = can.manageStudents(ctx);

  let query = supabase
    .from("students")
    .select("id, first_name, last_name, student_code, class_id, status, created_at, is_demo, center_id, classes(name), centers(code)", { count: "exact" })
    .order("last_name")
    .order("first_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (center) query = query.eq("center_id", center);
  if (classId) query = query.eq("class_id", classId);
  if (status) query = query.eq("status", status);
  const pattern = searchPattern(q);
  if (pattern) query = query.or(`last_name.ilike.${pattern},first_name.ilike.${pattern},student_code.ilike.${pattern}`);
  const [{ data, count, error }, classes] = await Promise.all([query, getClasses(supabase, center)]);

  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    student_code: string | null;
    class_id: string | null;
    status: "active" | "inactive" | "graduated";
    created_at: string;
    is_demo: boolean;
    classes: { name: string } | null;
    centers: { code: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const classOptions = classes.map((c) => ({ id: c.id, name: c.name }));
  const exportQuery = new URLSearchParams({ ...(classId ? { class: classId } : {}), ...(status ? { status } : {}) }).toString();

  return (
    <>
      <PageHeader
        title={t.students.title}
        subtitle={t.students.subtitle}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`/api/export/students${exportQuery ? `?${exportQuery}` : ""}`}>
                <Download /> {t.common.export}
              </a>
            </Button>
            {manage ? (
              <>
                <ImportStudentsDialog />
                <StudentFormDialog classes={classOptions} />
              </>
            ) : null}
          </>
        }
      />
      {ctx.role !== "teacher" && !center ? (
        <div className="mb-4">
          <Notice>{t.centerSwitch.required}</Notice>
        </div>
      ) : null}

      <FilterBar t={t} resetHref="/students">
        <FilterInput name="q" label={t.common.search} value={q} placeholder={t.students.searchPlaceholder} />
        <FilterSelect name="class" label={t.students.class} value={classId ?? ""} allLabel={t.common.all} options={classOptions.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect
          name="status"
          label={t.common.status}
          value={status}
          allLabel={t.common.all}
          options={[
            { value: "active", label: t.students.status_active },
            { value: "inactive", label: t.students.status_inactive },
            { value: "graduated", label: t.students.status_graduated },
          ]}
        />
      </FilterBar>

      <Card>
        {error ? (
          <div className="p-5">
            <Notice tone="danger">{t.common.errorGeneric}</Notice>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users />} title={q || classId || status ? t.common.noResults : t.students.empty} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>{t.students.lastName}</TH>
                  <TH>{t.students.firstName}</TH>
                  <TH>{t.students.code}</TH>
                  <TH>{t.students.class}</TH>
                  {!center ? <TH>{t.common.center}</TH> : null}
                  <TH>{t.common.status}</TH>
                  <TH>{t.common.createdAt}</TH>
                  <TH className="text-right">{t.common.actions}</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">
                      <Link className="hover:text-primary" href={`/students/${s.id}`}>
                        {s.last_name}
                      </Link>
                      {s.is_demo ? <Badge tone="accent" className="ml-2">{t.common.demo}</Badge> : null}
                    </TD>
                    <TD>{s.first_name}</TD>
                    <TD className="tabular text-muted">{s.student_code ?? "—"}</TD>
                    <TD>{s.classes?.name ?? <span className="text-muted">{t.students.noClass}</span>}</TD>
                    {!center ? <TD className="text-muted">{s.centers?.code}</TD> : null}
                    <TD>
                      <Badge tone={s.status === "active" ? "success" : "neutral"}>{t.students[`status_${s.status}`]}</Badge>
                    </TD>
                    <TD className="text-muted">{formatDate(s.created_at, locale)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {manage ? (
                          <>
                            <StudentFormDialog
                              classes={classOptions}
                              student={{ id: s.id, first_name: s.first_name, last_name: s.last_name, student_code: s.student_code ?? "", class_id: s.class_id ?? "", status: s.status }}
                            />
                            <StudentStatusButton id={s.id} status={s.status} />
                          </>
                        ) : (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/students/${s.id}`}>{t.common.view}</Link>
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination
              t={t}
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/students"
              params={{ q: q || undefined, class: classId ?? undefined, status: status || undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}
