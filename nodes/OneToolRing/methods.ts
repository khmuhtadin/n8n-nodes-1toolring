import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';
import { toolRingApiRequest } from './transport';

/** Short price label such as "$0.0033 per call" for the tool picker. */
export function priceLabel(price: unknown): string {
	const p = (price ?? {}) as IDataObject;
	if (p.model === 'free') return 'free';
	const amount = (p.amount ?? {}) as IDataObject;
	if (typeof amount.usd !== 'number') return '';
	const unit =
		typeof p.unit_label === 'string' && p.unit_label
			? p.unit_label
			: p.model === 'per_result'
				? 'result'
				: p.model === 'per_unit'
					? 'unit'
					: 'call';
	return `$${amount.usd} per ${unit}`;
}

/**
 * Searchable tool list for the Tool field (listSearch method name: 'searchTools').
 * The catalog is searched by job, so an empty filter shows a general starting set.
 */
export async function searchTools(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const query = (filter ?? '').trim() || 'search';
	const data = await toolRingApiRequest.call(this, 'POST', '/tools/discover', {
		body: { query, limit: 20 },
	});
	const tools = Array.isArray(data.results) ? (data.results as IDataObject[]) : [];
	return {
		results: tools.map((tool) => {
			const price = priceLabel(tool.price);
			return {
				name: `${String(tool.id)}${price ? ` (${price})` : ''}`,
				value: String(tool.id),
				description: typeof tool.description === 'string' ? tool.description : undefined,
			};
		}),
	};
}
