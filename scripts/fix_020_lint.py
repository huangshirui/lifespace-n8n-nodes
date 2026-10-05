from pathlib import Path

WORKFLOW_NODES = {
    'nodes/LifeSpaceConfirmAuthorization/LifeSpaceConfirmAuthorization.node.ts': 'Authorization Request · Confirm',
    'nodes/LifeSpaceDenyAuthorization/LifeSpaceDenyAuthorization.node.ts': 'Authorization Request · Deny',
    'nodes/LifeSpaceCancelAuthorization/LifeSpaceCancelAuthorization.node.ts': 'Authorization Request · Cancel',
}

TOOL_NODES = {
    'nodes/LifeSpaceRequestAuthorization/LifeSpaceRequestAuthorization.node.ts': 'Authorization Request · Request',
    'nodes/LifeSpaceConfirmAuthorizationTool/LifeSpaceConfirmAuthorizationTool.node.ts': 'Authorization Request · Confirm Tool',
    'nodes/LifeSpaceCancelAuthorizationTool/LifeSpaceCancelAuthorizationTool.node.ts': 'Authorization Request · Cancel Tool',
}


def add_subtitle(source: str, subtitle: str) -> str:
    if 'subtitle:' in source:
        return source
    marker = '    version: 1,\n'
    if marker not in source:
        raise SystemExit(f'version marker missing for {subtitle}')
    return source.replace(marker, marker + f"    subtitle: '{subtitle}',\n", 1)


def make_workflow_only_lint_compatible(source: str) -> str:
    if 'usableAsTool: true' not in source:
        marker = '    outputs: [NodeConnectionTypes.Main],\n'
        if marker not in source:
            raise SystemExit('main output marker missing')
        source = source.replace(marker, marker + '    usableAsTool: true,\n', 1)
    if 'delete description.usableAsTool;' not in source:
        marker = '  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {'
        constructor = """  constructor() {
    const description = this.description as INodeTypeDescription & { usableAsTool?: boolean };
    delete description.usableAsTool;
    this.description = description;
  }

"""
        if marker not in source:
            raise SystemExit('execute marker missing')
        source = source.replace(marker, constructor + marker, 1)
    return source


for file_name, subtitle in WORKFLOW_NODES.items():
    path = Path(file_name)
    source = add_subtitle(path.read_text(), subtitle)
    source = make_workflow_only_lint_compatible(source)
    source = source.replace('who confirmed this request.', 'who confirmed this request')
    source = source.replace('who denied this request.', 'who denied this request')
    path.write_text(source)

for file_name, subtitle in TOOL_NODES.items():
    path = Path(file_name)
    source = add_subtitle(path.read_text(), subtitle)
    path.write_text(source)
