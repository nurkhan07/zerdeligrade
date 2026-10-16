#!/usr/bin/env node
/**
 * DEMO DATA ONLY. Creates two clearly marked demo centers ("DEMO-…") with demo
 * staff, classes, students, a published test and finalized results, so the
 * dashboards can be explored. Every row is flagged is_demo = true.
 *
 *   npm run db:seed-demo           create demo data
 *   npm run db:remove-demo         delete all demo data (also possible in Settings)
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * and SUPABASE_SERVICE_ROLE_KEY. Demo logins and their generated passwords are
 * printed to YOUR terminal only; they are not stored anywhere else.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) {
  console.error("Missing Supabase env vars. Copy .env.example to .env.local first.");
  process.exit(1);
}
const admin = createClient(url, service, { auth: { persistSession: false } });
const die = (msg, err) => {
  console.error(msg, err?.message ?? err ?? "");
  process.exit(1);
};

async function removeDemo() {
  const { data: centers } = await admin.from("centers").select("id").eq("is_demo", true);
  const ids = (centers ?? []).map((c) => c.id);
  if (ids.length) {
    const { data: files } = await admin.from("file_metadata").select("bucket, object_path").in("center_id", ids);
    for (const f of files ?? []) await admin.storage.from(f.bucket).remove([f.object_path]);
    const { error } = await admin.from("centers").delete().in("id", ids);
    if (error) die("Could not delete demo centers:", error);
  }
  const { data: users } = await admin.from("profiles").select("id").eq("is_demo", true);
  for (const u of users ?? []) await admin.auth.admin.deleteUser(u.id);
  console.log(`Removed demo data: ${ids.length} centers, ${users?.length ?? 0} users.`);
}

if (process.argv.includes("--remove")) {
  await removeDemo();
  process.exit(0);
}

const { count } = await admin.from("centers").select("id", { count: "exact", head: true }).eq("is_demo", true);
if (count) die("Demo data already exists. Run `npm run db:remove-demo` first.");

const FIRST = ["Аружан", "Нұрсұлтан", "Әлия", "Ерлан", "Дана", "Айбек", "Мадина", "Темірлан", "Жанель", "Арман", "Інжу", "Санжар"];
const LAST = ["Сейтқали", "Омаров", "Жұмабаева", "Ахметов", "Нұрланқызы", "Серікұлы", "Қасымова", "Бекенов", "Төлеуова", "Ибраев"];
const rnd = (n) => Math.floor(Math.random() * n);
const password = () => randomBytes(12).toString("base64url");

async function demoUser(email, fullName, centerId, role) {
  const pw = password();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
    user_metadata: { full_name: fullName, preferred_locale: "kk" },
  });
  if (error) die(`Could not create ${email}:`, error);
  await admin.from("profiles").update({ is_demo: true, full_name: fullName }).eq("id", data.user.id);
  const { error: mErr } = await admin.from("center_memberships").insert({ center_id: centerId, user_id: data.user.id, role });
  if (mErr) die("membership:", mErr);
  return { id: data.user.id, email, password: pw };
}

const { data: subject } = await admin.from("subjects").select("id").eq("code", "math").single();
const logins = [];

for (const [code, name, city] of [
  ["DEMO-ALA", "Zerdeli Demo · Алматы", "Алматы"],
  ["DEMO-AST", "Zerdeli Demo · Астана", "Астана"],
]) {
  const { data: center, error } = await admin.from("centers").insert({ code, name, city, is_demo: true }).select("id").single();
  if (error) die("center:", error);
  const tag = code.toLowerCase();
  const adminUser = await demoUser(`${tag}.admin@demo.zerdeligrade.invalid`, `Demo Admin ${city}`, center.id, "center_admin");
  const teacher = await demoUser(`${tag}.teacher@demo.zerdeligrade.invalid`, `Demo Teacher ${city}`, center.id, "teacher");
  logins.push(adminUser, teacher);

  // Act as the demo center admin so every write goes through RLS and the real RPCs.
  const as = createClient(url, anon, { auth: { persistSession: false } });
  const { error: sErr } = await as.auth.signInWithPassword({ email: adminUser.email, password: adminUser.password });
  if (sErr) die("sign in:", sErr);

  const classes = [];
  for (const cname of ["9A", "9Ә"]) {
    const { data: c, error: cErr } = await as.from("classes").insert({ center_id: center.id, name: cname, grade: 9, academic_year: "2026-2027", is_demo: true }).select("id").single();
    if (cErr) die("class:", cErr);
    classes.push(c.id);
  }
  await as.from("class_teachers").insert({ class_id: classes[0], center_id: center.id, user_id: teacher.id });

  const students = [];
  for (let i = 0; i < 24; i++) {
    const { data: s, error: stErr } = await as
      .from("students")
      .insert({
        center_id: center.id,
        class_id: classes[i % 2],
        first_name: FIRST[rnd(FIRST.length)],
        last_name: LAST[rnd(LAST.length)],
        student_code: `${code}-${String(i + 1).padStart(3, "0")}`,
        is_demo: true,
      })
      .select("id")
      .single();
    if (stErr) die("student:", stErr);
    students.push(s.id);
  }

  const N = 20;
  const key = Array.from({ length: N }, () => "ABCDE"[rnd(5)]);
  const { data: test, error: tErr } = await as
    .from("tests")
    .insert({ center_id: center.id, title: "Демо: Математика, 9 сынып", subject_id: subject.id, grade: 9, language: "kk", question_count: N, passing_score: 10, created_by: adminUser.id, is_demo: true })
    .select("id")
    .single();
  if (tErr) die("test:", tErr);
  const questions = key.map((correct, i) => ({ position: i + 1, type: "single_choice", points: 1, correct, options: "ABCDE".split("").map((label) => ({ label })) }));
  const { error: qErr } = await as.rpc("save_test_content", { p_test: test.id, p_questions: questions });
  if (qErr) die("questions:", qErr);
  const { error: pErr } = await as.rpc("publish_test", { p_test: test.id });
  if (pErr) die("publish:", pErr);
  for (const c of classes) await as.from("test_assignments").insert({ test_id: test.id, center_id: center.id, class_id: c });

  // Manual results (scored by the database), then finalized.
  for (const sid of students) {
    const skill = 0.35 + Math.random() * 0.6;
    const answers = Object.fromEntries(key.map((k, i) => [String(i + 1), Math.random() < skill ? k : Math.random() < 0.15 ? null : "ABCDE"[rnd(5)]]));
    const { data: rid, error: rErr } = await as.rpc("create_manual_result", { p_test: test.id, p_student: sid, p_answers: answers });
    if (rErr) die("result:", rErr);
    await as.rpc("finalize_result", { p_result: rid, p_comment: "demo" });
    // Spread submissions over the last months so trend charts have data.
    const when = new Date(Date.now() - rnd(150) * 86_400_000).toISOString();
    await admin.from("assessment_results").update({ is_demo: true, submitted_at: when }).eq("id", rid);
  }
  await as.auth.signOut();
  console.log(`Created ${name}: 2 classes, ${students.length} students, 1 published test, ${students.length} results.`);
}

console.log("\nDEMO logins (shown once, keep private):");
for (const l of logins) console.log(`  ${l.email}  ${l.password}`);
console.log("\nRemove everything later with: npm run db:remove-demo");
