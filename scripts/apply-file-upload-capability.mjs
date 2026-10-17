import fs from 'node:fs';

function replaceOnce(path, from, to) {
  const before = fs.readFileSync(path, 'utf8');
  if (!before.includes(from)) throw new Error(`${path}: anchor not found: ${from.slice(0, 80)}`);
  // Use a callback so replacement text containing `$'` (for example a regex ending in `$`)
  // is never interpreted as a String.replace replacement token.
  const after = before.replace(from, () => to);
  fs.writeFileSync(path, after);
}

// Runtime Discovery consumes the LifeSpace field language and the field-level upload capability.
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  "'timezone' | 'enum' | 'enum_list' | 'file_ref_list' | 'person'",
  "'timezone' | 'enum' | 'enum_list' | 'file' | 'file_list' | 'file_ref_list' | 'person'",
);
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  '  relation?: DiscoveryRelation;\n};',
  '  relation?: DiscoveryRelation;\n  upload?: { supported: true; maxBytes: number };\n};',
);
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  '  values?: string[];\n};\n\ntype ExternalSemanticDetail',
  '  values?: string[];\n  upload?: { supported: true; maxBytes: number };\n};\n\ntype ExternalSemanticDetail',
);
replaceOnce(
  'nodes/lifespaceDiscovery.ts',
  '      values: field.values,\n    })),',
  '      values: field.values,\n      upload: field.upload,\n    })),',
);

// Human mapper: Native file is one stable fil_* string; file_list is an array of stable IDs.
replaceOnce(
  'nodes/LifeSpaceWorkflow/humanProjection.ts',
  "['person_list', 'record_list', 'enum_list', 'file_ref_list']",
  "['person_list', 'record_list', 'enum_list', 'file_list', 'file_ref_list']",
);
replaceOnce(
  'nodes/LifeSpace/LifeSpace.node.ts',
  "    case 'person_list':\n    case 'record_list':\n      return 'array';",
  "    case 'person_list':\n    case 'record_list':\n    case 'enum_list':\n    case 'file_list':\n    case 'file_ref_list':\n      return 'array';",
);
replaceOnce(
  'nodes/LifeSpace/LifeSpace.node.ts',
  "  return ['create', 'update', 'delete'].includes(operation) ? 'write' : 'read';",
  "  return ['create', 'update', 'delete', 'uploadFile'].includes(operation) ? 'write' : 'read';",
);

// Agent Tool consumes stable LifeSpace File references only; it never transports binary bytes.
replaceOnce(
  'nodes/agent/lifeSpaceToolFactory.ts',
  '  format?: string;\n  default?: unknown;',
  '  format?: string;\n  pattern?: string;\n  default?: unknown;',
);
replaceOnce(
  'nodes/agent/lifeSpaceToolFactory.ts',
  "    case 'file_ref_list':\n      schema = fileRefListSchema();\n      break;",
  "    case 'file':\n      schema = { type: 'string', pattern: '^fil_[A-Za-z0-9_-]+$' };\n      break;\n    case 'file_list':\n      schema = {\n        type: 'array',\n        uniqueItems: true,\n        items: { type: 'string', pattern: '^fil_[A-Za-z0-9_-]+$' },\n      };\n      break;\n    case 'file_ref_list':\n      schema = fileRefListSchema();\n      break;",
);
replaceOnce(
  'nodes/agent/lifeSpaceToolFactory.ts',
  "  if (field.type === 'temporal_range') {\n    return `${base} Supply one object with kind, start, and end. kind=date uses inclusive YYYY-MM-DD dates; kind=instant uses absolute RFC3339 date-times.`;\n  }\n  return base;",
  "  if (field.type === 'temporal_range') {\n    return `${base} Supply one object with kind, start, and end. kind=date uses inclusive YYYY-MM-DD dates; kind=instant uses absolute RFC3339 date-times.`;\n  }\n  if (field.type === 'file') return `${base} Supply one stable fil_* ID returned by the LifeSpace upload capability.`;\n  if (field.type === 'file_list') return `${base} Supply stable fil_* IDs returned by the LifeSpace upload capability.`;\n  return base;",
);

// Published Workflow UI exposes one unified upload operation without duplicating Core business rules.
replaceOnce(
  'nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts',
  "import { restoreLifeSpaceContinueOnFailErrors } from './lifeSpaceErrorProjection';",
  "import { restoreLifeSpaceContinueOnFailErrors } from './lifeSpaceErrorProjection';\nimport { executeFileUploadWorkflow, getUploadFields } from './fileUpload';",
);
replaceOnce(
  'nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts',
  "    if (property.name === 'spaceId') {",
  `    if (property.name === 'operation') {
      const options = [...(property.options ?? [])];
      const updateIndex = options.findIndex((option) => 'value' in option && option.value === 'update');
      const upload = {
        name: 'Upload File',
        value: 'uploadFile',
        action: 'Upload a file',
        description: 'Upload n8n binary data through a LifeSpace Upload Session. Native fields return a stable fil_* ID; External fields transfer bytes to the Provider.',
      };
      const next = updateIndex < 0
        ? [...options, upload]
        : [...options.slice(0, updateIndex), upload, ...options.slice(updateIndex)];
      result.push({ ...property, options: next });
      continue;
    }

    if (property.name === 'spaceId') {`,
);
replaceOnce(
  'nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts',
  "    if (property.name === 'fields') {",
  `    if (property.name === 'recordId') {
      result.push(
        property,
        {
          displayName: 'Upload Field Name or ID',
          name: 'uploadField',
          type: 'options',
          typeOptions: { loadOptionsMethod: 'getUploadFields', loadOptionsDependsOn: ['spaceId', 'recordType'] },
          options: [],
          default: '',
          required: true,
          displayOptions: { show: { resource: ['modelRecord'], operation: ['uploadFile'] } },
          description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        },
        {
          displayName: 'Record ID',
          name: 'uploadRecordId',
          type: 'string',
          default: '',
          displayOptions: { show: { resource: ['modelRecord'], operation: ['uploadFile'] } },
          description: 'Required by External uploads; Native uploads may leave this empty and use the returned fil_* ID in a later Create or Update',
        },
        {
          displayName: 'Input Binary Field',
          name: 'uploadBinaryProperty',
          type: 'string',
          default: 'data',
          required: true,
          displayOptions: { show: { resource: ['modelRecord'], operation: ['uploadFile'] } },
          description: 'Binary property containing the file bytes, for example data',
        },
        {
          displayName: 'File Name',
          name: 'uploadFileName',
          type: 'string',
          default: '',
          displayOptions: { show: { resource: ['modelRecord'], operation: ['uploadFile'] } },
          description: 'Optional override; by default the n8n binary file name is used',
        },
        {
          displayName: 'Content Type',
          name: 'uploadContentType',
          type: 'string',
          default: '',
          displayOptions: { show: { resource: ['modelRecord'], operation: ['uploadFile'] } },
          description: 'Optional MIME type override; by default the n8n binary MIME type is used',
        },
      );
      continue;
    }

    if (property.name === 'fields') {`,
);
replaceOnce(
  'nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts',
  '        getCanonicalTimeWindowFields,\n        getSortableFields: getHumanSortableFields,',
  '        getCanonicalTimeWindowFields,\n        getUploadFields,\n        getSortableFields: getHumanSortableFields,',
);
replaceOnce(
  'nodes/LifeSpaceWorkflow/LifeSpaceWorkflow.node.ts',
  "    if (resource === 'person') return executePersonWorkflow(this);\n    const executions = await LifeSpace.prototype.execute.call(canonicalOnlyExecutionContext(this));",
  "    if (resource === 'person') return executePersonWorkflow(this);\n    if (resource === 'modelRecord') {\n      const operation = String(this.getNodeParameter('operation', 0, '') ?? '');\n      if (operation === 'uploadFile') return executeFileUploadWorkflow(this);\n    }\n    const executions = await LifeSpace.prototype.execute.call(canonicalOnlyExecutionContext(this));",
);

// Documentation: upload remains a distinct capability from ordinary field mutation.
const compatibilityPath = 'docs/external-field-compatibility.md';
let compatibility = fs.readFileSync(compatibilityPath, 'utf8');
if (!compatibility.includes('### Upload capability')) {
  compatibility += `\n### Upload capability\n\nExternal \`file_ref_list\` remains read-only in ordinary Record mutation. When Runtime Discovery exposes \`field.upload = { supported: true, maxBytes }\`, the Workflow node may use the LifeSpace Upload Session. It never turns the field into a writable array and never contains Provider-specific Notion logic. The signed R2 URL is used without the LifeSpace Authorization header. Native \`file\` / \`file_list\` fields carry stable \`fil_*\` references; binary upload is a separate operation that returns the reference for later Record mutation.\n`;
  fs.writeFileSync(compatibilityPath, compatibility);
}
