/**
 * BibliothecaDAO Marketplace: Domain Utility Shim
 */

export function address(val) {
  if (!val) return "0x0";
  let hex = String(val).toLowerCase();
  if (!hex.startsWith("0x")) hex = "0x" + hex;
  try {
    return "0x" + BigInt(hex).toString(16).padStart(64, "0");
  } catch {
    return hex;
  }
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
