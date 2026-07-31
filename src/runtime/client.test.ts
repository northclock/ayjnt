import { describe, expect, test } from "bun:test";
import { agentBasePath } from "./client.ts";

describe("agentBasePath", () => {
  test("normalizes a route and appends the default instance", () => {
    expect(agentBasePath("/support/")).toBe("support/default");
  });

  test("encodes an instance as one safe path segment", () => {
    expect(agentBasePath("projects/reviewer", "team/a #1")).toBe(
      "projects/reviewer/team%2Fa%20%231",
    );
  });

  test("rejects an empty route", () => {
    expect(() => agentBasePath("///")).toThrow("at least one path segment");
  });
});
