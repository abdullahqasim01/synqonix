import { expect, it } from "vitest";
import { canCreateProjects, isAdminRole } from "./permissions";

it("maps roles to UI capabilities", () => {
  expect(isAdminRole("OWNER")).toBe(true);
  expect(isAdminRole("ADMIN")).toBe(true);
  expect(isAdminRole("MEMBER")).toBe(false);
  expect(canCreateProjects("MEMBER")).toBe(true);
  expect(canCreateProjects("VIEWER")).toBe(false);
});
