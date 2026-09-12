export type AgentToolOperation = 'query' | 'create' | 'update' | 'delete' | 'action';
export type AgentToolQueryMode = 'generic' | 'capability';

export type AgentToolConfig = {
  spaceId: string;
  spaceName?: string | null;
  operation: AgentToolOperation;
  queryMode?: AgentToolQueryMode;
  capabilityQueryKey?: string;
  actionKey?: string;
};
