import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ResourceModule } from '../../types';
import { toolRingApiRequest } from '../../transport';

const PAGE_SIZE = 50;

export const run: ResourceModule = {
	value: 'run',
	name: 'Run',
	description: 'Read the status, result and cost of tool runs',
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: ['run'] } },
			options: [
				{
					name: 'Get',
					value: 'get',
					description: 'Get the status, result and cost of one run (free)',
					action: 'Get a run',
				},
				{
					name: 'Get Many',
					value: 'getAll',
					description: 'List your runs, newest first (free)',
					action: 'Get many runs',
				},
			],
			default: 'get',
		},
		{
			displayName: 'Run ID',
			name: 'runId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. run_01JC8Q4Z6N4M2V9W3X7Y5T1R0P',
			description: 'The run_id returned by Tool > Run',
			displayOptions: { show: { resource: ['run'], operation: ['get'] } },
		},
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show: { resource: ['run'], operation: ['getAll'] } },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1 },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { resource: ['run'], operation: ['getAll'], returnAll: [false] } },
		},
	],

	async execute(operation, itemIndex) {
		if (operation === 'get') {
			const runId = (this.getNodeParameter('runId', itemIndex) as string).trim();
			if (!runId) {
				throw new NodeOperationError(this.getNode(), 'Run ID is empty', {
					description: 'Use the run_id returned by Tool > Run.',
					itemIndex,
				});
			}
			return await toolRingApiRequest.call(
				this,
				'GET',
				`/tools/runs/${encodeURIComponent(runId)}`,
				{ itemIndex },
			);
		}

		const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
		const limit = returnAll ? undefined : (this.getNodeParameter('limit', itemIndex, 50) as number);
		const out: IDataObject[] = [];
		let cursor: string | undefined;
		do {
			const pageSize = limit !== undefined ? Math.min(PAGE_SIZE, limit - out.length) : PAGE_SIZE;
			const page = await toolRingApiRequest.call(this, 'GET', '/tools/runs', {
				qs: { limit: pageSize, ...(cursor ? { cursor } : {}) },
				itemIndex,
			});
			const rows = Array.isArray(page.runs) ? (page.runs as IDataObject[]) : [];
			out.push(...rows);
			cursor =
				typeof page.next_cursor === 'string' && page.next_cursor ? page.next_cursor : undefined;
			if (!rows.length) break;
		} while (cursor && (limit === undefined || out.length < limit));
		return limit !== undefined ? out.slice(0, limit) : out;
	},
};
