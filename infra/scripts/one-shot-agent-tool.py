from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = ROOT / path
    text = target.read_text()
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    target.write_text(text.replace(before, after, 1))


# Preserve the complete Core 0.35 query projection in the shared n8n Discovery model.
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "  ILoadOptionsFunctions,\n  JsonObject,\n",
    "  ILoadOptionsFunctions,\n  ISupplyDataFunctions,\n  JsonObject,\n",
    "supply-data import",
)

query_types = """export type DiscoveryQueryFilter = {
  field: string;
  parameter: string;
  mode: 'exact' | 'enum-set';
  range?: { fromParameter: string; toParameter: string };
  acceptsCurrentActorPersonAlias?: 'me';
};

export type DiscoveryQuerySearch = {
  parameter: string;
  minLength: number;
  maxLength: number;
};

export type DiscoveryQueryPagination = {
  limit: { parameter: string; minimum: number; maximum: number; default: number };
  cursor: { parameter: string; type: 'string' };
};

"""
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "export type DiscoveryModel = {\n",
    query_types + "export type DiscoveryModel = {\n",
    "query metadata types",
)

replace_once(
    "nodes/lifespaceDiscovery.ts",
    "    searchable: string[];\n    filterable: string[];\n    sortable: string[];\n    comparisons?: DiscoveryComparison[];\n",
    "    searchable: string[];\n    filterable: string[];\n    sortable: string[];\n    search: DiscoveryQuerySearch | null;\n    filters: DiscoveryQueryFilter[];\n    comparisons?: DiscoveryComparison[];\n",
    "DiscoveryModel search and filters",
)

replace_once(
    "nodes/lifespaceDiscovery.ts",
    "      default: string[];\n      envelopeFields: string[];\n    };\n  };\n",
    "      default: string[];\n      envelopeFields: string[];\n      nullPlacement: 'last';\n      genericValues: string[];\n    };\n    pagination: DiscoveryQueryPagination;\n  };\n",
    "DiscoveryModel sort and pagination",
)

# Semantic detail mirrors the Core progressive static DTO.
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "    searchable: string[];\n    filterable: string[];\n    sortable: string[];\n    comparisons?: DiscoveryComparison[];\n    capabilityQueries?: DiscoveryCapabilityQuery[];\n    sort: {\n      parameter: 'sort';\n",
    "    searchable: string[];\n    filterable: string[];\n    sortable: string[];\n    search: DiscoveryQuerySearch | null;\n    filters: DiscoveryQueryFilter[];\n    comparisons?: DiscoveryComparison[];\n    capabilityQueries?: DiscoveryCapabilityQuery[];\n    sort: {\n      parameter: 'sort';\n",
    "SemanticDetail search and filters",
)
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "      genericDefault: string[];\n      envelopeFields: string[];\n    };\n  };\n  actions: DiscoveryAction[];\n",
    "      genericDefault: string[];\n      envelopeFields: string[];\n      nullPlacement: 'last';\n      genericValues: string[];\n    };\n    pagination: DiscoveryQueryPagination;\n  };\n  actions: DiscoveryAction[];\n",
    "SemanticDetail sort and pagination",
)

# Inventory stubs carry stable platform defaults so design-time selectors stay complete.
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "      searchable: [],\n      filterable: [],\n      sortable: [],\n      comparisons: [],\n",
    "      searchable: [],\n      filterable: [],\n      sortable: [],\n      search: null,\n      filters: [],\n      comparisons: [],\n",
    "stub search and filters",
)
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "        default: ['createdAt:desc'],\n        envelopeFields: ['createdAt', 'updatedAt'],\n      },\n    },\n",
    "        default: ['createdAt:desc'],\n        envelopeFields: ['createdAt', 'updatedAt'],\n        nullPlacement: 'last',\n        genericValues: ['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'],\n      },\n      pagination: {\n        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },\n        cursor: { parameter: 'cursor', type: 'string' },\n      },\n    },\n",
    "stub sort and pagination",
)

replace_once(
    "nodes/lifespaceDiscovery.ts",
    "      searchable: detail.query.searchable,\n      filterable: detail.query.filterable,\n      sortable: detail.query.sortable,\n      comparisons: detail.query.comparisons ?? [],\n",
    "      searchable: detail.query.searchable,\n      filterable: detail.query.filterable,\n      sortable: detail.query.sortable,\n      search: detail.query.search,\n      filters: detail.query.filters,\n      comparisons: detail.query.comparisons ?? [],\n",
    "detailed model search and filters",
)
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "        default: detail.query.sort.genericDefault,\n        envelopeFields: detail.query.sort.envelopeFields,\n      },\n    },\n",
    "        default: detail.query.sort.genericDefault,\n        envelopeFields: detail.query.sort.envelopeFields,\n        nullPlacement: detail.query.sort.nullPlacement,\n        genericValues: detail.query.sort.genericValues,\n      },\n      pagination: detail.query.pagination,\n    },\n",
    "detailed model sort and pagination",
)

# Widen only the internal progressive-discovery transport to the n8n supplyData context.
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "  context: ILoadOptionsFunctions | IExecuteFunctions,\n  baseUrl: string,\n  path: string,\n): Promise<T> {\n",
    "  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,\n  baseUrl: string,\n  path: string,\n): Promise<T> {\n",
    "authenticatedGet context",
)
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "async function requestProgressiveRuntimeDiscovery(\n  context: ILoadOptionsFunctions | IExecuteFunctions,\n",
    "async function requestProgressiveRuntimeDiscovery(\n  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,\n",
    "progressive context",
)

# Selected detail is bound to the inventory identity used to construct the tool.
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "        const response = await authenticatedGet<SemanticDetailResponse>(context, baseUrl, path);\n        selectedDetail = response.data;\n",
    "        const response = await authenticatedGet<SemanticDetailResponse>(context, baseUrl, path);\n        const detail = response.data;\n        if (!detail || detail.key !== selectedIdentity.key || detail.version !== selectedIdentity.version || detail.schemaHash !== selectedIdentity.schemaHash) {\n          throw new NodeOperationError(\n            context.getNode(),\n            `LifeSpace Runtime Discovery semantic detail identity drifted for ${selectedIdentity.key}`,\n          );\n        }\n        selectedDetail = detail;\n",
    "progressive semantic identity guard",
)

agent_loader = """
export async function loadAgentToolRuntimeDiscovery(
  context: ISupplyDataFunctions,
  baseUrl: string,
  spaceId: string,
  modelKey: string,
): Promise<DiscoveryResponse> {
  const progressive = await requestProgressiveRuntimeDiscovery(context, baseUrl, { spaceId, modelKey });
  if (!progressive) {
    throw new NodeOperationError(
      context.getNode(),
      'LifeSpace Tool requires Progressive Runtime Discovery from Core Kernel 0.35.0 or newer',
    );
  }
  const space = discoverySpace(progressive, spaceId);
  const model = discoveryModel(progressive, spaceId, modelKey);
  if (!space || !model || !model.query.pagination || !Array.isArray(model.query.filters)) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace Runtime Discovery did not return complete semantic detail for ${modelKey}`,
    );
  }
  return progressive;
}

"""
replace_once(
    "nodes/lifespaceDiscovery.ts",
    "export function discoverySpace(discovery: DiscoveryResponse, spaceId: string): DiscoverySpace | undefined {\n",
    agent_loader + "export function discoverySpace(discovery: DiscoveryResponse, spaceId: string): DiscoverySpace | undefined {\n",
    "agent supply discovery loader",
)

# Register the native AiTool sub-node and add the single runtime dependency it needs.
package_path = ROOT / "package.json"
package_json = json.loads(package_path.read_text())
package_json.setdefault("dependencies", {})["@langchain/core"] = "1.2.8"
nodes = package_json["n8n"]["nodes"]
tool_node = "dist/nodes/LifeSpaceTool/LifeSpaceTool.node.js"
if tool_node not in nodes:
    nodes.append(tool_node)
package_path.write_text(json.dumps(package_json, indent=2) + "\n")

# Reuse the public LifeSpace mark in the new Tool node package output.
source_dir = ROOT / "nodes" / "LifeSpace"
target_dir = ROOT / "nodes" / "LifeSpaceTool"
target_dir.mkdir(parents=True, exist_ok=True)
for name in ["lifespace.svg", "lifespace.dark.svg"]:
    shutil.copyfile(source_dir / name, target_dir / name)

# Update current user-facing compatibility guidance without claiming a release yet.
replace_once(
    "README.md",
    "Core Kernel `0.35.0`",
    "Core Kernel `0.35.0`",
    "README Core 0.35 anchor",
)

readme = ROOT / "README.md"
text = readme.read_text()
marker = "## Compatibility\n"
if marker not in text:
    raise RuntimeError("README compatibility heading missing")
section = """## AI Agent Tool\n\n`LifeSpace Tool` is the metadata-driven AI Agent sub-node. Configure one fixed Space, Record Type and semantic operation per Tool instance, then connect multiple instances to the same n8n AI Agent. The Tool name, default description and structured AI input schema are generated from LifeSpace Progressive Runtime Discovery; hand-written descriptions are optional.\n\n- Query exposes published search/filter/comparison/local-date-window/sort/pagination semantics. Capability Query mode exposes only the capability-owned parameters and ordering that LifeSpace explicitly publishes; generic-facet composition stays narrowed until LifeSpace #228 defines it.\n- Create/Update schemas come from writable Model fields. Required fields with LifeSpace defaults are optional AI inputs, and fields the AI omits are absent from the outgoing request rather than synthesized as empty/null placeholders.\n- Delete and Action hide optimistic-concurrency `version` from the AI. The Adapter reads the current record version when required and Core remains the final authorization/concurrency/semantic authority.\n- No Task/Event/Wish-specific Tool nodes or field maps are shipped. New models become available through Discovery without source changes.\n- The ordinary `LifeSpace` workflow node remains `usableAsTool` for manually configured `$fromAI(...)` workflows, but `LifeSpace Tool` is the canonical path when the AI should receive the complete dynamic LifeSpace schema.\n\n"""
text = text.replace(marker, section + marker, 1)
readme.write_text(text)

print("Agent Tool integration transform applied")
