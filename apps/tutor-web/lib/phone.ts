// Mobile numbers as students type them. Ceeq's students are in India, so a
// plain ten-digit number is taken as Indian; any other country needs its "+" code.

/** The number in international form (+919876543210), or null if it cannot be one. */
export function normalisePhone(input: string): string | null {
  const text = input.trim();
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  // 98765 43210, 098765 43210 and 91 98765 43210 are all the same Indian mobile.
  const local = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** For showing a number back to the student: "+91 98765 43210". Other countries are left as they are. */
export function formatPhone(phone: string): string {
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}
