/**
 * Database security and grading tests.
 *
 * These run the real migrations on PostgreSQL (PGlite, in-process) with a
 * small stub of Supabase's auth schema, then act as different users the same
 * way PostgREST does (role `authenticated` + JWT `sub` claim).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addMember,
  admin,
  asService,
  asUser,
  createCenter,
  createTestDb,
  createUser,
  expectDenied,
} from "./harness";

let db: PGlite;
type IdKey =
  | "centerA" | "centerB" | "hq" | "adminA" | "adminB" | "teacherA1" | "teacherA2" | "outsider" | "subject"
  | "classA1" | "classA2" | "classB1" | "studentA1" | "studentA2" | "studentB1" | "testA";
const ids = {} as Record<IdKey, string>;

const questions = [
  { position: 1, type: "single_choice", points: 1, correct: "A", options: ["A", "B", "C", "D"] },
  { position: 2, type: "single_choice", points: 2, correct: "C", options: ["A", "B", "C", "D", "E"] },
  { position: 3, type: "true_false", points: 1, correct: "B", options: ["A", "B"] },
  { position: 4, type: "single_choice", points: 1, correct: "D", options: ["A", "B", "C", "D"] },
].map((q) => ({ ...q, options: q.options.map((label) => ({ label, text: "" })) }));

async function createPublishedTest(userId: string, centerId: string, opts: { negative?: number } = {}) {
  const [t] = await asUser<{ id: string }>(
    db,
    userId,
    `insert into public.tests (center_id, title, subject_id, question_count, negative_marking, negative_points,
                               passing_score, created_by)
     values ($1, 'Algebra midterm', $2, 4, $3, $4, 3, $5) returning id`,
    [centerId, ids.subject, (opts.negative ?? 0) > 0, opts.negative ?? 0, userId],
  );
  await asUser(db, userId, "select public.save_test_content($1, $2::jsonb)", [t!.id, JSON.stringify(questions)]);
  await asUser(db, userId, "select public.publish_test($1)", [t!.id]);
  return t!.id;
}

async function createScanJob(centerId: string, testId: string, uploader: string) {
  const [job] = await asService<{ id: string }>(
    db,
    "insert into public.scan_jobs (center_id, test_id, uploaded_by, status) values ($1,$2,$3,'processing') returning id",
    [centerId, testId, uploader],
  );
  return job!.id;
}

function recognized(entries: Array<[number, string | null, string, string[]?]>) {
  return JSON.stringify(
    entries.map(([position, chosen, status, detected]) => ({
      position,
      chosen,
      status,
      detected: detected ?? (chosen ? [chosen] : []),
      confidence: status === "ok" || status === "blank" ? 0.95 : 0.4,
      fill: {},
    })),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  ids.centerA = await createCenter(db, "ALA-01");
  ids.centerB = await createCenter(db, "AST-01");
  ids.hq = await createUser(db, "hq@zerdeli.kz", { hq: true });
  ids.adminA = await createUser(db, "admin.a@zerdeli.kz");
  ids.adminB = await createUser(db, "admin.b@zerdeli.kz");
  ids.teacherA1 = await createUser(db, "teacher.a1@zerdeli.kz");
  ids.teacherA2 = await createUser(db, "teacher.a2@zerdeli.kz");
  ids.outsider = await createUser(db, "nobody@example.com");
  await addMember(db, ids.centerA, ids.adminA, "center_admin");
  await addMember(db, ids.centerB, ids.adminB, "center_admin");
  await addMember(db, ids.centerA, ids.teacherA1, "teacher");
  await addMember(db, ids.centerA, ids.teacherA2, "teacher", false);

  const [subject] = await admin<{ id: string }>(db, "select id from public.subjects where code = 'algebra'");
  ids.subject = subject!.id;

  const cls = async (userId: string, centerId: string, name: string) =>
    (await asUser<{ id: string }>(db, userId,
      "insert into public.classes (center_id, name, grade) values ($1, $2, 9) returning id", [centerId, name]))[0]!.id;
  ids.classA1 = await cls(ids.adminA, ids.centerA, "9A");
  ids.classA2 = await cls(ids.adminA, ids.centerA, "9B");
  ids.classB1 = await cls(ids.adminB, ids.centerB, "9A");
  await asUser(db, ids.adminA, "insert into public.class_teachers (class_id, center_id, user_id) values ($1,$2,$3)", [
    ids.classA1, ids.centerA, ids.teacherA1,
  ]);

  const student = async (userId: string, centerId: string, classId: string, code: string) =>
    (await asUser<{ id: string }>(db, userId,
      `insert into public.students (center_id, class_id, first_name, last_name, student_code)
       values ($1, $2, 'Aruzhan', 'Test', $3) returning id`, [centerId, classId, code]))[0]!.id;
  ids.studentA1 = await student(ids.adminA, ids.centerA, ids.classA1, "A1-001");
  ids.studentA2 = await student(ids.adminA, ids.centerA, ids.classA2, "A2-001");
  ids.studentB1 = await student(ids.adminB, ids.centerB, ids.classB1, "B1-001");

  ids.testA = await createPublishedTest(ids.adminA, ids.centerA);
  await asUser(db, ids.adminA, "insert into public.test_assignments (test_id, center_id, class_id) values ($1,$2,$3)", [
    ids.testA, ids.centerA, ids.classA1,
  ]);
});

describe("cross-center isolation", () => {
  it("center admin sees only own center's students", async () => {
    const rows = await asUser<{ center_id: string }>(db, ids.adminA, "select center_id from public.students");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.center_id))).toEqual(new Set([ids.centerA]));
  });

  it("another center's admin sees none of center A's data", async () => {
    for (const table of ["students", "classes", "tests", "assessment_results", "answer_sheets", "scan_jobs"]) {
      const rows = await asUser(db, ids.adminB, `select 1 from public.${table} where center_id = $1`, [ids.centerA]);
      expect(rows, table).toHaveLength(0);
    }
    const centers = await asUser<{ id: string }>(db, ids.adminB, "select id from public.centers");
    expect(centers.map((c) => c.id)).toEqual([ids.centerB]);
  });

  it("teacher sees only students of assigned classes", async () => {
    const rows = await asUser<{ id: string }>(db, ids.teacherA1, "select id from public.students");
    expect(rows.map((r) => r.id)).toEqual([ids.studentA1]);
    const none = await asUser(db, ids.teacherA2, "select id from public.students");
    expect(none).toHaveLength(0);
  });

  it("teacher sees tests assigned to their classes but not unassigned drafts of others", async () => {
    const [draft] = await asUser<{ id: string }>(db, ids.adminA,
      `insert into public.tests (center_id, title, subject_id, question_count, created_by)
       values ($1, 'Private draft', $2, 1, $3) returning id`, [ids.centerA, ids.subject, ids.adminA]);
    const visible = await asUser<{ id: string }>(db, ids.teacherA1, "select id from public.tests");
    expect(visible.map((t) => t.id)).toContain(ids.testA);
    expect(visible.map((t) => t.id)).not.toContain(draft!.id);
    const v2 = await asUser(db, ids.teacherA2, "select id from public.tests");
    expect(v2).toHaveLength(0);
  });

  it("users without membership see nothing", async () => {
    for (const table of ["centers", "students", "classes", "tests", "assessment_results", "audit_logs"]) {
      expect(await asUser(db, ids.outsider, `select 1 from public.${table}`), table).toHaveLength(0);
    }
  });

  it("HQ admin sees every center", async () => {
    const rows = await asUser(db, ids.hq, "select id from public.students");
    expect(rows).toHaveLength(3);
  });

  it("center admin cannot create records in another center", async () => {
    await expectDenied(
      asUser(db, ids.adminA,
        "insert into public.students (center_id, first_name, last_name) values ($1, 'X', 'Y')", [ids.centerB]),
      /row-level security/,
    );
    await expectDenied(
      asUser(db, ids.adminA, "insert into public.classes (center_id, name) values ($1, 'hack')", [ids.centerB]),
      /row-level security/,
    );
  });

  it("rows cannot be moved to another center", async () => {
    await expectDenied(
      asUser(db, ids.hq, "update public.students set center_id = $1 where id = $2", [ids.centerB, ids.studentA1]),
      /center_id cannot be changed/,
    );
  });

  it("a student cannot be attached to another center's class", async () => {
    await expectDenied(
      asUser(db, ids.adminA, "update public.students set class_id = $1 where id = $2", [ids.classB1, ids.studentA1]),
      /foreign key/,
    );
  });

  it("anon role has no access at all", async () => {
    await expectDenied(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select * from public.students");
      }),
      /permission denied/,
    );
  });
});

describe("privilege escalation", () => {
  it("users cannot make themselves HQ admins", async () => {
    await expectDenied(
      asUser(db, ids.teacherA1, "update public.profiles set is_hq_admin = true where id = $1", [ids.teacherA1]),
      /permission denied/,
    );
  });

  it("users can change their own name and language only", async () => {
    await asUser(db, ids.teacherA1, "update public.profiles set full_name = 'Teacher One', preferred_locale = 'ru' where id = $1", [ids.teacherA1]);
    const rows = await asUser(db, ids.teacherA1, "update public.profiles set full_name = 'x' where id = $1 returning id", [ids.adminA]);
    expect(rows).toHaveLength(0);
  });

  it("users cannot grant themselves memberships", async () => {
    await expectDenied(
      asUser(db, ids.outsider,
        "insert into public.center_memberships (center_id, user_id, role) values ($1, $2, 'center_admin')",
        [ids.centerA, ids.outsider]),
      /permission denied/,
    );
    await expectDenied(
      asUser(db, ids.teacherA1, "update public.center_memberships set role = 'center_admin' where user_id = $1", [ids.teacherA1]),
      /permission denied/,
    );
  });

  it("clients cannot write scores directly", async () => {
    await expectDenied(
      asUser(db, ids.adminA,
        `insert into public.assessment_results (center_id, test_id, student_id, score, max_score, percentage, status)
         values ($1, $2, $3, 100, 5, 100, 'finalized')`, [ids.centerA, ids.testA, ids.studentA1]),
      /permission denied/,
    );
    await expectDenied(asUser(db, ids.adminA, "update public.assessment_results set score = 100"), /permission denied/);
    await expectDenied(asUser(db, ids.adminA, "update public.result_answers set is_correct = true"), /permission denied/);
  });

  it("clients cannot call the server-only recognition function", async () => {
    await expectDenied(
      asUser(db, ids.adminA, "select public.create_scan_result(gen_random_uuid(), '[]'::jsonb)"),
      /permission denied/,
    );
  });

  it("audit log is append-only even for the service role", async () => {
    await expectDenied(asService(db, "update public.audit_logs set action = 'x'"), /append-only/);
    await expectDenied(asService(db, "delete from public.audit_logs"), /append-only/);
  });

  it("an inactive membership loses access immediately", async () => {
    const temp = await createUser(db, "temp@zerdeli.kz");
    await addMember(db, ids.centerA, temp, "center_admin");
    expect((await asUser(db, temp, "select id from public.students")).length).toBe(2);
    await admin(db, "update public.center_memberships set is_active = false where user_id = $1", [temp]);
    expect(await asUser(db, temp, "select id from public.students")).toHaveLength(0);
  });

  it("a deactivated center is invisible to its staff", async () => {
    const c = await createCenter(db, "TMP-01");
    const u = await createUser(db, "tmp.admin@zerdeli.kz");
    await addMember(db, c, u, "center_admin");
    expect(await asUser(db, u, "select id from public.centers")).toHaveLength(1);
    await admin(db, "update public.centers set is_active = false where id = $1", [c]);
    expect(await asUser(db, u, "select id from public.centers")).toHaveLength(0);
  });
});

describe("tests and answer keys", () => {
  it("published tests are locked", async () => {
    await expectDenied(
      asUser(db, ids.adminA, "update public.answer_keys set correct_label = 'B' where test_id = $1", [ids.testA]),
      /ZG_TEST_LOCKED/,
    );
    await expectDenied(
      asUser(db, ids.adminA, "select public.save_test_content($1, $2::jsonb)", [ids.testA, JSON.stringify(questions)]),
      /ZG_TEST_LOCKED/,
    );
  });

  it("a test cannot be published without a complete answer key", async () => {
    const [t] = await asUser<{ id: string }>(db, ids.adminA,
      `insert into public.tests (center_id, title, subject_id, question_count, created_by)
       values ($1, 'Incomplete', $2, 2, $3) returning id`, [ids.centerA, ids.subject, ids.adminA]);
    const qs = questions.slice(0, 2).map((q, i) => ({ ...q, correct: i === 0 ? null : q.correct }));
    await asUser(db, ids.adminA, "select public.save_test_content($1, $2::jsonb)", [t!.id, JSON.stringify(qs)]);
    await expectDenied(asUser(db, ids.adminA, "select public.publish_test($1)", [t!.id]), /ZG_TEST_INCOMPLETE/);
  });

  it("status cannot jump to published without validation", async () => {
    const [t] = await asUser<{ id: string }>(db, ids.adminA,
      `insert into public.tests (center_id, title, subject_id, question_count, created_by)
       values ($1, 'Sneaky', $2, 1, $3) returning id`, [ids.centerA, ids.subject, ids.adminA]);
    await expectDenied(
      asUser(db, ids.adminA, "update public.tests set status = 'published' where id = $1", [t!.id]),
      /ZG_PUBLISH_REQUIRED/,
    );
  });

  it("rejects answer keys that are not one of the options", async () => {
    const [t] = await asUser<{ id: string }>(db, ids.adminA,
      `insert into public.tests (center_id, title, subject_id, question_count, created_by)
       values ($1, 'Bad key', $2, 1, $3) returning id`, [ids.centerA, ids.subject, ids.adminA]);
    const bad = [{ position: 1, type: "true_false", points: 1, correct: "C", options: [{ label: "A" }, { label: "B" }] }];
    await expectDenied(
      asUser(db, ids.adminA, "select public.save_test_content($1, $2::jsonb)", [t!.id, JSON.stringify(bad)]),
      /ZG_INVALID_KEY/,
    );
  });

  it("duplicating creates an editable draft copy with the same key", async () => {
    const [{ duplicate_test: copy }] = (await asUser<{ duplicate_test: string }>(db, ids.adminA,
      "select public.duplicate_test($1, $2, false, 'Copy')", [ids.testA, ids.centerA])) as [{ duplicate_test: string }];
    const keys = await asUser<{ correct_label: string }>(db, ids.adminA,
      `select k.correct_label from public.answer_keys k join public.test_questions q on q.id = k.question_id
       where k.test_id = $1 order by q.position`, [copy]);
    expect(keys.map((k) => k.correct_label)).toEqual(["A", "C", "B", "D"]);
    const [t] = await asUser<{ status: string }>(db, ids.adminA, "select status from public.tests where id = $1", [copy]);
    expect(t!.status).toBe("draft");
  });

  it("another center cannot duplicate center A's test", async () => {
    await expectDenied(
      asUser(db, ids.adminB, "select public.duplicate_test($1, $2, false, null)", [ids.testA, ids.centerB]),
      /ZG_FORBIDDEN/,
    );
  });
});

describe("scoring, review and finalization", () => {
  it("scores a clean sheet in the database", async () => {
    const job = await createScanJob(ids.centerA, ids.testA, ids.teacherA1);
    const [{ create_scan_result: resultId }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job, recognized([[1, "A", "ok"], [2, "C", "ok"], [3, "A", "ok"], [4, "D", "ok"]]), ids.studentA1],
    )) as [{ create_scan_result: string }];
    const [r] = await asUser<Record<string, unknown>>(db, ids.teacherA1,
      "select * from public.assessment_results where id = $1", [resultId]);
    expect(Number(r!.score)).toBe(4);
    expect(Number(r!.max_score)).toBe(5);
    expect(Number(r!.percentage)).toBe(80);
    expect(r!.correct_count).toBe(3);
    expect(r!.incorrect_count).toBe(1);
    expect(r!.status).toBe("needs_review");
    expect(r!.open_warning_count).toBe(0);
    expect(r!.passed).toBe(true);

    // No warnings: a teacher with finalize permission may confirm directly.
    await asUser(db, ids.teacherA1, "select public.finalize_result($1, '')", [resultId]);
    const [f] = await asUser<{ status: string; finalized_by: string }>(db, ids.teacherA1,
      "select status, finalized_by from public.assessment_results where id = $1", [resultId]);
    expect(f).toEqual({ status: "finalized", finalized_by: ids.teacherA1 });
  });

  it("flags blank and multiple marks and blocks finalization until reviewed", async () => {
    const job = await createScanJob(ids.centerA, ids.testA, ids.teacherA1);
    const [{ create_scan_result: resultId }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job, recognized([[1, "A", "ok"], [2, null, "multiple", ["B", "C"]], [3, null, "blank"], [4, "D", "uncertain"]]),
        ids.studentA1],
    )) as [{ create_scan_result: string }];

    const [r] = await asUser<Record<string, unknown>>(db, ids.teacherA1,
      "select * from public.assessment_results where id = $1", [resultId]);
    expect(r!.open_warning_count).toBe(2); // multiple + uncertain; blank is informational
    expect(r!.blank_count).toBe(2); // the multiple-marked answer is not counted as an answer
    expect(Number(r!.score)).toBe(2); // Q1 (1) + Q4 uncertain-but-correct preliminary (1)

    await expectDenied(asUser(db, ids.teacherA1, "select public.finalize_result($1, '')", [resultId]), /ZG_REVIEW_REQUIRED/);

    // Teacher resolves Q2 as C after looking at the photo.
    await asUser(db, ids.teacherA1, "select public.review_result($1, $2::jsonb, null, 'checked photo')",
      [resultId, JSON.stringify({ "2": "C" })]);
    const [after] = await asUser<Record<string, unknown>>(db, ids.teacherA1,
      "select * from public.assessment_results where id = $1", [resultId]);
    expect(Number(after!.score)).toBe(4);
    expect(after!.status).toBe("reviewed");
    expect(after!.correction_count).toBe(1);

    const reviews = await asUser<{ action: string; previous_value: string | null; new_value: string | null }>(db,
      ids.teacherA1, "select action, previous_value, new_value from public.result_reviews where result_id = $1 order by created_at, action",
      [resultId]);
    expect(reviews).toContainEqual({ action: "correction", previous_value: null, new_value: "C" });

    // Teacher without finalize permission cannot finalize, others can.
    await expectDenied(asUser(db, ids.teacherA2, "select public.finalize_result($1, '')", [resultId]), /ZG_FORBIDDEN/);
    await asUser(db, ids.adminA, "select public.finalize_result($1, 'ok')", [resultId]);

    // Finalized results cannot be edited; an admin must reopen with a reason.
    await expectDenied(
      asUser(db, ids.adminA, "select public.review_result($1, $2::jsonb)", [resultId, JSON.stringify({ "1": "B" })]),
      /ZG_RESULT_FINALIZED/,
    );
    await expectDenied(asUser(db, ids.teacherA1, "select public.reopen_result($1, 'please')", [resultId]), /ZG_FORBIDDEN/);
    await expectDenied(asUser(db, ids.adminA, "select public.reopen_result($1, '')", [resultId]), /ZG_COMMENT_REQUIRED/);
    await asUser(db, ids.adminA, "select public.reopen_result($1, 'parent appeal')", [resultId]);

    const audit = await asUser<{ action: string }>(db, ids.adminA,
      "select action from public.audit_logs where entity_id = $1 order by id", [resultId]);
    expect(audit.map((a) => a.action)).toEqual([
      "result.recognized", "result.reviewed", "result.finalized", "result.reopened",
    ]);
  });

  it("rejects answers that are not valid options", async () => {
    const job = await createScanJob(ids.centerA, ids.testA, ids.teacherA1);
    const [{ create_scan_result: resultId }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job, recognized([[1, "A", "ok"], [2, "C", "ok"], [3, "B", "ok"], [4, "D", "ok"]]), ids.studentA1],
    )) as [{ create_scan_result: string }];
    // Question 3 is true/false: only A and B exist.
    await expectDenied(
      asUser(db, ids.teacherA1, "select public.review_result($1, $2::jsonb)", [resultId, JSON.stringify({ "3": "E" })]),
      /ZG_INVALID_ANSWERS/,
    );
  });

  it("requires a student before finalizing", async () => {
    const job = await createScanJob(ids.centerA, ids.testA, ids.adminA);
    const [{ create_scan_result: resultId }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, null)",
      [job, recognized([[1, "A", "ok"], [2, "C", "ok"], [3, "B", "ok"], [4, "D", "ok"]])],
    )) as [{ create_scan_result: string }];
    await expectDenied(asUser(db, ids.adminA, "select public.finalize_result($1, '')", [resultId]), /ZG_REVIEW_REQUIRED/);
    // Linking a student of another center is refused.
    await expectDenied(
      asUser(db, ids.adminA, "select public.review_result($1, '{}'::jsonb, $2)", [resultId, ids.studentB1]),
      /ZG_FORBIDDEN/,
    );
    await asUser(db, ids.adminA, "select public.review_result($1, '{}'::jsonb, $2)", [resultId, ids.studentA2]);
    await asUser(db, ids.adminA, "select public.finalize_result($1, '')", [resultId]);
  });

  it("other centers cannot review or finalize center A results", async () => {
    const [r] = await asUser<{ id: string }>(db, ids.adminA, "select id from public.assessment_results limit 1");
    await expectDenied(asUser(db, ids.adminB, "select public.review_result($1, '{}'::jsonb)", [r!.id]), /ZG_FORBIDDEN/);
    await expectDenied(asUser(db, ids.adminB, "select public.finalize_result($1, '')", [r!.id]), /ZG_FORBIDDEN/);
  });

  it("applies negative marking and never goes below zero", async () => {
    const testNeg = await createPublishedTest(ids.adminA, ids.centerA, { negative: 0.5 });
    const job = await createScanJob(ids.centerA, testNeg, ids.adminA);
    const [{ create_scan_result: resultId }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job, recognized([[1, "A", "ok"], [2, "A", "ok"], [3, "A", "ok"], [4, null, "blank"]]), ids.studentA1],
    )) as [{ create_scan_result: string }];
    const [r] = await asUser<{ score: string }>(db, ids.adminA, "select score from public.assessment_results where id = $1", [resultId]);
    expect(Number(r!.score)).toBe(0); // 1 - 0.5 - 0.5 + 0

    const job2 = await createScanJob(ids.centerA, testNeg, ids.adminA);
    const [{ create_scan_result: r2 }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job2, recognized([[1, "B", "ok"], [2, "A", "ok"], [3, "A", "ok"], [4, "A", "ok"]]), ids.studentA1],
    )) as [{ create_scan_result: string }];
    const [rr] = await asUser<{ score: string }>(db, ids.adminA, "select score from public.assessment_results where id = $1", [r2]);
    expect(Number(rr!.score)).toBe(0); // clamped
  });

  it("manual results are scored server-side", async () => {
    const [{ create_manual_result: id }] = (await asUser<{ create_manual_result: string }>(db, ids.teacherA1,
      "select public.create_manual_result($1, $2, $3::jsonb)",
      [ids.testA, ids.studentA1, JSON.stringify({ "1": "A", "2": "C", "3": "B", "4": "D" })],
    )) as [{ create_manual_result: string }];
    const [r] = await asUser<{ score: string; percentage: string }>(db, ids.teacherA1,
      "select score, percentage from public.assessment_results where id = $1", [id]);
    expect(Number(r!.score)).toBe(5);
    expect(Number(r!.percentage)).toBe(100);
    // Teacher of class A1 cannot create results for a student of class A2.
    await expectDenied(
      asUser(db, ids.teacherA1, "select public.create_manual_result($1, $2, '{}'::jsonb)", [ids.testA, ids.studentA2]),
      /ZG_FORBIDDEN/,
    );
  });
});

describe("voiding results", () => {
  async function scannedResult(uploader: string, withSheet = true) {
    let sheetId: string | null = null;
    if (withSheet) {
      const [s] = await asUser<{ id: string }>(db, uploader,
        `insert into public.answer_sheets (center_id, test_id, class_id, student_id, sheet_code, language, question_count, created_by)
         values ($1,$2,$3,$4,'VOIDTEST22','kk',4,$5) returning id`,
        [ids.centerA, ids.testA, ids.classA1, ids.studentA1, uploader]);
      sheetId = s!.id;
    }
    const [file] = await asService<{ id: string }>(db,
      `insert into public.file_metadata (center_id, bucket, object_path, mime_type, size_bytes, sha256, uploaded_by, delete_after)
       values ($1, 'answer-sheets', gen_random_uuid()::text, 'image/jpeg', 1000, repeat('b', 64), $2, now() + interval '1 year') returning id`,
      [ids.centerA, uploader]);
    const [job] = await asService<{ id: string }>(db,
      "insert into public.scan_jobs (center_id, test_id, answer_sheet_id, file_id, uploaded_by) values ($1,$2,$3,$4,$5) returning id",
      [ids.centerA, ids.testA, sheetId, file!.id, uploader]);
    const [{ create_scan_result: id }] = (await asService<{ create_scan_result: string }>(db,
      "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job!.id, recognized([[1, "A", "ok"], [2, "C", "ok"], [3, "B", "ok"], [4, "D", "ok"]]), ids.studentA1])) as [{ create_scan_result: string }];
    return { id, sheetId, fileId: file!.id, jobId: job!.id };
  }

  it("lets the teacher void an unfinalized result, releases the sheet and schedules the photo for deletion", async () => {
    const r = await scannedResult(ids.teacherA1);
    await expectDenied(asUser(db, ids.teacherA1, "select public.void_result($1, '')", [r.id]), /ZG_COMMENT_REQUIRED/);
    await asUser(db, ids.teacherA1, "select public.void_result($1, 'wrong sheet photographed')", [r.id]);

    const [row] = await asUser<Record<string, unknown>>(db, ids.teacherA1,
      "select status, answer_sheet_id, voided_by, void_reason from public.assessment_results where id = $1", [r.id]);
    expect(row).toMatchObject({ status: "voided", answer_sheet_id: null, voided_by: ids.teacherA1, void_reason: "wrong sheet photographed" });
    const [job] = await admin<{ status: string }>(db, "select status from public.scan_jobs where id = $1", [r.jobId]);
    expect(job!.status).toBe("voided");
    const [file] = await admin<{ due: boolean }>(db, "select delete_after <= now() as due from public.file_metadata where id = $1", [r.fileId]);
    expect(file!.due).toBe(true);

    // The same paper sheet can now be scanned again.
    const again = await admin(db, "select 1 from public.assessment_results where answer_sheet_id = $1 and status <> 'voided'", [r.sheetId]);
    expect(again).toHaveLength(0);

    // Voided results are final: no review, no finalize, no second void, no analytics.
    await expectDenied(asUser(db, ids.teacherA1, "select public.review_result($1, $2::jsonb)", [r.id, JSON.stringify({ "1": "B" })]), /ZG_RESULT_VOIDED/);
    await expectDenied(asUser(db, ids.adminA, "select public.finalize_result($1, '')", [r.id]), /ZG_REVIEW_REQUIRED/);
    await expectDenied(asUser(db, ids.adminA, "select public.void_result($1, 'again')", [r.id]), /ZG_RESULT_VOIDED/);

    const audit = await admin<{ action: string }>(db, "select action from public.audit_logs where entity_id = $1 order by id", [r.id]);
    expect(audit.map((a) => a.action)).toContain("result.voided");
  });

  it("allows only center admins to void a finalized result", async () => {
    const r = await scannedResult(ids.teacherA1, false);
    await asUser(db, ids.teacherA1, "select public.finalize_result($1, '')", [r.id]);
    await expectDenied(asUser(db, ids.teacherA1, "select public.void_result($1, 'mistake')", [r.id]), /ZG_FORBIDDEN/);
    await expectDenied(asUser(db, ids.adminB, "select public.void_result($1, 'mistake')", [r.id]), /ZG_FORBIDDEN/);
    await asUser(db, ids.adminA, "select public.void_result($1, 'parent appeal: wrong student')", [r.id]);
    const [row] = await admin<{ status: string }>(db, "select status from public.assessment_results where id = $1", [r.id]);
    expect(row!.status).toBe("voided");
  });

  it("is not callable by anonymous users or other teachers", async () => {
    const r = await scannedResult(ids.adminA, false);
    await expectDenied(asUser(db, ids.teacherA2, "select public.void_result($1, 'nope')", [r.id]), /ZG_FORBIDDEN/);
    await expectDenied(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select public.void_result($1, 'x')", [r.id]);
      }),
      /permission denied/,
    );
  });
});

describe("self-registration access requests", () => {
  it("enforces confirmation, uniqueness and who may approve", async () => {
    const u = await createUser(db, "newbie@example.com");
    const req = (center: string) => asUser<{ request_access: string }>(db, u, "select public.request_access($1, 'New Teacher', 'hi')", [center]);
    await expectDenied(req(ids.centerA), /ZG_EMAIL_NOT_CONFIRMED/);
    await admin(db, "update auth.users set email_confirmed_at = now() where id = $1", [u]);
    const centers = await asUser<{ id: string }>(db, u, "select id from public.list_signup_centers()");
    expect(centers.map((c) => c.id)).toContain(ids.centerA);
    expect(await asUser(db, u, "select 1 from public.students")).toHaveLength(0);

    const [{ request_access: rid }] = (await req(ids.centerA)) as [{ request_access: string }];
    await expectDenied(req(ids.centerB), /ZG_REQUEST_PENDING/);
    await expectDenied(asUser(db, u, "insert into public.access_requests (user_id, center_id, full_name) values ($1,$2,'x y')", [u, ids.centerA]), /permission denied/);

    // Nobody but center A's admins (or HQ) may decide; never the applicant.
    await expectDenied(asUser(db, u, "select public.decide_access_request($1, true)", [rid]), /ZG_FORBIDDEN/);
    await expectDenied(asUser(db, ids.teacherA1, "select public.decide_access_request($1, true)", [rid]), /ZG_FORBIDDEN/);
    await expectDenied(asUser(db, ids.adminB, "select public.decide_access_request($1, true)", [rid]), /ZG_FORBIDDEN/);
    expect(await asUser(db, ids.adminB, "select id from public.access_requests where id = $1", [rid])).toHaveLength(0);
    await expectDenied(asUser(db, ids.adminA, "select public.decide_access_request($1, false, '')", [rid]), /ZG_COMMENT_REQUIRED/);

    await asUser(db, ids.adminA, "select public.decide_access_request($1, true)", [rid]);
    const [m] = await admin<{ role: string; can_finalize: boolean }>(db, "select role, can_finalize from public.center_memberships where user_id = $1", [u]);
    expect(m).toEqual({ role: "teacher", can_finalize: false });
    await expectDenied(asUser(db, ids.adminA, "select public.decide_access_request($1, true)", [rid]), /ZG_INVALID_STATUS/);
    await expectDenied(req(ids.centerA), /ZG_ALREADY_MEMBER/);
  });

  it("is not callable anonymously", async () => {
    await expectDenied(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select * from public.list_signup_centers()");
      }),
      /permission denied/,
    );
  });
});

describe("answer-sheet photos", () => {
  it("are visible to the class teacher of the result but not to other centers or teachers", async () => {
    const [file] = await asService<{ id: string }>(db,
      `insert into public.file_metadata (center_id, bucket, object_path, mime_type, size_bytes, sha256, uploaded_by)
       values ($1, 'answer-sheets', $2, 'image/jpeg', 1000, repeat('a', 64), $3) returning id`,
      [ids.centerA, `${ids.centerA}/x.jpg`, ids.adminA]);
    const [job] = await asService<{ id: string }>(db,
      "insert into public.scan_jobs (center_id, test_id, file_id, uploaded_by) values ($1,$2,$3,$4) returning id",
      [ids.centerA, ids.testA, file!.id, ids.adminA]);
    await asService(db, "select public.create_scan_result($1, $2::jsonb, '[]'::jsonb, $3)",
      [job!.id, recognized([[1, "A", "ok"], [2, "C", "ok"], [3, "B", "ok"], [4, "D", "ok"]]), ids.studentA1]);
    const see = async (u: string) => (await asUser(db, u, "select id from public.file_metadata where id = $1", [file!.id])).length;
    expect(await see(ids.adminA)).toBe(1);
    expect(await see(ids.teacherA1)).toBe(1); // teacher of class A1, did not upload it
    expect(await see(ids.teacherA2)).toBe(0); // same center, other classes
    expect(await see(ids.adminB)).toBe(0); // other center
  });
});

describe("analytics respect RLS", () => {
  it("only counts finalized results visible to the caller", async () => {
    const [a] = await asUser<{ analytics_overview: { results_count: number } }>(db, ids.adminA,
      "select public.analytics_overview()");
    const [b] = await asUser<{ analytics_overview: { results_count: number } }>(db, ids.adminB,
      "select public.analytics_overview()");
    expect(a!.analytics_overview.results_count).toBeGreaterThan(0);
    expect(b!.analytics_overview.results_count).toBe(0);
  });
});
