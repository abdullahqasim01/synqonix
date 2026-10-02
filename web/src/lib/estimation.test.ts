import { expect, it } from "vitest";
import { formatEstimate, formatTotal } from "./estimation";

it("shows estimates in the project's unit", () => {
  expect(formatEstimate(5, "POINTS")).toBe("5");
  expect(formatEstimate(5, "TSHIRT")).toBe("L");
  expect(formatEstimate(13, "TSHIRT")).toBe("XXL");
  expect(formatEstimate(4, "TSHIRT")).toBe("4"); // off-scale legacy value
  expect(formatEstimate(2.5, "HOURS")).toBe("2.5h");
  expect(formatEstimate(null, "POINTS")).toBe("");
});

it("formats totals", () => {
  expect(formatTotal(8, "POINTS")).toBe("8 pts");
  expect(formatTotal(8.123, "TSHIRT")).toBe("8.12 pts");
  expect(formatTotal(12, "HOURS")).toBe("12h");
});
