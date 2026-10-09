import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const preparePath = 'scripts/prepare-config-model-discovery.mjs';
let prepare = fs.readFileSync(preparePath, 'utf8');
const lines = prepare.split('\n');
const replacement = "    content = content.replace(marker, marker + '\\n> **Configuration selectors are not Authority.** In the Agent Tool, Space may be selected from currently reachable Spaces or entered directly as a stable spc_* ID. Record Type may be selected or entered as a stable model key; its static semantics come from LifeSpace configuration model discovery (Credential Scope × Application × Model Access × published model capability), not from a current Space Data Grant. Every actual read/write/action still rechecks current Direct Agent Authority or an explicit User Delegation.\\n\\n');";
let matches = 0;
for (let index = 0; index < lines.length; index += 1) {
  if (lines[index].includes('content = content.replace(marker,')) {
    lines[index] = replacement;
    matches += 1;
  }
}
if (matches !== 1) throw new Error(`expected one README replacement line, found ${matches}`);
prepare = lines.join('\n');
fs.writeFileSync(preparePath, prepare);

const result = spawnSync(process.execPath, [preparePath], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

const agentPath = 'nodes/LifeSpaceAgentTool/LifeSpaceAgentTool.node.ts';
let agent = fs.readFileSync(agentPath, 'utf8');
const oldSupply = "    const resource = String(this.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');\n    const runtimeContext: ISupplyDataFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, itemIndex)\n      : this;\n";
const newSupply = "    const resource = String(this.getNodeParameter('toolResource', itemIndex, 'record') ?? 'record');\n    if (resource === 'record') currentRecordOperation(this, itemIndex);\n    const runtimeContext: ISupplyDataFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, itemIndex)\n      : this;\n";
const oldExecute = "    const resource = String(this.getNodeParameter('toolResource', 0, 'record') ?? 'record');\n    const runtimeContext: IExecuteFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, 0)\n      : this;\n";
const newExecute = "    const resource = String(this.getNodeParameter('toolResource', 0, 'record') ?? 'record');\n    if (resource === 'record') currentRecordOperation(this, 0);\n    const runtimeContext: IExecuteFunctions = resource === 'record'\n      ? await agentRecordExecutionContext(this, 0)\n      : this;\n";
if (agent.split(oldSupply).length - 1 !== 1 || agent.split(oldExecute).length - 1 !== 1) {
  throw new Error('could not find normalized Agent runtime context anchors');
}
agent = agent.replace(oldSupply, newSupply).replace(oldExecute, newExecute);
fs.writeFileSync(agentPath, agent);
