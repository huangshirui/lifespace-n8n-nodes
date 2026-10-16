from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing target: {label}')
    return text.replace(old, new, 1)

# Generic helper usable by design-time and Agent runtime contexts.
p = Path('nodes/lifespaceDiscovery.ts')
s = p.read_text()
s = replace_once(
    s,
    """async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions,""",
    """async function requestFullRuntimeDiscovery(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,""",
    'widen full discovery context',
)
anchor = """export async function loadRuntimeDiscoveryInventory(
  this: ILoadOptionsFunctions,
  transport?: DiscoveryTransport,
): Promise<DiscoveryResponse> {
  const baseUrl = transport
    ? transport.baseUrl
    : normalizeBaseUrl((await this.getCredentials('lifeSpaceApi')).baseUrl);
  const progressive = await requestProgressiveRuntimeDiscovery(this, baseUrl, undefined, transport);
  return progressive ?? requestFullRuntimeDiscovery(this, baseUrl, transport);
}
"""
insert = anchor + """
export async function loadSpaceRuntimeModel(
  context: ILoadOptionsFunctions | IExecuteFunctions | ISupplyDataFunctions,
  spaceId: string,
  modelKey: string,
  transport: DiscoveryTransport,
): Promise<DiscoveryModel | null> {
  const progressive = await requestProgressiveRuntimeDiscovery(
    context,
    transport.baseUrl,
    { spaceId, modelKey },
    transport,
  );
  const discovery = progressive ?? await requestFullRuntimeDiscovery(context, transport.baseUrl, transport);
  return discoveryModel(discovery, spaceId, modelKey) ?? null;
}
"""
s = replace_once(s, anchor, insert, 'loadSpaceRuntimeModel helper')
p.write_text(s)

p = Path('nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts')
s = p.read_text()
s = replace_once(
    s,
    """  decodeRecordTypeSelector,
  loadConfigurationModelInventory,
  loadConfigurationModelSemanticDetail,
  loadOptionParameter,
  loadRuntimeDiscoveryInventory,
  type DiscoveryModel,""",
    """  decodeRecordTypeSelector,
  discoverySpace,
  loadConfigurationModelInventory,
  loadConfigurationModelSemanticDetail,
  loadDesignTimeSemanticDetail,
  loadOptionParameter,
  loadRuntimeDiscoveryInventory,
  loadSpaceRuntimeModel,
  modelSupportsRuntimeOperation,
  type DiscoveryModel,""",
    'Agent discovery imports',
)
s = replace_once(
    s,
    """function modelSupportsConfigurationOperation(model: DiscoveryModel, operation: string): boolean {
  if (operation === 'query') return model.access.includes('read');
  if (['create', 'update', 'delete'].includes(operation)) return model.access.includes('write');
  if (operation === 'action') {
    return model.actions.some((action) => model.access.includes(action.access));
  }
  return false;
}
""",
    """function modelSupportsConfigurationOperation(model: DiscoveryModel, operation: string): boolean {
  if (!modelSupportsRuntimeOperation(model, operation)) return false;
  if (operation === 'query') return model.access.includes('read');
  if (['create', 'update', 'delete'].includes(operation)) return model.access.includes('write');
  if (operation === 'action') {
    return model.actions.some((action) => model.access.includes(action.access));
  }
  return false;
}

function dynamicConfigurationModel(model: DiscoveryModel): boolean {
  return model.origin === 'external' || model.fieldsDynamic === true;
}

async function resolveAgentConfigurationModel(
  context: AgentConfigurationContext,
  spaceId: string,
  modelKey: string,
  transport: DiscoveryTransport,
): Promise<DiscoveryModel | null> {
  const inventory = await loadConfigurationModelInventory(context, transport);
  const published = inventory.find((model) => model.key === modelKey);
  if (!published) return null;
  if (!dynamicConfigurationModel(published)) {
    return loadConfigurationModelSemanticDetail(context, modelKey, transport);
  }
  return loadSpaceRuntimeModel(context, spaceId, modelKey, transport);
}
""",
    'Agent dynamic resolver',
)
s = replace_once(
    s,
    """  const selector = decodeRecordTypeSelector(rawRecordType);
  if (!selector) return null;
  const transport = await agentConfigurationTransport(context);
  const model = await loadConfigurationModelSemanticDetail(context, selector.modelKey, transport);
  return { model, spaceId };""",
    """  const selector = decodeRecordTypeSelector(rawRecordType);
  if (!selector) return null;
  const transport = await agentConfigurationTransport(context);
  const model = await resolveAgentConfigurationModel(context, spaceId, selector.modelKey, transport);
  return model ? { model, spaceId } : null;""",
    'selected Agent model',
)
s = replace_once(
    s,
    """  const transport = await agentConfigurationTransport(context, itemIndex);
  const model = await loadConfigurationModelSemanticDetail(context, selector.modelKey, transport);
  return encodeAgentToolSemanticSnapshot({
    format: 1,
    spaceId,
    spaceName: null,
    model,
  });""",
    """  const transport = await agentConfigurationTransport(context, itemIndex);
  const model = await resolveAgentConfigurationModel(context, spaceId, selector.modelKey, transport);
  if (!model) {
    throw new NodeOperationError(
      context.getNode(),
      `LifeSpace Record Type ${selector.modelKey} is not currently available in Space ${spaceId}. Dynamic External fields require current Space visibility.`,
      { itemIndex },
    );
  }
  return encodeAgentToolSemanticSnapshot({
    format: 1,
    spaceId,
    spaceName: null,
    model,
  });""",
    'runtime raw selector resolution',
)
old_get = """          const transport = await agentConfigurationTransport(this);
          const inventory = await loadConfigurationModelInventory(this, transport);
          const candidates = inventory.filter((model) => modelSupportsConfigurationOperation(model, operation));
          const models = await Promise.all(
            candidates.map((model) => loadConfigurationModelSemanticDetail(this, model.key, transport)),
          );

          return models.map((model) => ({
            name: model.display.singular?.trim() || model.key,
            value: encodeAgentToolSemanticSnapshot({
              format: 1,
              spaceId,
              spaceName: null,
              model,
            }),
            description: model.description ?? undefined,
          }));"""
new_get = """          const transport = await agentConfigurationTransport(this);
          const inventory = await loadConfigurationModelInventory(this, transport);
          const needsDynamic = inventory.some(dynamicConfigurationModel);
          const runtime = needsDynamic ? await loadRuntimeDiscoveryInventory.call(this, transport) : null;
          const runtimeSpace = runtime ? discoverySpace(runtime, spaceId) : undefined;

          const models = (await Promise.all(inventory.map(async (published) => {
            if (!dynamicConfigurationModel(published)) {
              if (!modelSupportsConfigurationOperation(published, operation)) return null;
              return loadConfigurationModelSemanticDetail(this, published.key, transport);
            }
            const identity = runtimeSpace?.models.find((model) => model.key === published.key && model.origin === 'external');
            if (!identity || !modelSupportsConfigurationOperation(identity, operation)) return null;
            return loadDesignTimeSemanticDetail.call(this, spaceId, identity, transport);
          }))).filter((model): model is DiscoveryModel => model !== null);

          return models.map((model) => ({
            name: model.display.singular?.trim() || model.key,
            value: encodeAgentToolSemanticSnapshot({
              format: 1,
              spaceId,
              spaceName: runtimeSpace?.spaceName ?? null,
              model,
            }),
            description: model.description ?? undefined,
          }));"""
s = replace_once(s, old_get, new_get, 'Agent getRecordTypes dynamic projection')
p.write_text(s)

# Agent configuration regression: Native remains pre-authority; External uses Space-local detail.
p = Path('test/agent-configuration-discovery.test.mjs')
s = p.read_text()
s = replace_once(
    s,
    """          access: ['read', 'write'],
        }],""",
    """          access: ['read', 'write'],
        }, {
          key: 'health_document',
          version: 1,
          schemaHash: 'published-external-definition',
          display: { singular: 'Health Document', plural: 'Health Documents' },
          capabilities: [],
          actions: [],
          access: ['read', 'write'],
          origin: 'external',
          fieldsDynamic: true,
        }],""",
    'configuration inventory External model',
)
s = replace_once(
    s,
    """  if (url === `${CORE_BASE}/me/_discovery/inventory`) {
    return { data: { semanticDetailPathTemplate: '', models: [], spaces: [] } };
  }""",
    """  if (url === `${CORE_BASE}/me/_discovery/inventory`) {
    return { data: {
      semanticDetailPathTemplate: '/api/v1/spaces/{spaceId}/_discovery/models/{modelKey}',
      models: [{
        key: 'health_document', origin: 'external', spaceId: 'spc_external', schemaHash: 'external-space-schema',
        display: { singular: 'Health Document', plural: 'Health Documents' },
        runtimeCapabilities: {
          get: true, query: true, create: false, update: false, delete: false,
          batchWrite: false, atomicBatch: false, transaction: false,
          versionedWrite: false, actions: false, relationTargetResolution: false,
        },
        contract: { kind: 'dynamic', revision: null },
      }],
      spaces: [{
        spaceId: 'spc_external', spaceName: 'External Space',
        models: [{ modelKey: 'health_document', access: ['read'] }],
      }],
    } };
  }
  if (url === `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`) {
    return { data: {
      key: 'health_document', modelKey: 'health_document', origin: 'external', spaceId: 'spc_external',
      schemaHash: 'external-space-schema',
      display: { singular: 'Health Document', plural: 'Health Documents' },
      description: 'Space-local provider schema', access: ['read'],
      fields: [{ key: 'f_title', title: 'Title', type: 'string', nullable: false, readable: true, writable: false, operators: ['eq', 'contains'], sortable: true }],
      actions: [], capabilities: [], capabilityBindings: {},
      runtimeCapabilities: {
        get: true, query: true, create: false, update: false, delete: false,
        batchWrite: false, atomicBatch: false, transaction: false,
        versionedWrite: false, actions: false, relationTargetResolution: false,
      },
      contract: { kind: 'dynamic', revision: null },
      query: { canonical: {
        invocation: { method: 'POST', pathTemplate: '/api/v1/spaces/{spaceId}/models/{modelKey}/records/query' },
        composition: { selectionFacets: ['filter'], selectionCombine: 'intersection', ordering: 'sort', pagination: 'cursor-pagination' },
        search: null,
        filter: { maxDepth: 2, maxNodes: 100, targets: [{ field: 'f_title', kind: 'field', valueType: 'string', operators: ['eq', 'contains'], nullable: false }] },
        sort: { fields: ['f_title'], directions: ['asc', 'desc'], maxCriteria: 8, default: [], nullPlacement: 'provider-defined', stableTieBreaker: 'provider-defined', temporalRange: null },
        pagination: { limit: { minimum: 1, maximum: 100, default: 100 }, cursor: { opaque: true, binds: ['space', 'model', 'schema'], snapshotConsistency: false } },
      } },
    } };
  }""",
    'runtime External responses',
)
s = replace_once(
    s,
    """  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);""",
    """  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/inventory`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);""",
    'Native options calls include one runtime inventory for dynamic candidates',
)
s = replace_once(
    s,
    """  assert.deepEqual(context.calls.map((call) => call.url), [`${CORE_BASE}/me/_discovery/models/event`]);
});

test('A directly entered model key resolves static semantics when the Tool is supplied', async () => {""",
    """  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});

test('External Record Type options pin the selected Space dynamic contract instead of the global definition', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ spaceId: 'spc_external', operation: 'query' });
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  const external = options.find((option) => option.name === 'Health Document');
  assert.ok(external);
  const snapshot = decodeAgentToolSemanticSnapshot(external.value);
  assert.equal(snapshot.spaceId, 'spc_external');
  assert.equal(snapshot.model.origin, 'external');
  assert.equal(snapshot.model.version, undefined);
  assert.equal(snapshot.model.schemaHash, 'external-space-schema');
  assert.equal(snapshot.model.fields[0].key, 'f_title');
  assert.equal(snapshot.model.runtimeCapabilities.query, true);
  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/inventory`,
    `${CORE_BASE}/spaces/spc_external/_discovery/models/health_document`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});

test('External Record Type is not advertised for operations absent from its current Space runtime capabilities', async () => {
  const node = new LifeSpaceAgentTool();
  const context = editorContext({ spaceId: 'spc_external', operation: 'update' });
  const options = await node.methods.loadOptions.getRecordTypes.call(context);
  assert.equal(options.some((option) => option.name === 'Health Document'), false);
});

test('A directly entered model key resolves static semantics when the Tool is supplied', async () => {""",
    'Agent External dynamic tests',
)
s = replace_once(
    s,
    """  assert.deepEqual(context.calls.map((call) => call.url), [`${CORE_BASE}/me/_discovery/models/event`]);
});""",
    """  assert.deepEqual(context.calls.map((call) => call.url), [
    `${CORE_BASE}/me/_discovery/models`,
    `${CORE_BASE}/me/_discovery/models/event`,
  ]);
});""",
    'runtime raw Native model now resolves classification inventory',
)
p.write_text(s)

print('Agent Tool dynamic External convergence staged')
