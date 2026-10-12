import { describe, expect, it } from "vitest";
import { accountName, formatPhone, normalisePhone, phoneOfAccount } from "./phone";

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

describe("account names", () => {
  it("writes an Indian number as its ten digits, the way it is typed in the console", () => {
    expect(accountName("+919876543210")).toBe("9876543210@ceeq.student");
    expect(phoneOfAccount("9876543210@ceeq.student")).toBe("+919876543210");
  });

  it("keeps the country code for any other number, so it cannot be taken for an Indian one", () => {
    // +65 9123 4567 has ten digits in all and starts with 6, like an Indian mobile.
    expect(accountName("+6591234567")).toBe("006591234567@ceeq.student");
    expect(phoneOfAccount("006591234567@ceeq.student")).toBe("+6591234567");
    expect(accountName("+16505551234")).toBe("0016505551234@ceeq.student");
  });

  it("gives the same account however the student types their number", () => {
    const typed = ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "91 98765 43210"];
    expect(new Set(typed.map((t) => accountName(normalisePhone(t)!)))).toEqual(new Set(["9876543210@ceeq.student"]));
  });

  it("reads no number from an account that is not one of ours", () => {
    expect(phoneOfAccount("someone@example.com")).toBe("");
    expect(phoneOfAccount("teacher@ceeq.student")).toBe("");
    expect(phoneOfAccount(null)).toBe("");
  });
});

describe("formatPhone", () => {
  it("spaces an Indian number for reading", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+16505551234")).toBe("+16505551234");
  });
});
