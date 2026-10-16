/**
 * Role model used by the UI and server actions. The database (RLS + SECURITY
 * DEFINER functions) enforces the same rules independently; this module only
 * decides what to show and rejects obviously unauthorized requests early.
 */
export type Role = "hq_admin" | "center_admin" | "teacher";

export type NavKey =
  | "dashboard"
  | "tests"
  | "templates"
  | "scan"
  | "answerSheets"
  | "results"
  | "students"
  | "classes"
  | "analytics"
  | "centers"
  | "users"
  | "network"
  | "audit"
  | "settings";

const ALL: Role[] = ["hq_admin", "center_admin", "teacher"];
const ADMINS: Role[] = ["hq_admin", "center_admin"];

export const NAV_ACCESS: Record<NavKey, Role[]> = {
  dashboard: ALL,
  tests: ALL,
  templates: ALL,
  scan: ALL,
  answerSheets: ALL,
  results: ALL,
  students: ALL,
  classes: ALL,
  analytics: ALL,
  centers: ADMINS,
  users: ADMINS,
  network: ["hq_admin"],
  audit: ADMINS,
  settings: ALL,
};

export function canAccess(nav: NavKey, role: Role): boolean {
  return NAV_ACCESS[nav].includes(role);
}

export interface PermissionContext {
  role: Role;
  /** null = HQ looking at the whole network */
  activeCenterId: string | null;
  canFinalize: boolean;
}

export const can = {
  manageCenters: (c: PermissionContext) => c.role === "hq_admin",
  manageStudents: (c: PermissionContext) => c.role !== "teacher" && c.activeCenterId !== null,
  manageClasses: (c: PermissionContext) => c.role !== "teacher" && c.activeCenterId !== null,
  manageStaff: (c: PermissionContext) => c.role !== "teacher" && (c.role === "hq_admin" || c.activeCenterId !== null),
  createTests: (c: PermissionContext) => c.activeCenterId !== null || c.role === "hq_admin",
  manageHqTemplates: (c: PermissionContext) => c.role === "hq_admin",
  finalizeResults: (c: PermissionContext) => c.role !== "teacher" || c.canFinalize,
  reopenResults: (c: PermissionContext) => c.role !== "teacher",
  viewAudit: (c: PermissionContext) => c.role !== "teacher",
  viewNetwork: (c: PermissionContext) => c.role === "hq_admin",
  manageSubjects: (c: PermissionContext) => c.role === "hq_admin",
  /** Roles a user may assign: HQ appoints center admins; center admins manage teachers. */
  assignableRoles: (c: PermissionContext): Array<"center_admin" | "teacher"> =>
    c.role === "hq_admin" ? ["center_admin", "teacher"] : c.role === "center_admin" ? ["teacher"] : [],
};
