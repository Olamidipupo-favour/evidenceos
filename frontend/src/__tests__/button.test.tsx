import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Search literature</Button>);
    expect(screen.getByRole("button", { name: "Search literature" })).toBeInTheDocument();
  });
});
