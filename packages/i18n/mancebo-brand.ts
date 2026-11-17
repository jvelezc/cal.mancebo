/** Keep translation IDs, interpolation, vendor links and legal notices intact. */
export function brandSchedulingTranslations(translations: Record<string, string>): Record<string, string>;
export function brandSchedulingTranslations(translations: Record<string, unknown>): Record<string, unknown>;
export function brandSchedulingTranslations(translations: Record<string, unknown>): Record<string, unknown> {
  const brandValue = (value: unknown): unknown => {
    if (typeof value === "string")
      return value.replace(/(?<![\w./:-])Cal\.(?:diy|com)\b(?!, Inc)/g, "Mancebo.ai");
    if (Array.isArray(value)) return value.map(brandValue);
    if (value && typeof value === "object")
      return brandSchedulingTranslations(Object.fromEntries(Object.entries(value)));
    return value;
  };
  return Object.fromEntries(Object.entries(translations).map(([key, value]) => [key, brandValue(value)]));
}
