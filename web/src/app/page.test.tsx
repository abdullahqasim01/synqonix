import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/theme-provider";
import Home from "./page";

test("renders the product name", () => {
  render(
    <ThemeProvider attribute="class">
      <Home />
    </ThemeProvider>,
  );
  expect(screen.getByRole("heading", { name: "Synqonix" })).toBeInTheDocument();
});
