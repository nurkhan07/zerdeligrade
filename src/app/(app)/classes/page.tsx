import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { ClassFormDialog, ClassTeachers, DeleteClassButton } from "@/components/classes/class-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.classes.title };
}

export default async function ClassesPage() {
  const ctx = await requireContext("classes");
  const { t } = await getI18n();
  const supabase = await createClient();
  const center = ctx.activeCenterId;
  const manage = can.manageClasses(ctx);

  let classQuery = supabase
    .from("classes")
    .select("id, center_id, name, kind, grade, academic_year, is_active, is_demo, students(count), class_teachers(user_id, profiles(full_name, email)), centers(code)")
    .order("academic_year", { ascending: false })
    .order("name");
  if (center) classQuery = classQuery.eq("center_id", center);

  let staffQuery = supabase.from("center_memberships").select("user_id, profiles(full_name, email)").eq("is_active", true).eq("role", "teacher");
  if (center) staffQuery = staffQuery.eq("center_id", center);

  const [{ data, error }, { data: staff }] = await Promise.all([classQuery, manage ? staffQuery : Promise.resolve({ data: [] })]);

  type Row = {
    id: string;
    name: string;
    kind: "class" | "group";
    grade: number | null;
    academic_year: string;
    is_active: boolean;
    is_demo: boolean;
    students: Array<{ count: number }>;
    class_teachers: Array<{ user_id: string; profiles: { full_name: string; email: string | null } | null }>;
    centers: { code: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const teachers = ((staff ?? []) as unknown as Array<{ user_id: string; profiles: { full_name: string; email: string | null } | null }>).map((m) => ({
    id: m.user_id,
    name: m.profiles?.full_name || m.profiles?.email || t.common.unknownUser,
  }));

  return (
    <>
      <PageHeader title={t.classes.title} subtitle={t.classes.subtitle} actions={manage ? <ClassFormDialog /> : null} />
      {ctx.role !== "teacher" && !center ? (
        <div className="mb-4">
          <Notice>{t.centerSwitch.required}</Notice>
        </div>
      ) : null}
      <Card>
        {error ? (
          <div className="p-5">
            <Notice tone="danger">{t.common.errorGeneric}</Notice>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<GraduationCap />} title={t.classes.empty} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t.classes.name}</TH>
                <TH>{t.classes.kind}</TH>
                <TH>{t.classes.grade}</TH>
                <TH>{t.classes.year}</TH>
                {!center ? <TH>{t.common.center}</TH> : null}
                <TH className="text-right">{t.classes.students}</TH>
                <TH>{t.classes.teachers}</TH>
                {manage ? <TH className="text-right">{t.common.actions}</TH> : null}
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">
                    <Link href={`/students?class=${c.id}`} className="hover:text-primary">
                      {c.name}
                    </Link>
                    {c.is_demo ? <Badge tone="accent" className="ml-2">{t.common.demo}</Badge> : null}
                  </TD>
                  <TD>{c.kind === "class" ? t.classes.kind_class : t.classes.kind_group}</TD>
                  <TD className="tabular">{c.grade ?? "—"}</TD>
                  <TD className="tabular text-muted">{c.academic_year || "—"}</TD>
                  {!center ? <TD className="text-muted">{c.centers?.code}</TD> : null}
                  <TD className="tabular text-right">{c.students?.[0]?.count ?? 0}</TD>
                  <TD>
                    <ClassTeachers
                      classId={c.id}
                      manage={manage}
                      available={teachers}
                      assigned={c.class_teachers.map((ct) => ({ id: ct.user_id, name: ct.profiles?.full_name || ct.profiles?.email || t.common.unknownUser }))}
                    />
                  </TD>
                  {manage ? (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <ClassFormDialog
                          value={{ id: c.id, name: c.name, kind: c.kind, grade: c.grade ?? "", academic_year: c.academic_year, is_active: c.is_active }}
                        />
                        <DeleteClassButton id={c.id} />
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
