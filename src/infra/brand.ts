export type ProductBrand = "openclaw" | "mindfly";

function normalizeBrand(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function resolveProductBrand(env: NodeJS.ProcessEnv = process.env): ProductBrand {
  const brand =
    normalizeBrand(env.OPENCLAW_BRAND) ||
    normalizeBrand(env.MINDFLY_BRAND) ||
    (normalizeBrand(env.MINDFLY) ? "mindfly" : "");
  return brand === "mindfly" ? "mindfly" : "openclaw";
}

export function isMindflyBrand(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveProductBrand(env) === "mindfly";
}
