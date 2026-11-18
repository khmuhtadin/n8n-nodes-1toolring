#!/usr/bin/env node
// Local developer tool, not part of the published node runtime.
// Runs the built node against the live API. The paid step is one exchange-rate conversion (Rp5).
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const key = process.env.TOOLRING_API_KEY;
if (!key) {
	console.error('Set TOOLRING_API_KEY before running the smoke test.');
	process.exit(1);
}
const require = createRequire(import.meta.url);
const { OneToolRing } = require(resolve('dist/nodes/OneToolRing/OneToolRing.node.js'));
const { searchTools } = require(resolve('dist/nodes/OneToolRing/methods.js'));

function context(params) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _index, fallback, options) => {
			const v = Object.hasOwn(params, name) ? params[name] : fallback;
			return options?.extractValue && v && typeof v === 'object' ? v.value : v;
		},
		getNode: () => ({ name: '1ToolRing smoke test', type: 'oneToolRing', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			async httpRequestWithAuthentication(_credential, options) {
				const url = new URL(options.url);
				for (const [name, value] of Object.entries(options.qs ?? {})) {
					if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
				}
				const response = await fetch(url, {
					method: options.method,
					headers: {
						...options.headers,
						Authorization: `Bearer ${key}`,
						...(options.body ? { 'Content-Type': 'application/json' } : {}),
					},
					...(options.body ? { body: JSON.stringify(options.body) } : {}),
				});
				const text = await response.text();
				let body;
				try {
					body = JSON.parse(text);
				} catch {
					body = text;
				}
				if (!response.ok) {
					throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
						httpCode: String(response.status),
						response: { status: response.status, body, headers: {} },
					});
				}
				return body;
			},
		},
	};
}
const run = async (params) => (await new OneToolRing().execute.call(context(params)))[0];
const check = (label, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
	if (!ok) process.exitCode = 1;
};

const found = await run({
	resource: 'tool',
	operation: 'search',
	query: 'exchange rate',
	maxResults: 3,
});
check(
	'tool search',
	found.some((i) => i.json.id === '1toolring/fx/convert'),
	`${found.length} tools`,
);

const picker = await searchTools.call(context({}), 'exchange rate');
check('tool picker', picker.results.length > 0, picker.results[0]?.name);

const [detail] = await run({
	resource: 'tool',
	operation: 'get',
	tool: { value: '1toolring/fx/convert' },
});
check(
	'tool get',
	Boolean(detail.json.input_schema?.body),
	`price Rp${detail.json.price?.amount?.idr}`,
);

const [ran] = await run({
	resource: 'tool',
	operation: 'run',
	tool: { value: '1toolring/fx/convert' },
	body: { from: 'USD', to: 'IDR', amount: 1 },
});
check(
	'tool run',
	ran.json.status === 'completed' && ran.json.output != null,
	`cost Rp${ran.json.cost?.idr} ${JSON.stringify(ran.json.output).slice(0, 120)}`,
);

const [again] = await run({ resource: 'run', operation: 'get', runId: ran.json.run_id });
check('run get', again.json.run_id === ran.json.run_id, again.json.status);

const many = await run({ resource: 'run', operation: 'getAll', returnAll: false, limit: 3 });
check('run get many', many.length === 3 && Boolean(many[0].json.run_id), `${many.length} runs`);

for (const [label, params, pattern] of [
	[
		'unknown tool is a clear error',
		{ resource: 'tool', operation: 'get', tool: { value: 'nope/x' } },
		/Unknown tool/,
	],
	[
		'unknown run is a clear error',
		{ resource: 'run', operation: 'get', runId: 'run_nope' },
		/Run not found/,
	],
	[
		'bad input is a clear error',
		{
			resource: 'tool',
			operation: 'run',
			tool: { value: '1toolring/fx/convert' },
			body: { from: 'USD' },
		},
		/./,
	],
]) {
	try {
		const out = await run(params);
		check(label, false, `no error: ${JSON.stringify(out[0]?.json).slice(0, 160)}`);
	} catch (error) {
		check(
			label,
			pattern.test(error.message),
			`${error.httpCode ?? ''} ${error.message} | ${error.description ?? ''}`,
		);
	}
}
