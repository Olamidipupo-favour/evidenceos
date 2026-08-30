import { describe, expect, it } from "vitest";

import { tools } from "@evidenceos/webmcp";

import { ToolArgumentError, validateInput } from "@/lib/webmcp/validate";

function expectValid(schema: Record<string, unknown>, value: unknown) {
  expect(() => validateInput(schema, value)).not.toThrow();
}

function expectInvalid(schema: Record<string, unknown>, value: unknown) {
  expect(() => validateInput(schema, value)).toThrow(ToolArgumentError);
}

describe("validateInput — JSON Schema subset", () => {
  it("accepts values matching a basic object schema", () => {
    expectValid({ type: "string", minLength: 1 }, "metformin");
    expectInvalid({ type: "string", minLength: 1 }, "");
    expectInvalid({ type: "string", minLength: 1 }, 42);
  });

  it("handles union types including null", () => {
    expectValid({ type: ["string", "null"] }, null);
    expectValid({ type: ["string", "null"] }, "text");
    expectInvalid({ type: ["string", "null"] }, 9);
  });

  it("enforces enum and const", () => {
    expectValid({ enum: ["pending", "included"] }, "included");
    expectInvalid({ enum: ["pending", "included"] }, "accepted");
    expectValid({ const: 7 }, 7);
    expectInvalid({ const: 7 }, 8);
  });

  it("rejects unknown properties when additionalProperties is false", () => {
    const schema = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    };
    expectValid(schema, { title: "A review" });
    expectInvalid(schema, { title: "A review", injected: true });
    expectInvalid(schema, {});
  });

  it("enforces ranges and lengths", () => {
    expectValid({ type: "integer", minimum: 1 }, 5);
    expectInvalid({ type: "integer", minimum: 1 }, 0);
    expectInvalid({ type: "integer", minimum: 1 }, 2.5);
    expectInvalid({ type: "number", maximum: 10 }, 11);
  });

  it("validates arrays (min/max, unique, item type)", () => {
    const arrayOfInts = {
      type: "array",
      items: { type: "integer", minimum: 1 },
      minItems: 2,
      maxItems: 6,
      uniqueItems: true,
    };
    expectValid(arrayOfInts, [1, 2, 3]);
    expectInvalid(arrayOfInts, [1]);
    expectInvalid(arrayOfInts, [1, 2, 2]);
    expectInvalid(arrayOfInts, [1, "two"]);
    expectInvalid(arrayOfInts, [1, 2, 3, 4, 5, 6, 7]);
  });

  it("enforces patterns", () => {
    const uuid = {
      type: "string",
      pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    };
    expectValid(uuid, "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c");
    expectInvalid(uuid, "not-a-uuid");
  });

  it("resolves oneOf branches (PMID number, PMID string, paper UUID)", () => {
    const schema = tools.find((t) => t.name === "get_paper")?.inputSchema;
    expect(schema).toBeDefined();
    expectValid(schema!, { reference: 174596 });
    expectValid(schema!, { reference: "174596" });
    expectValid(schema!, { reference: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c" });
    expectInvalid(schema!, { reference: "not a reference" });
    expectInvalid(schema!, { reference: 0 });
  });
});

describe("validateInput — registered EvidenceOS tool schemas", () => {
  it.each(tools.map((tool) => tool.name))("validates %s input strictly", (name) => {
    const schema = tools.find((tool) => tool.name === name)?.inputSchema;
    expect(schema).toBeDefined();
    // Schemas must be flagged to reject extra keys.
    expect(schema?.additionalProperties).toBe(false);
  });

  it("rejects add_paper_to_review without required fields", () => {
    const schema = tools.find((t) => t.name === "add_paper_to_review")!.inputSchema;
    expectInvalid(schema!, { review_id: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c" });
    expectInvalid(schema!, { pmid: 1 });
    expectValid(schema!, {
      review_id: "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c",
      pmid: 174596,
    });
  });

  it("rejects compare_papers with too few, too many, or duplicate references", () => {
    const schema = tools.find((t) => t.name === "compare_papers")!.inputSchema;
    expectInvalid(schema!, { references: [1] });
    expectInvalid(schema!, { references: [1, 2, 2] });
    expectInvalid(schema!, { references: [1, 2, 3, 4, 5, 6, 7] });
    expectValid(schema!, { references: [174596, 74576] });
  });

  it("rejects search_literature with an empty query", () => {
    const schema = tools.find((t) => t.name === "search_literature")!.inputSchema;
    expectInvalid(schema!, { query: "" });
    expectInvalid(schema!, {});
    expectValid(schema!, { query: "metformin type 2 diabetes", page_size: 25 });
  });
});
