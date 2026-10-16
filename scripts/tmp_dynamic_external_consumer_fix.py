from pathlib import Path
import re

p = Path('nodes/LifeSpace/LifeSpace.node.ts')
s = p.read_text()
s, count = re.subn(
    r"\nasync function mutationVersion\(\n  context: IExecuteFunctions,\n  itemIndex: number,\n  baseUrl: string,\n  recordPath: string,\n\): Promise<number> \{\n  return configuredMutationVersion\(context, itemIndex\)\n    \?\? currentRecordVersion\(context, itemIndex, baseUrl, recordPath\);\n\}\n",
    "\n",
    s,
    count=1,
)
if count != 1:
    raise SystemExit(f'expected to remove one unused mutationVersion, got {count}')
p.write_text(s)

p = Path('nodes/lifespaceDiscovery.ts')
s = p.read_text()
old = """    if (error instanceof NodeOperationError) throw error;
    throw new NodeApiError(context.getNode(), error as JsonObject);"""
new = """    if (error instanceof NodeOperationError) {
      throw new NodeOperationError(context.getNode(), error.message);
    }
    throw new NodeApiError(context.getNode(), error as JsonObject);"""
if old not in s:
    raise SystemExit('missing raw NodeOperationError rethrow')
s = s.replace(old, new, 1)
old_native = """type NativeSemanticDetail = {
  key: string;
  version: number;"""
new_native = """type NativeSemanticDetail = {
  key: string;
  origin?: never;
  version: number;"""
if old_native not in s:
    raise SystemExit('missing NativeSemanticDetail head')
s = s.replace(old_native, new_native, 1)
p.write_text(s)

p = Path('nodes/agent/lifeSpaceToolFactory.ts')
s = p.read_text()
old_import = """  DiscoveryModel,
  modelSupportsRuntimeOperation,
} from '../lifespaceDiscovery';"""
new_import = """  DiscoveryModel,
} from '../lifespaceDiscovery';
import { modelSupportsRuntimeOperation } from '../lifespaceDiscovery';"""
if old_import not in s:
    raise SystemExit('missing type-only runtime operation import')
s = s.replace(old_import, new_import, 1)
p.write_text(s)

print('lint and TypeScript corrections staged')
