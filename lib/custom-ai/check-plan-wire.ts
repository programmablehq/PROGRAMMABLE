const fixtureFields = ["id", "source", "contract", "role", "arguments", "functions", "allowReceive", "allowFallback", "surfaceRequirements"] as const;
const childFields = [...fixtureFields, "parent", "creation", "nonce", "value"] as const;
const stepFields = ["id", "contract", "signature", "arguments", "from", "afterSeconds", "value", "read", "requirementIds", "expect"] as const;
const invalid = (reason="invalid-envelope"): never => { throw new TypeError(`Return a complete bounded contract-check declaration. Validation: ${reason}.`); };

/** A lossless wire encoding only. The expanded declaration still passes the
 * existing independent blueprint, coverage, ABI and deployment validators. */
export function decodeGeneralCheckDeclaration(value: unknown, interfaces:readonly {contract:string;functions:readonly string[]}[]=[]): unknown {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 96_000) return invalid();
  const raw = JSON.parse(value) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const record = raw as Record<string, unknown>;
  const expandFunctions=(fixture:Record<string,unknown>,path:string)=>{
    if(Array.isArray(fixture.functions))return fixture;
    const reference=fixture.functions as {canonical?:unknown;additional?:unknown};
    if(!reference||typeof reference!=="object"||Object.keys(reference).sort().join()!=="additional,canonical"
      ||typeof reference.canonical!=="string"||!Array.isArray(reference.additional)
      ||reference.additional.some(fn=>typeof fn!=="string"))return invalid(`${path}:invalid-canonical-interface-reference`);
    const candidates=interfaces.filter(entry=>entry.contract===reference.canonical);
    if(candidates.length!==1)return invalid(`${path}:canonical-interface-not-in-this-chain-catalog`);
    return {...fixture,functions:[...candidates[0].functions,...reference.additional]};
  };
  // Keep saved integrations and test fixtures using the original object form.
  if (!Object.hasOwn(record, "format")) return {
    ...record,...(Array.isArray(record.contracts)?{contracts:record.contracts.map((entry,index)=>expandFunctions(entry,`contracts[${index}]`))}:{}),
    ...(Array.isArray(record.constructorChildren)?{constructorChildren:record.constructorChildren.map((entry,index)=>expandFunctions(entry,`constructorChildren[${index}]`))}:{}),
  };
  if (record.format !== "compact-v1") return invalid();
  const rows = (value: unknown, fields: readonly string[], path:string, optionalValue = false) => {
    if (!Array.isArray(value)) return invalid(`${path}:expected-array`);
    return value.map((row,index) => {
      // Some providers return canonical objects even when the prompt asks
      // for compact rows. Preserve them losslessly; the full semantic
      // validator still checks every field and rejects additional fields.
      if(row&&typeof row==="object"&&!Array.isArray(row)){
        if(fields.some(field=>!Object.hasOwn(row,field))||Object.keys(row).some(field=>!fields.includes(field)&&!(optionalValue&&field==="value")))return invalid(`${path}[${index}]:expected-fields:${fields.join(",")}`);
        return path==="steps"?structuredClone(row):expandFunctions(structuredClone(row),`${path}[${index}]`);
      }
      if (!Array.isArray(row) || row.length !== fields.length && !(optionalValue && row.length === fields.length + 1)) return invalid(`${path}[${index}]:expected-${fields.length}-fields-in-order:${fields.join(",")}`);
      const object = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
      if (optionalValue && row.length > fields.length && row.at(-1) !== null) object.value = row.at(-1);
      return path==="steps"?object:expandFunctions(object,`${path}[${index}]`);
    });
  };
  const { format, ...body } = record; void format;
  return {
    ...body,
    contracts: rows(body.contracts, fixtureFields, "contracts",true),
    steps: rows(body.steps, stepFields,"steps"),
    ...(Object.hasOwn(body, "constructorChildren") ? { constructorChildren: rows(body.constructorChildren, childFields,"constructorChildren") } : {}),
  };
}

export const generalCheckRowRules = `contracts rows are exactly [${fixtureFields.join(",")}]. A tenth item may contain the optional constructor value, or null to omit it.
constructorChildren rows, when needed, are exactly [${childFields.join(",")}].
steps rows are exactly [${stepFields.join(",")}]. Use actual values at every position, including empty argument/requirement arrays and false/true read flags. expect remains the complete object with status and any returns, swapFeePpm or events. world, allowedCalls, compilerProfile and deployment keep their documented object/array forms.
When canonicalInterfaces is supplied, functions may be {canonical:'exactContractNameFromThatCatalog',additional:['function customGetter() view returns (uint256)']}. The server expands every pinned function, then validates the complete interface as usual. Use this only when the generated contract preserves that full public interface. Include all additional public functions in additional, or [] if none. This reference changes no constructor, role, surface requirement, permission or expected behavior. Unknown or other-chain catalog names are rejected. Otherwise functions stays a complete string array.
This encoding must retain every agreed contract, function, constructor input, example, boundary, requirement ID and event assertion. Never shorten a signature or value, drop a check, invent defaults or return source code. Return compact-v1 only.`;

export const generalCheckPlanningWireRules = `Use the lossless compact-v1 wire format for generalChecks. It is still one JSON-encoded string, with format:'compact-v1'. The canonical fields described above are checked AFTER expansion; encode contracts and steps as rows rather than repeating their field names.
${generalCheckRowRules}`;
