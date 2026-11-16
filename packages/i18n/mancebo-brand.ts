/** Keep translation IDs, interpolation, vendor links and legal notices intact. */
export function brandSchedulingTranslations(translations: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(translations).map(([key, value]) => [
      key,
      value.replace(/(?<![\w./:-])Cal\.(?:diy|com)\b(?!, Inc)/g, "Mancebo.ai"),
    ])
  );
}
