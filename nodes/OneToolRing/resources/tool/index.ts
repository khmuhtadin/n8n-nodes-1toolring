import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

import type { ResourceModule } from '../../types';
import { toolRingApiRequest } from '../../transport';

const toolLocator = (operations: string[], description: string): INodeProperties => ({
	displayName: 'Tool',
	name: 'tool',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description,
	displayOptions: { show: { resource: ['tool'], operation: operations } },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Describe the job, e.g. google search results',
			typeOptions: {
				searchListMethod: 'searchTools',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 1toolring/fx/convert',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '^[^\\s/]+/\\S+$',
						errorMessage: 'A tool ID looks like provider/path, for example 1toolring/fx/convert',
					},
				},
			],
		},
	],
});

/** Reads a JSON field that may hold a string, an object or nothing. Returns undefined when empty. */
function readJsonObject(
	ctx: IExecuteFunctions,
	raw: unknown,
	label: string,
	itemIndex: number,
): IDataObject | undefined {
	let value = raw;
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return undefined;
		try {
			value = JSON.parse(text);
		} catch (error) {
			throw new NodeOperationError(ctx.getNode(), `${label} is not valid JSON`, {
				description: (error as Error).message,
				itemIndex,
			});
		}
	}
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a JSON object`, {
			description: 'Use an object such as {"keyword": "coffee"}, not a list or a single value.',
			itemIndex,
		});
	}
	return Object.keys(value as IDataObject).length ? (value as IDataObject) : undefined;
}

export const tool: ResourceModule = {
	value: 'tool',
	name: 'Tool',
	description: 'Find a tool, read its price and input, and run it',
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: ['tool'] } },
			options: [
				{
					name: 'Get',
					value: 'get',
					description: "Get a tool's input schema, price and notes (free)",
					action: 'Get a tool',
				},
				{
					name: 'Run',
					value: 'run',
					description: "Run a tool and get its result (charged at the tool's price)",
					action: 'Run a tool',
				},
				{
					name: 'Search',
					value: 'search',
					description: 'Find tools for a job described in plain words (free)',
					action: 'Search tools',
				},
			],
			default: 'run',
		},

		// ----------------------------- search -----------------------------
		{
			displayName: 'Query',
			name: 'query',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. google search results for a keyword',
			description: 'The job in plain words. Each result comes with its tool ID and price.',
			displayOptions: { show: { resource: ['tool'], operation: ['search'] } },
		},
		{
			displayName: 'Max Results',
			name: 'maxResults',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 20 },
			default: 10,
			description: 'How many tools to return (1 to 20)',
			displayOptions: { show: { resource: ['tool'], operation: ['search'] } },
		},

		// ----------------------------- get / run -----------------------------
		toolLocator(['get'], 'The tool to look up. Pick from the list or enter a tool ID.'),
		toolLocator(
			['run'],
			'The tool to run. Pick from the list or enter a tool ID. Each tool shows its price.',
		),
		{
			displayName: 'Body',
			name: 'body',
			type: 'json',
			default: '{}',
			description:
				'The tool\'s input as a JSON object, for example {"from": "USD", "to": "IDR", "amount": 100}. Use Tool > Get to see which fields a tool accepts.',
			displayOptions: { show: { resource: ['tool'], operation: ['run'] } },
		},
		{
			displayName: 'Additional Input',
			name: 'additionalInput',
			type: 'collection',
			placeholder: 'Add Input',
			default: {},
			description: "Only needed when the tool's input schema lists these parts",
			displayOptions: { show: { resource: ['tool'], operation: ['run'] } },
			options: [
				{
					displayName: 'Path Parameters',
					name: 'pathParams',
					type: 'json',
					default: '{}',
					description: "JSON object for the pathParams part of the tool's input schema",
				},
				{
					displayName: 'Query Parameters',
					name: 'queryParams',
					type: 'json',
					default: '{}',
					description: "JSON object for the queryParams part of the tool's input schema",
				},
			],
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: { resource: ['tool'], operation: ['run'] } },
			options: [
				{
					displayName: 'Max Wait (Seconds)',
					name: 'maxWait',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 120,
					description:
						'How long to wait for a slow run. When the time is up the node returns the run with status "running". Read it later with Run > Get.',
				},
				{
					displayName: 'Polling Interval (Seconds)',
					name: 'pollInterval',
					type: 'number',
					typeOptions: { minValue: 1 },
					default: 4,
					description: 'How often to check a slow run. Checking is free.',
				},
				{
					displayName: 'Return Only Tool Output',
					name: 'outputOnly',
					type: 'boolean',
					default: false,
					description:
						"Whether to return only the tool's answer, without the run ID, status and cost",
				},
				{
					displayName: 'Wait for Completion',
					name: 'wait',
					type: 'boolean',
					default: true,
					description:
						'Whether to wait when a slow tool keeps running in the background. Turn off to get the run ID right away.',
				},
			],
		},
	],

	async execute(operation, itemIndex) {
		if (operation === 'search') {
			const query = (this.getNodeParameter('query', itemIndex) as string).trim();
			if (!query) {
				throw new NodeOperationError(this.getNode(), 'Query is empty', {
					description: 'Describe the job, for example "google search results".',
					itemIndex,
				});
			}
			const limit = this.getNodeParameter('maxResults', itemIndex, 10) as number;
			const data = await toolRingApiRequest.call(this, 'POST', '/tools/discover', {
				body: { query, limit },
				itemIndex,
			});
			return Array.isArray(data.results) ? (data.results as IDataObject[]) : [];
		}

		const toolId = String(
			this.getNodeParameter('tool', itemIndex, '', { extractValue: true }) ?? '',
		).trim();
		if (!toolId) {
			throw new NodeOperationError(this.getNode(), 'No tool selected', {
				description: 'Pick a tool from the list or enter a tool ID such as 1toolring/fx/convert.',
				itemIndex,
			});
		}

		if (operation === 'get') {
			return await toolRingApiRequest.call(this, 'POST', '/tools/inspect', {
				body: { tool: toolId },
				itemIndex,
			});
		}

		// ----------------------------- run -----------------------------
		const additional = this.getNodeParameter('additionalInput', itemIndex, {}) as IDataObject;
		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const input: IDataObject = {};
		const body = readJsonObject(
			this,
			this.getNodeParameter('body', itemIndex, '{}'),
			'Body',
			itemIndex,
		);
		const queryParams = readJsonObject(this, additional.queryParams, 'Query Parameters', itemIndex);
		const pathParams = readJsonObject(this, additional.pathParams, 'Path Parameters', itemIndex);
		if (body) input.body = body;
		if (queryParams) input.queryParams = queryParams;
		if (pathParams) input.pathParams = pathParams;

		let run = await toolRingApiRequest.call(this, 'POST', '/tools/run', {
			body: { tool: toolId, input },
			itemIndex,
			idempotent: false,
		});

		if (run.status === 'running' && options.wait !== false && run.run_id) {
			const intervalMs = Math.max(0, Number(options.pollInterval ?? 4)) * 1000;
			const deadline = Date.now() + Math.max(0, Number(options.maxWait ?? 120)) * 1000;
			while (run.status === 'running' && Date.now() + intervalMs <= deadline) {
				await sleep(intervalMs);
				run = await toolRingApiRequest.call(
					this,
					'GET',
					`/tools/runs/${encodeURIComponent(String(run.run_id))}`,
					{ itemIndex },
				);
			}
		}

		if (run.status === 'failed') {
			const reason = typeof run.provider_error === 'string' ? run.provider_error : '';
			throw new NodeOperationError(
				this.getNode(),
				`The tool run failed${reason ? `: ${reason}` : ''}`,
				{
					description: `Run ${String(run.run_id ?? '')}${
						run.provider_status ? `, provider status ${String(run.provider_status)}` : ''
					}. A failed run is not charged.`,
					itemIndex,
				},
			);
		}

		if (options.outputOnly === true && run.status === 'completed') {
			const output = run.output;
			if (Array.isArray(output)) {
				return output.map((entry) =>
					entry && typeof entry === 'object' && !Array.isArray(entry)
						? (entry as IDataObject)
						: { value: entry },
				);
			}
			if (output && typeof output === 'object') return output as IDataObject;
			return { output: output ?? null };
		}
		return run;
	},
};
