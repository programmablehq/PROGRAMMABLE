export function developerApiKeysInitialSection(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return searchParams.view === "history" || searchParams.start === "custom"
    ? "history" as const
    : "keys" as const;
}
