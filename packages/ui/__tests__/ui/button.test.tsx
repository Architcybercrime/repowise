import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "../../src/ui/button.js";

describe("Button", () => {
  it("renders children with the default variant", () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole("button", { name: "Click me" });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toMatch(/inline-flex/);
    // Primary actions are ink; orange stays on the focus ring only.
    expect(btn.className).toContain("bg-[var(--color-action-primary)]");
    expect(btn.className).not.toMatch(/accent-fill|gradient-ember/);
  });

  it("applies the destructive variant class when requested", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toMatch(/bg-\[var\(--color-error\)\]/);
  });

  it("forwards arbitrary HTML attributes to the underlying button", () => {
    render(
      <Button data-testid="action" type="submit" disabled>
        Save
      </Button>,
    );
    const btn = screen.getByTestId("action");
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toBeDisabled();
  });
});
