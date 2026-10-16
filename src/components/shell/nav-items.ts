import type { NavKey } from "@/lib/auth/permissions";

export interface NavItem {
  key: NavKey;
  href: string;
  group: "work" | "people" | "network";
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", href: "/dashboard", group: "work" },
  { key: "tests", href: "/tests", group: "work" },
  { key: "templates", href: "/templates", group: "work" },
  { key: "answerSheets", href: "/answer-sheets", group: "work" },
  { key: "scan", href: "/scan", group: "work" },
  { key: "results", href: "/results", group: "work" },
  { key: "analytics", href: "/analytics", group: "work" },
  { key: "students", href: "/students", group: "people" },
  { key: "classes", href: "/classes", group: "people" },
  { key: "centers", href: "/centers", group: "network" },
  { key: "users", href: "/users", group: "network" },
  { key: "network", href: "/network", group: "network" },
  { key: "audit", href: "/audit", group: "network" },
  { key: "settings", href: "/settings", group: "network" },
];
