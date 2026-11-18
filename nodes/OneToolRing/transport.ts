import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions;

export const BASE_URL = 'https://api.1toolring.com/api/v1';

/** A 429 is always safe to repeat: the API refused the call before doing or charging anything. */
const RETRY_ALWAYS = new Set([429]);
/** Transient server errors, repeated only for calls that are free and have no side effect. */
const RETRY_IDEMPOTENT = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 30_000;

export interface RequestOptions {
	body?: IDataObject;
	qs?: IDataObject;
	/** Item index, used for error reporting. */
	itemIndex?: number;
	/**
	 * Set false for a paid call (running a tool). It is then repeated only after a 429,
	 * never after a server error, so a tool is not run and charged twice.
	 */
	idempotent?: boolean;
}

function statusOf(error: unknown): number | undefined {
	const e = error as {
		httpCode?: string | number;
		response?: { status?: number };
		status?: number;
	};
	const raw = e?.httpCode ?? e?.response?.status ?? e?.status;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function errorBodyOf(error: unknown): IDataObject | undefined {
	const e = error as {
		response?: { body?: unknown; data?: unknown };
		context?: { data?: unknown };
	};
	const body = e?.response?.body ?? e?.response?.data ?? e?.context?.data;
	if (body && typeof body === 'object') return body as IDataObject;
	if (typeof body === 'string') {
		try {
			return JSON.parse(body) as IDataObject;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function retryAfterMs(error: unknown, attempt: number): number {
	const headers = (error as { response?: { headers?: Record<string, string> } })?.response?.headers;
	const header = headers?.['retry-after'] ?? headers?.['Retry-After'];
	const seconds = Number(header);
	const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * 2 ** attempt;
	return Math.min(wait, MAX_WAIT_MS);
}

function money(value: unknown): string | undefined {
	const m = value as { usd?: number; idr?: number } | undefined;
	if (!m || typeof m !== 'object') return undefined;
	const parts: string[] = [];
	if (typeof m.usd === 'number') parts.push(`$${m.usd}`);
	if (typeof m.idr === 'number') parts.push(`Rp${m.idr}`);
	return parts.length ? parts.join(' / ') : undefined;
}

const CODE_HINTS: Record<string, string> = {
	UNAUTHORIZED: 'Check that the API key in your 1ToolRing credential is correct and not revoked.',
	INVALID_API_KEY:
		'Check that the API key in your 1ToolRing credential is correct and not revoked.',
	EMAIL_NOT_VERIFIED: 'Verify the email of your 1ToolRing account, then try again.',
	BUDGET_EXCEEDED:
		'A spending cap on this key or team is used up. Raise it at app.1toolring.com/budgets.',
	CALL_CAP_EXCEEDED: 'The call cap on this key is used up. Raise it at app.1toolring.com/budgets.',
	RUN_TOO_LARGE:
		'This run could cost more than the per-run cap. Ask for fewer results or split the job.',
	TOOL_BLOCKED:
		'This tool is not available right now. Nothing was charged. Pick another tool with Tool > Search.',
	TOOL_NOT_FOUND: 'Check the tool ID. Use Tool > Search to find the right one.',
	VALIDATION_ERROR: "Compare your input with the tool's input schema from Tool > Get.",
	RATE_LIMITED: 'The limit is 60 requests per minute per key. Slow down, then try again.',
	TOO_MANY_RUNS: 'Too many runs are in progress at once. Wait for one to finish, then try again.',
	UPSTREAM_ERROR: "The tool's provider could not answer. Nothing was charged. Try again later.",
	TOOLS_UNAVAILABLE: 'Tools are temporarily unavailable. Nothing was charged. Try again later.',
};

function describe(code: string | undefined, apiError: IDataObject): string {
	const parts: string[] = [];
	if (code) parts.push(`Code: ${code}.`);
	if (code === 'INSUFFICIENT_BALANCE') {
		const balance = money(apiError.balance);
		const needed = money(apiError.needed);
		if (balance && needed) parts.push(`Balance ${balance}, this call needs ${needed}.`);
		parts.push(`Top up at ${String(apiError.topup_url ?? 'https://app.1toolring.com/billing')}.`);
	} else if (code === 'RUN_TOO_LARGE') {
		const estimated = money(apiError.estimated);
		const cap = money(apiError.cap);
		if (estimated && cap) parts.push(`Estimated ${estimated}, cap ${cap}.`);
		parts.push(CODE_HINTS.RUN_TOO_LARGE);
	} else if (code && CODE_HINTS[code]) {
		parts.push(CODE_HINTS[code]);
	}
	return parts.join(' ');
}

/**
 * Calls the 1ToolRing API with the credential and returns the `data` part of the envelope.
 * Free calls are retried after 429 and transient 5xx. Paid calls only after 429.
 */
export async function toolRingApiRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<IDataObject> {
	const request: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		json: true,
		headers: { Accept: 'application/json' },
	};
	if (options.body !== undefined) request.body = options.body;
	if (options.qs && Object.keys(options.qs).length) request.qs = options.qs;
	const retryOn = options.idempotent === false ? RETRY_ALWAYS : RETRY_IDEMPOTENT;

	for (let attempt = 0; ; attempt++) {
		try {
			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'oneToolRingApi',
				request,
			)) as IDataObject;
			const data = response?.data;
			return data && typeof data === 'object' && !Array.isArray(data)
				? (data as IDataObject)
				: (response ?? {});
		} catch (error) {
			const status = statusOf(error);
			const body = errorBodyOf(error);
			const apiError = (body?.error ?? {}) as IDataObject;
			const code = apiError.code !== undefined ? String(apiError.code) : undefined;
			if (status !== undefined && retryOn.has(status) && attempt < MAX_RETRIES) {
				await sleep(retryAfterMs(error, attempt));
				continue;
			}
			const message = typeof apiError.message === 'string' ? apiError.message : undefined;
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: message ?? (error as Error).message,
				description: describe(code, apiError),
				httpCode: status !== undefined ? String(status) : undefined,
				itemIndex: options.itemIndex,
			});
		}
	}
}
