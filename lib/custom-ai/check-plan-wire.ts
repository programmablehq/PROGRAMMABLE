const fixtureFields = ["id", "source", "contract", "role", "arguments", "functions", "allowReceive", "allowFallback", "surfaceRequirements"] as const;
const childFields = [...fixtureFields, "parent", "creation", "nonce", "value"] as const;
const stepFields = ["id", "contract", "signature", "arguments", "from", "afterSeconds", "value", "read", "requirementIds", "expect"] as const;
const invalid = (): never => { throw new TypeError("Return a complete bounded contract-check declaration."); };

/** A lossless wire encoding only. The expanded declaration still passes the
 * existing independent blueprint, coverage, ABI and deployment validators. */
export function decodeGeneralCheckDeclaration(value: unknown): unknown {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 96_000) return invalid();
  const raw = JSON.parse(value) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const record = raw as Record<string, unknown>;
  // Keep saved integrations and test fixtures using the original object form.
  if (!Object.hasOwn(record, "format")) return record;
  if (record.format !== "compact-v1") return invalid();
  const rows = (value: unknown, fields: readonly string[], optionalValue = false) => {
    if (!Array.isArray(value)) return invalid();
    return value.map(row => {
      if (!Array.isArray(row) || row.length !== fields.length && !(optionalValue && row.length === fields.length + 1)) return invalid();
      const object = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
      if (optionalValue && row.length > fields.length && row.at(-1) !== null) object.value = row.at(-1);
      return object;
    });
  };
  const { format, ...body } = record; void format;
  return {
    ...body,
    contracts: rows(body.contracts, fixtureFields, true),
    steps: rows(body.steps, stepFields),
    ...(Object.hasOwn(body, "constructorChildren") ? { constructorChildren: rows(body.constructorChildren, childFields) } : {}),
  };
}

export const generalCheckRowRules = `contracts rows are exactly [${fixtureFields.join(",")}]. A tenth item may contain the optional constructor value, or null to omit it.
constructorChildren rows, when needed, are exactly [${childFields.join(",")}].
steps rows are exactly [${stepFields.join(",")}]. Use actual values at every position, including empty argument/requirement arrays and false/true read flags. expect remains the complete object with status and any returns, swapFeePpm or events. world, allowedCalls, compilerProfile and deployment keep their documented object/array forms.
This encoding must retain every agreed contract, function, constructor input, example, boundary, requirement ID and event assertion. Never shorten a signature or value, drop a check, invent defaults or return source code. Return compact-v1 only.`;

export const generalCheckPlanningWireRules = `Use the lossless compact-v1 wire format for generalChecks. It is still one JSON-encoded string, with format:'compact-v1'. The canonical fields described above are checked AFTER expansion; encode contracts and steps as rows rather than repeating their field names.
${generalCheckRowRules}`;
