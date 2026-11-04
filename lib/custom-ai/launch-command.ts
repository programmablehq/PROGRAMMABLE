/** Only standalone requests can skip the planner. Questions, quoted text and
 * changes still go through the normal chat; this never authorizes a signature. */
export function directLaunchCommand(content: string): "de" | "en" | undefined {
  const text = content.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ")
    .replace(/[.!?]+$/u, "").replace(/^(?:(?:ok(?:ay)?|hey|ja|yes|please|bitte)[,!. ]+)+/u, "");
  if (/^(?:(?:can|could) you |let(?:'|’)s )?launch(?: (?:it|this|the coin|my coin|this coin|the token|my token|this token|the hook|my hook|this hook))?(?: now)?(?: please)?$/u.test(text)) return "en";
  if (/^(?:launch(?:e)?(?: (?:ihn|es|das|(?:den|diesen|meinen) (?:coin|token|hook)))?(?: jetzt)?|starte (?:ihn|es|das|(?:den|diesen|meinen) (?:coin|token|hook))(?: jetzt)?|lass(?: uns)?(?: (?:ihn|es|das|(?:den|diesen|meinen) (?:coin|token|hook)))?(?: jetzt)? launchen)(?: bitte)?$/u.test(text)) return "de";
  return undefined;
}
