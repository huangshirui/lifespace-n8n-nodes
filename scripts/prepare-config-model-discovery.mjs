import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, oldValue, newValue, label) {
  const count = content.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return content.replace(oldValue, newValue);
}

// 1) Credential test must authenticate the actual lsp_agt_* credential.
{
  const path = 'credentials/LifeSpaceAgentExecutionApi.credentials.ts';
  let content = read(path);
  content = replaceOnce(content, "      url: '/status',", "      url: '/me',", 'Agent credential test endpoint');
  write(path, content);
}

// 2) Add Application/credential-scoped static model discovery helpers.
{
  const path = 'nodes/lifespaceDiscovery.ts';
  let content = read(path);
  const responseAnchor = `type SemanticDetailResponse = {\n  data: SemanticDetail;\n};\n`;
  const responseInsert = `${responseAnchor}\ntype ConfigurationInventoryModel = InventoryModel & {\n  access: DiscoveryAccess[];\n};\n\ntype ConfigurationInventoryResponse = {\n  data: {\n    semanticDetailPathTemplate: string;\n    models: ConfigurationInventoryModel[];\n  };\n};\n\ntype ConfigurationSemanticDetailResponse = {\n  data: {\n    access: DiscoveryAccess[];\n    model: SemanticDetail;\n  };\n};\n`;
  content = replaceOnce(content, responseAnchor, responseInsert, 'Configuration discovery response types');

  const insertBefore = `async function requestProgressiveRuntimeDiscovery(\n`;
  const helpers = `export async function loadConfigurationModelInventory(\n  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,\n  transport: DiscoveryTransport,\n): Promise<DiscoveryModel[]> {\n  let response: ConfigurationInventoryResponse;\n  try {\n    response = await authenticatedGet<ConfigurationInventoryResponse>(\n      context,\n      transport.baseUrl,\n      '/me/_discovery/models',\n      transport,\n    );\n  } catch (error) {\n    throw new NodeApiError(context.getNode(), error as JsonObject);\n  }\n\n  if (!response?.data || !Array.isArray(response.data.models)) {\n    throw new NodeOperationError(\n      context.getNode(),\n      'LifeSpace configuration model discovery returned an invalid response',\n    );\n  }\n\n  return response.data.models.map((identity) => stubModel(identity, identity.access));\n}\n\nexport async function loadConfigurationModelSemanticDetail(\n  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,\n  modelKey: string,\n  transport: DiscoveryTransport,\n): Promise<DiscoveryModel> {\n  let response: ConfigurationSemanticDetailResponse;\n  try {\n    response = await authenticatedGet<ConfigurationSemanticDetailResponse>(\n      context,\n      transport.baseUrl,\n      \`/me/_discovery/models/\${encodeURIComponent(modelKey)}\`,\n      transport,\n    );\n  } catch (error) {\n    throw new NodeApiError(context.getNode(), error as JsonObject);\n  }\n\n  const detail = response?.data?.model;\n  const access = response?.data?.access;\n  if (\n    !detail\n    || detail.key !== modelKey\n    || !Array.isArray(access)\n    || access.some((value) => !['read', 'write', 'manage'].includes(value))\n  ) {\n    throw new NodeOperationError(\n      context.getNode(),\n      \`LifeSpace configuration model discovery returned invalid semantic detail for \${modelKey}\`,\n    );\n  }\n\n  return detailedModel(detail, access);\n}\n\n`;
  content = replaceOnce(content, insertBefore, `${helpers}${insertBefore}`, 'Configuration discovery helpers');
  write(path, content);
}

// 3) Make Agent Tool configuration independent of legacy authorityMode and Space Data Grant.
{
  const path = 'nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts';
  let content = read(path);

  content = replaceOnce(
    content,
    `  IHttpRequestOptions,\n  INodeExecutionData,\n  INodeProperties,\n`,
    `  IHttpRequestOptions,\n  ILoadOptionsFunctions,\n  INodeExecutionData,\n  INodeProperties,\n  INodePropertyOptions,\n`,
    'Agent Tool n8n type imports',
  );

  content = replaceOnce(
    content,
    `import type { AgentToolConfig, AgentToolRequest, AgentToolSchema } from '../agent/lifeSpaceToolFactory';\nimport { decodeAgentToolSemanticSnapshot } from '../agent/lifeSpaceToolSnapshot';\n`,
    `import type { AgentToolConfig, AgentToolRequest, AgentToolSchema } from '../agent/lifeSpaceToolFactory';\nimport {\n  decodeAgentToolSemanticSnapshot,\n  encodeAgentToolSemanticSnapshot,\n} from '../agent/lifeSpaceToolSnapshot';\nimport {\n  decodeRecordTypeSelector,\n  loadConfigurationModelInventory,\n  loadConfigurationModelSemanticDetail,\n  loadOptionParameter,\n  loadRuntimeDiscoveryInventory,\n  type DiscoveryModel,\n  type DiscoveryTransport,\n} from '../lifespaceDiscovery';\n`,
    'Agent Tool configuration discovery imports',
  );

  content = replaceOnce(
    content,
    `type AgentRuntimeContext = IExecuteFunctions | ISupplyDataFunctions;\n`,
    `type AgentRuntimeContext = IExecuteFunctions | ISupplyDataFunctions;\ntype AgentConfigurationContext = AgentRuntimeContext | ILoadOptionsFunctions;\n`,
    'Agent configuration context type',
  );

  const constantsAnchor = `const FROM_AI_KEY = /\\$fromAI\\s*\\(\\s*(['"])([A-Za-z0-9_-]{1,64})\\1/u;\n`;
  const configHelpers = `${constantsAnchor}\nasync function agentConfigurationTransport(\n  context: AgentConfigurationContext,\n  itemIndex = 0,\n): Promise<DiscoveryTransport> {\n  const credentials = await context.getCredentials('lifeSpaceAgentExecutionApi', itemIndex);\n  const baseUrl = delegatedAgentCoreBaseUrl(context, credentials);\n  return {\n    baseUrl,\n    request: async (options) => await context.helpers.httpRequestWithAuthentication.call(\n      context,\n      'lifeSpaceAgentExecutionApi',\n      options,\n    ),\n  };\n}\n\nfunction modelSupportsConfigurationOperation(model: DiscoveryModel, operation: string): boolean {\n  if (operation === 'query') return model.access.includes('read');\n  if (['create', 'update', 'delete'].includes(operation)) return model.access.includes('write');\n  if (operation === 'action') {\n    return model.actions.some((action) => model.access.includes(action.access));\n  }\n  return false;\n}\n\nasync function selectedAgentConfigurationModel(\n  context: ILoadOptionsFunctions,\n): Promise<{ model: DiscoveryModel; spaceId: string } | null> {\n  const spaceId = loadOptionParameter(context, 'spaceId');\n  const rawRecordType = loadOptionParameter(context, 'recordType');\n  if (!spaceId || !rawRecordType) return null;\n\n  const snapshot = decodeAgentToolSemanticSnapshot(rawRecordType);\n  if (snapshot) {\n    return snapshot.spaceId === spaceId ? { model: snapshot.model, spaceId } : null;\n  }\n\n  const selector = decodeRecordTypeSelector(rawRecordType);\n  if (!selector) return null;\n  const transport = await agentConfigurationTransport(context);\n  const model = await loadConfigurationModelSemanticDetail(context, selector.modelKey, transport);\n  return { model, spaceId };\n}\n\nasync function configuredRecordTypeValue(\n  context: AgentRuntimeContext,\n  itemIndex: number,\n): Promise<string> {\n  const spaceId = String(context.getNodeParameter('spaceId', itemIndex, '') ?? '').trim();\n  const raw = String(context.getNodeParameter('recordType', itemIndex, '') ?? '').trim();\n  const snapshot = decodeAgentToolSemanticSnapshot(raw);\n  if (snapshot) {\n    if (snapshot.spaceId !== spaceId) {\n      throw new NodeOperationError(\n        context.getNode(),\n        'The saved LifeSpace Agent Tool semantic contract belongs to a different Space. Reselect Record Type or enter the intended model key.',\n        { itemIndex },\n      );\n    }\n    return raw;\n  }\n\n  const selector = decodeRecordTypeSelector(raw);\n  if (!selector) {\n    throw new NodeOperationError(\n      context.getNode(),\n      'Record Type must be a LifeSpace model key or a saved semantic selection',\n      { itemIndex },\n    );\n  }\n  if (!/^spc_[A-Za-z0-9_-]+$/u.test(spaceId)) {\n    throw new NodeOperationError(context.getNode(), 'Space must be a valid LifeSpace spc_* ID', { itemIndex });\n  }\n\n  const transport = await agentConfigurationTransport(context, itemIndex);\n  const model = await loadConfigurationModelSemanticDetail(context, selector.modelKey, transport);\n  return encodeAgentToolSemanticSnapshot({\n    format: 1,\n    spaceId,\n    spaceName: null,\n    model,\n  });\n}\n`;
  content = replaceOnce(content, constantsAnchor, configHelpers, 'Agent configuration helper functions');

  const oldWithRecordOnly = `function withRecordOnly(property: INodeProperties): INodeProperties {\n  if (property.name === 'operation') {\n    return {\n      ...property,\n      options: (property.options ?? []).filter(\n        (option) => !('value' in option) || option.value !== 'batchCreate',\n      ),\n      displayOptions: { show: { toolResource: ['record'] } },\n    };\n  }\n  if (property.name === 'recordType') {\n    return { ...property, displayOptions: { show: { toolResource: ['record'] } } };\n  }\n  if (property.name === 'actionKey') {\n    return {\n      ...property,\n      displayOptions: { show: { toolResource: ['record'], operation: ['action'] } },\n    };\n  }\n  return property;\n}\n`;
  const newWithRecordOnly = `function withRecordOnly(property: INodeProperties): INodeProperties {\n  if (property.name === 'operation') {\n    return {\n      ...property,\n      options: (property.options ?? []).filter(\n        (option) => !('value' in option) || option.value !== 'batchCreate',\n      ),\n      displayOptions: { show: { toolResource: ['record'] } },\n    };\n  }\n  if (property.name === 'spaceId') {\n    return {\n      ...property,\n      allowArbitraryValues: true,\n      typeOptions: { loadOptionsMethod: 'getSpaces' },\n      description: 'Choose a Space currently reachable by this Agent, or enter a stable spc_* ID directly. Configuration does not grant data Authority; runtime execution rechecks Direct Agent Authority or an explicit User Delegation.',\n    };\n  }\n  if (property.name === 'recordType') {\n    return {\n      ...property,\n      allowArbitraryValues: true,\n      typeOptions: {\n        loadOptionsMethod: 'getRecordTypes',\n        loadOptionsDependsOn: ['spaceId', 'operation'],\n      },\n      displayOptions: { show: { toolResource: ['record'] } },\n      description: 'Choose a Record Type allowed by the Agent credential/Application, or enter its stable model key directly. Static model semantics are loaded independently of Space Data Grants; runtime execution still rechecks current Space Authority.',\n    };\n  }\n  if (property.name === 'actionKey') {\n    return {\n      ...property,\n      displayOptions: { show: { toolResource: ['record'], operation: ['action'] } },\n    };\n  }\n  return property;\n}\n`;
  content = replaceOnce(content, oldWithRecordOnly, newWithRecordOnly, 'Agent Space/Record Type arbitrary configuration');

  const executionSignature = `function agentExecutionContext<T extends AgentRuntimeContext>(\n  context: T,\n  itemIndex: number,\n  principalUserId: string,\n  delegationId: string,\n): T {\n`;
  const executionSignatureNew = `function agentExecutionContext<T extends AgentRuntimeContext>(\n  context: T,\n  itemIndex: number,\n  principalUserId: string,\n  delegationId: string,\n  recordTypeOverride: string | null = null,\n): T {\n`;
  content = replaceOnce(content, executionSignature, executionSignatureNew, 'Agent execution context signature');
  content = replaceOnce(
    content,
    `        if (name === 'authorityMode') return 'delegatedAgent';\n        if (name === 'principalUserId') return delegationId ? principalUserId : '';\n`,
    `        if (name === 'authorityMode') return 'delegatedAgent';\n        if (name === 'recordType' && recordTypeOverride) return recordTypeOverride;\n        if (name === 'principalUserId') return delegationId ? principalUserId : '';\n`,
    'Agent execution Record Type override',
  );

  const afterExecution = `  }) as T;\n}\n\nfunction toolInput(query: unknown): { semantic: unknown; delegationId: string } {\n`;
  const withRuntimeContext = `  }) as T;\n}\n\nasync function agentRecordExecutionContext<T extends AgentRuntimeContext>(\n  context: T,\n  itemIndex: number,\n): Promise<T> {\n  return agentExecutionContext(\n    context,\n    itemIndex,\n    '',\n    '',\n    await configuredRecordTypeValue(context, itemIndex),\n  );\n}\n\nfunction toolInput(query: unknown): { semantic: unknown; delegationId: string } {\n`;
  content = replaceOnce(content, afterExecution, withRuntimeContext, 'Agent runtime model normalization');

  const constructorTail = `      properties: agentProperties(this.description.properties),\n    };\n  }\n\n  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {\n`;
  const constructorWithMethods = `      properties: agentProperties(this.description.properties),\n    };\n\n    this.methods = {\n      ...this.methods,\n      loadOptions: {\n        ...this.methods.loadOptions,\n        async getSpaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n          const transport = await agentConfigurationTransport(this);\n          const discovery = await loadRuntimeDiscoveryInventory.call(this, transport);\n          return discovery.data.spaces.map((space) => ({\n            name: space.spaceName?.trim() || space.spaceId,\n            value: space.spaceId,\n          }));\n        },\n        async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n          const spaceId = loadOptionParameter(this, 'spaceId');\n          const operation = loadOptionParameter(this, 'operation') || 'query';\n          if (!spaceId) return [];\n\n          const transport = await agentConfigurationTransport(this);\n          const inventory = await loadConfigurationModelInventory(this, transport);\n          const candidates = inventory.filter((model) => modelSupportsConfigurationOperation(model, operation));\n          const models = await Promise.all(\n            candidates.map((model) => loadConfigurationModelSemanticDetail(this, model.key, transport)),\n          );\n\n          return models.map((model) => ({\n            name: model.display.singular?.trim() || model.key,\n            value: encodeAgentToolSemanticSnapshot({\n              format: 1,\n              spaceId,\n              spaceName: null,\n              model,\n            }),\n            description: model.description ?? undefined,\n          }));\n        },\n        async getActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n          const selected = await selectedAgentConfigurationModel(this);\n          if (!selected) return [];\n          return selected.model.actions\n            .filter((action) => selected.model.access.includes(action.access))\n            .map((action) => ({\n              name: action.key,\n              value: action.key,\n              description: \`\${action.kind} Action · requires \${action.access} access\`,\n            }));\n        },\n        async getCapabilityQueries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {\n          const selected = await selectedAgentConfigurationModel(this);\n          if (!selected) return [];\n          return (selected.model.query.capabilityQueries ?? []).map((query) => ({\n            name: \`\${query.capability} · \${query.key}\`,\n            value: query.key,\n            description: query.semantics,\n          }));\n        },\n      },\n    };\n  }\n\n  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {\n`;
  content = replaceOnce(content, constructorTail, constructorWithMethods, 'Agent Tool dedicated loadOptions methods');

  const oldSupplyStart = `  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {\n    const resource = String(this.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');\n    const auth = authorizationSettings(this, itemIndex);\n\n    if (resource === 'person') {\n      const runtime = await personRuntime(this, itemIndex);\n      const direct = customTool(\n        this,\n        itemIndex,\n        runtime,\n        async (query) => invokePerson(this, itemIndex, query, ''),\n      );\n`;
  const newSupplyStart = `  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {\n    const resource = String(this.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');\n    const runtimeContext: ISupplyDataFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, itemIndex)\n      : this;\n    const auth = authorizationSettings(runtimeContext, itemIndex);\n\n    if (resource === 'person') {\n      const runtime = await personRuntime(runtimeContext, itemIndex);\n      const direct = customTool(\n        runtimeContext,\n        itemIndex,\n        runtime,\n        async (query) => invokePerson(runtimeContext, itemIndex, query, ''),\n      );\n`;
  content = replaceOnce(content, oldSupplyStart, newSupplyStart, 'Agent Tool supplyData normalized context');

  content = content.replaceAll(`          this,\n          itemIndex,\n          direct,`, `          runtimeContext,\n          itemIndex,\n          direct,`);
  content = content.replaceAll(`async (semantic, delegationId) => invokePerson(this, itemIndex, semantic, delegationId)`, `async (semantic, delegationId) => invokePerson(runtimeContext, itemIndex, semantic, delegationId)`);
  content = replaceOnce(content, `      const runtime = await multiRuntime(this, itemIndex);`, `      const runtime = await multiRuntime(runtimeContext, itemIndex);`, 'Agent multi runtime context');
  content = replaceOnce(content, `        this,\n        itemIndex,\n        runtime,\n        async (query) => invokeMulti(this, itemIndex, query, ''),`, `        runtimeContext,\n        itemIndex,\n        runtime,\n        async (query) => invokeMulti(runtimeContext, itemIndex, query, ''),`, 'Agent multi direct context');
  content = replaceOnce(content, `          async (semantic, delegationId) => invokeMulti(this, itemIndex, semantic, delegationId),`, `          async (semantic, delegationId) => invokeMulti(runtimeContext, itemIndex, semantic, delegationId),`, 'Agent multi delegated context');
  content = replaceOnce(content, `    const directContext = agentExecutionContext(this, itemIndex, '', '');`, `    const directContext = agentExecutionContext(runtimeContext, itemIndex, '', '');`, 'Agent standard direct context');
  content = replaceOnce(content, `        this,\n        itemIndex,\n        baseTool,`, `        runtimeContext,\n        itemIndex,\n        baseTool,`, 'Agent standard authorization wrapper context');
  content = replaceOnce(content, `          const executionContext = agentExecutionContext(this, itemIndex, auth.principalUserId, delegationId);`, `          const executionContext = agentExecutionContext(runtimeContext, itemIndex, auth.principalUserId, delegationId);`, 'Agent standard delegated context');

  const oldExecuteStart = `  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {\n    const items = this.getInputData();\n    if (!items.length) return [[]];\n    const resource = String(this.getNodeParameter('toolResource', 0, 'record') ?? 'record');\n    const operation = resource === 'person' ? 'query' : currentRecordOperation(this, 0);\n    const batchSettings = resource === 'record' && ['create', 'update', 'delete'].includes(operation)\n      ? recordBatchSettings(this, 0)\n      : null;\n    const custom = resource === 'person' || batchSettings?.batchProcessing === true;\n    if (!custom) return await LifeSpaceTool.prototype.execute.call(this);\n`;
  const newExecuteStart = `  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {\n    const items = this.getInputData();\n    if (!items.length) return [[]];\n    const resource = String(this.getNodeParameter('toolResource', 0, 'record') ?? 'record');\n    const runtimeContext: IExecuteFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, 0)\n      : this;\n    const operation = resource === 'person' ? 'query' : currentRecordOperation(runtimeContext, 0);\n    const batchSettings = resource === 'record' && ['create', 'update', 'delete'].includes(operation)\n      ? recordBatchSettings(runtimeContext, 0)\n      : null;\n    const custom = resource === 'person' || batchSettings?.batchProcessing === true;\n    if (!custom) return await LifeSpaceTool.prototype.execute.call(runtimeContext);\n`;
  content = replaceOnce(content, oldExecuteStart, newExecuteStart, 'Agent execute normalized context');
  content = replaceOnce(content, `        ? await personRuntime(this, itemIndex)\n        : await multiRuntime(this, itemIndex);`, `        ? await personRuntime(runtimeContext, itemIndex)\n        : await multiRuntime(runtimeContext, itemIndex);`, 'Agent execute custom runtime context');
  content = replaceOnce(content, `            ? await invokePerson(this, itemIndex, semantic, delegationId)\n            : await invokeMulti(this, itemIndex, semantic, delegationId);`, `            ? await invokePerson(runtimeContext, itemIndex, semantic, delegationId)\n            : await invokeMulti(runtimeContext, itemIndex, semantic, delegationId);`, 'Agent execute invoke context');
  content = replaceOnce(content, `        if (authorizationSettings(this, itemIndex).enabled) {\n          response = withAuthorizationRequired(response, authorizationScope(this, itemIndex, semantic));`, `        if (authorizationSettings(runtimeContext, itemIndex).enabled) {\n          response = withAuthorizationRequired(response, authorizationScope(runtimeContext, itemIndex, semantic));`, 'Agent execute authorization context');

  write(path, content);
}

// 4) Regression: real Agent node has no saved authorityMode in editor configuration.
{
  const path = 'test/agent-discovery-direct-authority.test.mjs';
  let content = read(path);
  content = content.replace("    authorityMode: 'delegatedAgent',\n", '');
  if (content.includes("authorityMode: 'delegatedAgent'")) throw new Error('Agent editor regression still injects authorityMode');
  write(path, content);
}

// 5) Add configuration/static-semantics and direct selector regression coverage.
write('test/agent-configuration-discovery.test.mjs', `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LifeSpaceAgentTool } = require('../dist/nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.js');
const { decodeAgentToolSemanticSnapshot } = require('../dist/nodes/agent/lifeSpaceToolSnapshot.js');

const CORE_BASE = 'https://core.example.com/api/v1';

function semanticDetail() {
  return {
    key: 'event',
    version: 6,
    schemaHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    display: { singular: 'Event', plural: 'Events' },
    description: 'Calendar event',
    declaredAccess: ['read', 'write'],
    fields: [{ key: 'title', type: 'string', title: 'Title', required: true }],
    defaults: {},
    query: {
      canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        pipeline: ['search', 'filter', 'sort', 'cursor-pagination'],
        search: { fields: ['title'], minLength: 1, maxLength: 100 },
        filter: { maxDepth: 8, maxNodes: 100, targets: [] },
        sort: {
          fields: ['createdAt', 'title'],
          directions: ['asc', 'desc'],
          maxCriteria: 8,
          default: [{ field: 'createdAt', direction: 'desc' }],
          nullPlacement: 'last',
          stableTieBreaker: 'record-id-asc',
        },
        pagination: {
          limit: { minimum: 1, maximum: 200, default: 100 },
          cursor: { opaque: true, binds: [], snapshotConsistency: false },
        },
      },
      searchable: ['title'],
      filterable: [],
      sortable: ['title'],
      search: { parameter: 'q', minLength: 1, maxLength: 100 },
      filters: [],
      comparisons: [],
      capabilityQueries: [],
      sort: {
        parameter: 'sort',
        syntax: 'field:direction',
        repeatable: true,
        ordered: true,
        maxCriteria: 8,
        genericDefault: ['createdAt:desc'],
        envelopeFields: ['createdAt', 'updatedAt'],
        nullPlacement: 'last',
        genericValues: ['createdAt:desc', 'title:asc'],
        semantic: { standalone: true, values: [], defaults: {} },
      },
      pagination: {
        limit: { parameter: 'limit', minimum: 1, maximum: 200, default: 100 },
        cursor: { parameter: 'cursor', type: 'string' },
      },
      capabilityParameters: [],
      capabilityQueries: [],
    },
    actions: [{
      key: 'reschedule',
      access: 'write',
      kind: 'workflow',
      input: { fields: [] },
      concurrency: { strategy: 'record-version', required: true, transport: { in: 'body', name: 'version' } },
      invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/event/records/{recordId}/actions/reschedule' },
    }],
    capabilities: ['calendar'],
    capabilityBindings: {},
  };
}

function responseFor(url) {
  if (url === \`\${CORE_BASE}/me/_discovery/models\`) {
    return {
      data: {
        semanticDetailPathTemplate: '/api/v1/me/_discovery/models/{modelKey}',
        models: [{
          key: 'event',
          version: 6,
          schemaHash: semanticDetail().schemaHash,
          display: { singular: 'Event', plural: 'Events' },
          capabilities: ['calendar'],
          actions: [{ key: 'reschedule', access: 'write', kind: 'workflow' }],
          access: ['read', 'write'],
        }],
      },
    };
  }
  if (url === \`\${CORE_BASE}/me/_discovery/models/event\`) {
    return { data: { access: ['read', 'write'], model: semanticDetail() } };
  }
  if (url === \`\${CORE_BASE}/me/_discovery/inventory\`) {
    return { data: { semanticDetailPathTemplate: '', models: [], spaces: [] } };
  }
  throw new Error(\`Unexpected URL \${url}\`);
}

function editorContext(parameterOverrides = {}) {
  const calls = [];
  const parameters = {
    spaceId: 'spc_not_yet_granted',
    operation: 'update',
    recordType: '',
    ...parameterOverrides,
  };
  return {
    calls,
    getCurrentNodeParameter(name) { return parameters[name]; },
    getNodeParameter(name, defaultValue) { return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue; },
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return { coreBaseUrl: CORE_BASE, agentSecret: 'lsp_agt_test' };
    },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1 }),
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push(options);
        return responseFor(options.url);
      },
    },
  };
}

function runtimeContext() {
  const calls = [];
  const parameters = {
    toolResource: 'record',
    enableUserAuthorization: false,
    authorizationPrincipalUserId: '',
    spaceId: 'spc_not_yet_granted',
    operation: 'query',
    recordType: 'event',
    queryMode: 'generic',
    capabilityQueryKey: '',
    actionKey: '',
    descriptionOverride: '',
  };
  return {
    calls,
    getCredentials: async (name) => {
      assert.equal(name, 'lifeSpaceAgentExecutionApi');
      return { coreBaseUrl: CORE_BASE, agentSecret: 'lsp_agt_test' };
    },
    getNodeParameter(name, _itemIndex, defaultValue) { return Object.hasOwn(parameters, name) ? parameters[name] : defaultValue; },
    getNode: () => ({ name: 'LifeSpace Agent Tool', typeVersion: 1, parameters }),
    getTimezone: () => 'Asia/Shanghai',
    addInputData: () => ({ index: 0 }),
    addOutputData: () => undefined,
    helpers: {
      async httpRequestWithAuthentication(credentialName, options) {
        assert.equal(credentialName, 'lifeSpaceAgentExecutionApi');
        calls.push(options);
        return responseFor(options.url);
      },
    },
  };
}

test('Agent Tool Space and Record Type accept stable IDs even when discovery has no current Space edge', () => {
  const node = new LifeSpaceAgentTool();
  const space = node.description.properties.find((property) => property.name === 'spaceId');
  const recordType = node.description.properties.find((property) => property.name === 'recordType');
  assert.equal(space.allowArbitraryValues, true);
  assert.equal(recordType.allowArbitraryValues, true);
});

test('Record Type options use configuration model discovery and do not require a Space Data Grant', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext();
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  assert.equal(options.length, 1);
  assert.equal(options[0].name, 'Event');
  const snapshot = decodeAgentToolSemanticSnapshot(options[0].value);
  assert.equal(snapshot.spaceId, 'spc_not_yet_granted');
  assert.equal(snapshot.model.key, 'event');
  assert.deepEqual(snapshot.model.access, ['read', 'write']);
  assert.deepEqual(context.calls.map((call) => call.url), [
    \`\${CORE_BASE}/me/_discovery/models\`,
    \`\${CORE_BASE}/me/_discovery/models/event\`,
  ]);
});

test('Actions can be discovered from a directly entered model key without Space Authority', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ operation: 'action', recordType: 'event' });
  const options = await node.methods.loadOptions.getActions.call(context);
  assert.deepEqual(options, [{
    name: 'reschedule',
    value: 'reschedule',
    description: 'workflow Action · requires write access',
  }]);
  assert.deepEqual(context.calls.map((call) => call.url), [\`\${CORE_BASE}/me/_discovery/models/event\`]);
});

test('A directly entered model key resolves static semantics when the Tool is supplied', async () => {
  const node = new LifeSpaceAgentTool();
  const context = runtimeContext();
  const supplied = await node.supplyData.call(context, 0);
  assert.ok(supplied.response);
  assert.equal(supplied.response.metadata.lifeSpaceModelVersion, 6);
  assert.deepEqual(context.calls.map((call) => call.url), [\`\${CORE_BASE}/me/_discovery/models/event\`]);
});
`);

// 6) Document the adapter boundary for operators.
{
  const path = 'README.md';
  let content = read(path);
  const marker = `## LifeSpace Agent Tool\n`;
  if (content.includes(marker) && !content.includes('Configuration selectors are not Authority')) {
    content = content.replace(marker, `${marker}\n> **Configuration selectors are not Authority.** In the Agent Tool, Space may be selected from currently reachable Spaces or entered directly as a stable \\`spc_*\\` ID. Record Type may be selected or entered as a stable model key; its static semantics come from LifeSpace configuration model discovery (Credential Scope × Application × Model Access × published model capability), not from a current Space Data Grant. Every actual read/write/action still rechecks current Direct Agent Authority or an explicit User Delegation.\n\n`);
  }
  write(path, content);
}

console.log('Prepared Agent configuration discovery changes.');
