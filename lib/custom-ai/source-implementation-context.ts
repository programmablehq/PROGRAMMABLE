import type { GeneralCheckBlueprint } from "./check-blueprint";
import type { ContractProject } from "./contract-project";
import { compactDependencyCode, libraryDeclarationReference } from "./dependency-source-context";
import { resolveInlineLibraries } from "./inline-libraries";

type Reference = { source: string; functions: string[] };

/** A writing view, never a compiler input or a replacement check plan.
 * Keep the whole intent, ABI and deployment, but leave fixture execution in
 * the independent checker. Show the closest immutable implementation in full
 * and other imports as declarations. Completed sibling files are exact code. */
export function sourceImplementationContext(input: {
  blueprint: GeneralCheckBlueprint;
  dependencies: ContractProject["sources"];
  references: readonly Reference[];
  construction: readonly { source: string; initializationSources: string[] }[];
}, path: string, completed: ContractProject["sources"]) {
  const { blueprint, dependencies } = input;
  const active = blueprint.scenarios.contracts.filter(contract => contract.source === path);
  if (!active.length) throw new TypeError("Source path is outside the frozen contract graph.");
  const signatures = new Set(active.flatMap(contract => contract.functions));
  const ranked = input.references.map(reference => ({ source: reference.source,
    matches: reference.functions.filter(signature => signatures.has(signature)).length }));
  const largest = Math.max(0, ...ranked.map(reference => reference.matches));
  const templates = new Set(ranked.filter(reference => reference.matches > 0 && reference.matches === largest).map(reference => reference.source));
  const roots = Object.fromEntries([...templates].filter(name => dependencies[name]).map(name => [name, dependencies[name]]));
  const closure = resolveInlineLibraries(roots, dependencies, blueprint.compiler);
  // Unknown/new interfaces can use the full declaration catalog. Recognized
  // implementations need only their exact transitive imports, plus the path
  // catalog for any additional explicitly chosen library.
  const visibleDependencies = templates.size ? closure : dependencies;
  const { scenarios, ...fixedChecks } = blueprint;
  return {
    fixedChecks: { ...fixedChecks,
      ...(blueprint.production ? { production: { id: blueprint.production.id } } : {}),
      interfaces: scenarios.contracts,
      constructorChildren: scenarios.constructorChildren ?? [],
    },
    activeSource: path,
    dependencySources: Object.fromEntries(Object.entries(visibleDependencies).map(([name, file]) => [name, {
      content: templates.has(name) ? compactDependencyCode(file.content) : libraryDeclarationReference(file.content),
    }])),
    dependencySourceView: { format: "component-declarations-and-template-v1", completeTemplatePaths: [...templates] },
    availableImportPaths: Object.keys(dependencies),
    initializationSources: input.construction.filter(value => !templates.has(value.source) && value.initializationSources.length)
      .map(value => ({ source: value.source, functions: value.initializationSources })),
    completedSources: structuredClone(completed),
  };
}
