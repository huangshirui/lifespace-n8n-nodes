import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
} from 'n8n-workflow';
import { withNativeDiscoveryCompatibility } from '../shared/runtimeDiscoveryCompat';
import { LifeSpaceWorkflow as BaseLifeSpaceWorkflow } from './LifeSpaceWorkflow.node';

type DesignTimeMethod = (this: ILoadOptionsFunctions, ...args: unknown[]) => unknown;
type MethodCollection = Record<string, DesignTimeMethod>;

function wrapMethods(value: unknown): MethodCollection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: MethodCollection = {};
  for (const [name, candidate] of Object.entries(source)) {
    if (typeof candidate !== 'function') continue;
    const method = candidate as DesignTimeMethod;
    result[name] = async function(this: ILoadOptionsFunctions, ...args: unknown[]) {
      return Reflect.apply(method, withNativeDiscoveryCompatibility(this), args);
    };
  }
  return result;
}

export class LifeSpaceWorkflowCompat extends BaseLifeSpaceWorkflow {
  constructor() {
    super();
    const node = this as unknown as {
      methods?: {
        loadOptions?: unknown;
        resourceMapping?: unknown;
        [key: string]: unknown;
      };
    };
    if (!node.methods) return;
    const loadOptions = wrapMethods(node.methods.loadOptions);
    const resourceMapping = wrapMethods(node.methods.resourceMapping);
    node.methods = {
      ...node.methods,
      ...(loadOptions ? { loadOptions } : {}),
      ...(resourceMapping ? { resourceMapping } : {}),
    };
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return BaseLifeSpaceWorkflow.prototype.execute.call(withNativeDiscoveryCompatibility(this));
  }
}
