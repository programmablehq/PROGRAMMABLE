export function developerApiKeysInitialSection(
  searchParams: Record<string, string | string[] | undefined>,
) {
  if (searchParams.view === "history") return "history" as const;
  return searchParams.start === "custom"
    ? "launch" as const
    : "keys" as const;
}
