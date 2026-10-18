/** Indian states and union territories, as the National CSR Portal names them, plus CIN rules. */

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;
export type IndianState = (typeof INDIAN_STATES)[number];

/** Spend the portal records against the whole country rather than one state. */
export const PAN_INDIA = "Pan India";

const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  pondicherry: "Puducherry",
  "nct of delhi": "Delhi",
  "new delhi": "Delhi",
  uttaranchal: "Uttarakhand",
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  "pan india": PAN_INDIA,
  "pan-india": PAN_INDIA,
  "all india": PAN_INDIA,
};

const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]+/g, " ").trim();

/** The canonical name for a state as written in a CSV ("ORISSA", "Tamil nadu", "PAN INDIA"), or the input trimmed. */
export function normaliseState(input: string): string {
  const key = squash(input);
  if (!key) return "";
  if (STATE_ALIASES[key]) return STATE_ALIASES[key];
  return INDIAN_STATES.find((s) => squash(s) === key) ?? input.trim();
}

// Corporate Identification Number: listing status, industry code, state, year, company type, number.
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

export function isValidCin(cin: string | null | undefined): cin is string {
  return Boolean(cin && CIN.test(cin));
}

/** The state codes MCA uses inside CINs. Odisha is "OR" and Uttarakhand "UR" for historical reasons. */
const CIN_STATES: Record<string, string> = {
  AN: "Andaman and Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CH: "Chandigarh",
  CT: "Chhattisgarh",
  DD: "Dadra and Nagar Haveli and Daman and Diu",
  DL: "Delhi",
  DN: "Dadra and Nagar Haveli and Daman and Diu",
  GA: "Goa",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  HR: "Haryana",
  JH: "Jharkhand",
  JK: "Jammu and Kashmir",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MH: "Maharashtra",
  ML: "Meghalaya",
  MN: "Manipur",
  MP: "Madhya Pradesh",
  MZ: "Mizoram",
  NL: "Nagaland",
  OR: "Odisha",
  PB: "Punjab",
  PY: "Puducherry",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TG: "Telangana",
  TN: "Tamil Nadu",
  TR: "Tripura",
  UP: "Uttar Pradesh",
  UR: "Uttarakhand",
  WB: "West Bengal",
};

/** The state where a company is registered, read from its CIN. */
export function cinState(cin: string | null | undefined): string | null {
  return isValidCin(cin) ? (CIN_STATES[cin.slice(6, 8)] ?? null) : null;
}

/** "L" in the first place means the company is listed on a stock exchange. */
export function cinIsListed(cin: string | null | undefined): boolean {
  return isValidCin(cin) && cin.startsWith("L");
}
