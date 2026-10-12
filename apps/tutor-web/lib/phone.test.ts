import { describe, expect, it } from "vitest";
import { formatPhone, normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it("takes a ten-digit number as an Indian mobile, however it is typed", () => {
    expect(normalisePhone("9876543210")).toBe("+919876543210");
    expect(normalisePhone(" 98765 43210 ")).toBe("+919876543210");
    expect(normalisePhone("098765-43210")).toBe("+919876543210");
    expect(normalisePhone("91 98765 43210")).toBe("+919876543210");
    expect(normalisePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("accepts another country only with its code", () => {
    expect(normalisePhone("+1 (650) 555-1234")).toBe("+16505551234");
    expect(normalisePhone("6505551234")).toBe("+916505551234");
  });

  it("rejects what cannot be a mobile number", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("1234567890")).toBeNull(); // Indian mobiles start with 6 to 9
    expect(normalisePhone("98765432101")).toBeNull();
    expect(normalisePhone("+12")).toBeNull();
    expect(normalisePhone("hello")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("spaces an Indian number for reading", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+16505551234")).toBe("+16505551234");
  });
});
