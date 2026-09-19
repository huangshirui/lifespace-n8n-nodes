import type {
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import { LifeSpaceTool } from '../LifeSpaceTool/LifeSpaceTool.node';

export class LifeSpaceAgentTool extends LifeSpaceTool {
  constructor() {
    super();
    this.description = {
      ...this.description,
      icon: {
        light: 'file:lifespace.svg',
        dark: 'file:lifespace.dark.svg',
      },
      description: 'Expose one scoped LifeSpace operation to an AI Agent',
      properties: this.description.properties.filter((property) =>
        property.name !== 'queryMode' && property.name !== 'capabilityQueryKey'),
    };
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    return LifeSpaceTool.prototype.supplyData.call(this, itemIndex);
  }
}
