import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { searchTools } from './methods';
import { resources } from './resources';

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: resources.map((r) => ({ name: r.name, value: r.value, description: r.description })),
	default: 'tool',
};

export class OneToolRing implements INodeType {
	description: INodeTypeDescription = {
		displayName: '1ToolRing',
		name: 'oneToolRing',
		icon: { light: 'file:../../icons/1toolring.svg', dark: 'file:../../icons/1toolring.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Find, price-check and run pay-per-call tools for search, SEO, maps, e-commerce, market and web data',
		defaults: { name: '1ToolRing' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'oneToolRingApi', required: true }],
		properties: [resourceProperty, ...resources.flatMap((r) => r.properties)],
	};

	methods = {
		listSearch: { searchTools },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resourceValue = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const resource = resources.find((r) => r.value === resourceValue);
				if (!resource) {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resourceValue}"`, {
						itemIndex: i,
					});
				}
				const result = await resource.execute.call(this, operation, i);
				const rows: IDataObject[] = Array.isArray(result) ? result : [result];
				for (const json of rows) returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Keep API and operation errors (status code, hint, item index) as they are.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
