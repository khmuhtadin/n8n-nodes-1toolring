import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const dist = resolve('dist');
const { OneToolRing } = require(resolve(dist, 'nodes/OneToolRing/OneToolRing.node.js'));
const { searchTools, priceLabel } = require(resolve(dist, 'nodes/OneToolRing/methods.js'));
const BASE = 'https://api.1toolring.com/api/v1';

/** `responses` entries are either a value to return or an Error to throw, used in order. */
function mock(params, responses = [{}], { continueOnFail = false, items = 1 } = {}) {
	const calls = [];
	const ctx = {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter(name, _index, fallback, options) {
			const v = Object.hasOwn(params, name) ? params[name] : fallback;
			return options?.extractValue && v && typeof v === 'object' ? v.value : v;
		},
		getNode: () => ({ name: '1ToolRing', type: 'test', typeVersion: 1 }),
		continueOnFail: () => continueOnFail,
		helpers: {
			async httpRequestWithAuthentication(credential, request) {
				calls.push({ credential, ...request });
				const r = responses[Math.min(calls.length - 1, responses.length - 1)];
				if (r instanceof Error) throw r;
				return r;
			},
		},
	};
	return { ctx, calls };
}
const exec = async (params, responses, opts) => {
	const { ctx, calls } = mock(params, responses, opts);
	const out = await new OneToolRing().execute.call(ctx);
	return { calls, items: out[0] };
};
const httpError = (status, body, headers = {}) =>
	Object.assign(new Error(`Request failed with status code ${status}`), {
		httpCode: String(status),
		response: { status, body, headers },
	});

test('description is usable as a tool and lists both resources', () => {
	const d = new OneToolRing().description;
	assert.equal(d.name, 'oneToolRing');
	assert.equal(d.usableAsTool, true);
	const resource = d.properties.find((p) => p.name === 'resource');
	assert.deepEqual(
		resource.options.map((o) => o.value),
		['run', 'tool'],
	);
});

test('tool search posts to discover and returns one item per tool', async () => {
	const { calls, items } = await exec(
		{ resource: 'tool', operation: 'search', query: ' exchange rate ', maxResults: 2 },
		[{ data: { count: 2, results: [{ id: 'a/b' }, { id: 'c/d' }] }, success: true }],
	);
	assert.equal(calls[0].credential, 'oneToolRingApi');
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, `${BASE}/tools/discover`);
	assert.deepEqual(calls[0].body, { query: 'exchange rate', limit: 2 });
	assert.deepEqual(
		items.map((i) => i.json.id),
		['a/b', 'c/d'],
	);
	assert.deepEqual(items[0].pairedItem, { item: 0 });
});

test('tool search rejects an empty query before calling the API', async () => {
	const { ctx, calls } = mock({ resource: 'tool', operation: 'search', query: '  ' });
	await assert.rejects(new OneToolRing().execute.call(ctx), /Query is empty/);
	assert.equal(calls.length, 0);
});

test('tool get posts to inspect', async () => {
	const { calls, items } = await exec(
		{ resource: 'tool', operation: 'get', tool: { mode: 'id', value: '1toolring/fx/convert' } },
		[{ data: { id: '1toolring/fx/convert', input_schema: { body: {} } } }],
	);
	assert.equal(calls[0].url, `${BASE}/tools/inspect`);
	assert.deepEqual(calls[0].body, { tool: '1toolring/fx/convert' });
	assert.equal(items[0].json.id, '1toolring/fx/convert');
});

test('tool run sends only the input parts that have content', async () => {
	const { calls, items } = await exec(
		{
			resource: 'tool',
			operation: 'run',
			tool: { value: 'p/t' },
			body: '{"from":"USD","to":"IDR","amount":1}',
			additionalInput: { queryParams: { page: 2 }, pathParams: '{}' },
		},
		[{ data: { run_id: 'run_1', status: 'completed', output: { result: 1 }, cost: { idr: 5 } } }],
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, `${BASE}/tools/run`);
	assert.deepEqual(calls[0].body, {
		tool: 'p/t',
		input: { body: { from: 'USD', to: 'IDR', amount: 1 }, queryParams: { page: 2 } },
	});
	assert.equal(items[0].json.run_id, 'run_1');
	assert.deepEqual(items[0].json.cost, { idr: 5 });
});

test('tool run polls a running run until it completes', async () => {
	const { calls, items } = await exec(
		{
			resource: 'tool',
			operation: 'run',
			tool: { value: 'p/slow' },
			options: { pollInterval: 0, maxWait: 5 },
		},
		[
			{ data: { run_id: 'run_2', status: 'running' } },
			{ data: { run_id: 'run_2', status: 'running' } },
			{ data: { run_id: 'run_2', status: 'completed', output: [1] } },
		],
	);
	assert.equal(calls.length, 3);
	assert.equal(calls[1].method, 'GET');
	assert.equal(calls[1].url, `${BASE}/tools/runs/run_2`);
	assert.equal(items[0].json.status, 'completed');
});

test('tool run returns the running run when waiting is off or time is up', async () => {
	for (const options of [{ wait: false }, { pollInterval: 1, maxWait: 0 }]) {
		const { calls, items } = await exec(
			{ resource: 'tool', operation: 'run', tool: { value: 'p/slow' }, options },
			[{ data: { run_id: 'run_3', status: 'running' } }],
		);
		assert.equal(calls.length, 1);
		assert.equal(items[0].json.status, 'running');
	}
});

test('tool run throws on a failed run, or reports it with continue on fail', async () => {
	const failed = [
		{ data: { run_id: 'run_4', status: 'failed', provider_status: 500, provider_error: 'boom' } },
	];
	const params = { resource: 'tool', operation: 'run', tool: { value: 'p/t' } };
	const { ctx } = mock(params, failed);
	await assert.rejects(
		new OneToolRing().execute.call(ctx),
		(e) => /run failed: boom/.test(e.message) && /not charged/.test(e.description),
	);
	const { items } = await exec(params, failed, { continueOnFail: true });
	assert.match(items[0].json.error, /boom/);
});

test('tool run output-only returns the tool answer', async () => {
	const params = {
		resource: 'tool',
		operation: 'run',
		tool: { value: 'p/t' },
		options: { outputOnly: true },
	};
	const a = await exec(params, [{ data: { status: 'completed', output: { rate: 2 } } }]);
	assert.deepEqual(a.items[0].json, { rate: 2 });
	const b = await exec(params, [{ data: { status: 'completed', output: [{ a: 1 }, 'x'] } }]);
	assert.deepEqual(
		b.items.map((i) => i.json),
		[{ a: 1 }, { value: 'x' }],
	);
	const c = await exec(params, [{ data: { status: 'completed', output: null } }]);
	assert.deepEqual(c.items[0].json, { output: null });
});

test('tool run rejects invalid or non-object JSON without calling the API', async () => {
	for (const [body, pattern] of [
		['{', /Body is not valid JSON/],
		['[1]', /Body must be a JSON object/],
	]) {
		const { ctx, calls } = mock({
			resource: 'tool',
			operation: 'run',
			tool: { value: 'p/t' },
			body,
		});
		await assert.rejects(new OneToolRing().execute.call(ctx), pattern);
		assert.equal(calls.length, 0);
	}
});

test('a paid run is not repeated after a server error', async () => {
	const { ctx, calls } = mock({ resource: 'tool', operation: 'run', tool: { value: 'p/t' } }, [
		httpError(503, { error: { code: 'UPSTREAM_ERROR', message: 'Provider unreachable' } }),
	]);
	await assert.rejects(
		new OneToolRing().execute.call(ctx),
		(e) => e.message === 'Provider unreachable' && e.httpCode === '503',
	);
	assert.equal(calls.length, 1);
});

test('a free call is retried after a 429 with Retry-After', async () => {
	const { calls, items } = await exec({ resource: 'run', operation: 'get', runId: 'run_5' }, [
		httpError(
			429,
			{ error: { code: 'RATE_LIMITED', message: 'slow down' } },
			{
				'retry-after': '0.01',
			},
		),
		{ data: { run_id: 'run_5', status: 'completed' } },
	]);
	assert.equal(calls.length, 2);
	assert.equal(items[0].json.run_id, 'run_5');
});

test('insufficient balance explains the balance and the top-up page', async () => {
	const { ctx } = mock({ resource: 'tool', operation: 'run', tool: { value: 'p/t' } }, [
		httpError(402, {
			error: {
				code: 'INSUFFICIENT_BALANCE',
				message: 'Your balance is too low for this call.',
				balance: { usd: 0, idr: 0 },
				needed: { usd: 0.0033, idr: 60 },
				topup_url: 'https://app.1toolring.com/billing',
			},
		}),
	]);
	await assert.rejects(
		new OneToolRing().execute.call(ctx),
		(e) =>
			e.message === 'Your balance is too low for this call.' &&
			e.description.includes('Balance $0 / Rp0, this call needs $0.0033 / Rp60.') &&
			e.description.includes('https://app.1toolring.com/billing'),
	);
});

test('run get many follows the cursor and respects the limit', async () => {
	const pages = [
		{ data: { runs: [{ run_id: 'a' }, { run_id: 'b' }], next_cursor: 'b' } },
		{ data: { runs: [{ run_id: 'c' }, { run_id: 'd' }], next_cursor: 'd' } },
		{ data: { runs: [], next_cursor: '' } },
	];
	const all = await exec({ resource: 'run', operation: 'getAll', returnAll: true }, pages);
	assert.equal(all.items.length, 4);
	assert.deepEqual(all.calls[0].qs, { limit: 50 });
	assert.deepEqual(all.calls[1].qs, { limit: 50, cursor: 'b' });
	const some = await exec(
		{ resource: 'run', operation: 'getAll', returnAll: false, limit: 3 },
		pages,
	);
	assert.equal(some.items.length, 3);
	assert.deepEqual(some.calls[0].qs, { limit: 3 });
	assert.deepEqual(some.calls[1].qs, { limit: 1, cursor: 'b' });
});

test('tool picker searches by the typed words and shows the price', async () => {
	const { ctx, calls } = mock({}, [
		{
			data: {
				results: [
					{
						id: 'x/y',
						description: 'Does a thing',
						price: { model: 'per_call', amount: { usd: 0.003, idr: 60 }, unit_label: 'call' },
					},
				],
			},
		},
	]);
	const { results } = await searchTools.call(ctx, '  maps ');
	assert.deepEqual(calls[0].body, { query: 'maps', limit: 20 });
	assert.deepEqual(results, [
		{ name: 'x/y ($0.003 per call)', value: 'x/y', description: 'Does a thing' },
	]);
	await searchTools.call(ctx, '');
	assert.equal(calls[1].body.query, 'search');
	assert.equal(priceLabel({ model: 'free' }), 'free');
	assert.equal(priceLabel({ model: 'per_result', amount: { usd: 0.1 } }), '$0.1 per result');
	assert.equal(priceLabel(undefined), '');
});
