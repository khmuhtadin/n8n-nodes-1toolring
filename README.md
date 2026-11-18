# n8n-nodes-1toolring

[1ToolRing](https://1toolring.com) puts a catalog of pay-per-call tools behind one API key and one prepaid balance: live Google results, keyword volume, Google Maps places, e-commerce product prices, stock, crypto and exchange-rate data, social media data, web scraping and more. Every tool shows its price before you run it, and a failed call is not charged.

This community package adds a **1ToolRing** node to n8n. You can use it as a regular node in a workflow or connect it to an AI Agent as a tool.

## Installation

In a self-hosted n8n instance, go to **Settings > Community Nodes > Install**, enter `n8n-nodes-1toolring` and confirm. See [n8n's installation instructions](https://docs.n8n.io/integrations/community-nodes/installation/) for more options.

## Credentials

1. Sign up at [app.1toolring.com](https://app.1toolring.com) and verify your email.
2. Create an API key on the [Keys page](https://app.1toolring.com/keys). The key starts with `aip_live_` and is shown once.
3. In n8n, create a **1ToolRing API** credential and paste the key.

Tools are paid from your prepaid 1ToolRing balance. You can see and top up the balance on the [Billing page](https://app.1toolring.com/billing).

## Operations

| Resource | Operation | What it does                                                                                      | Price            |
| -------- | --------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| Tool     | Search    | Finds tools for a job you describe in plain words. Returns each tool's ID, description and price. | Free             |
| Tool     | Get       | Returns one tool's input schema, price, notes and health.                                         | Free             |
| Tool     | Run       | Runs a tool with your input and returns the result, the status and the exact cost.                | The tool's price |
| Run      | Get       | Returns the status, result and cost of one run.                                                   | Free             |
| Run      | Get Many  | Lists your runs, newest first.                                                                    | Free             |

The API reference is at [docs.1toolring.com/reference/tools](https://docs.1toolring.com/reference/tools/).

## How to use it

The flow is always the same: search, check, run.

1. **Tool > Search** with a query such as `google search results for a keyword`. Note the tool ID you want, for example `1toolring/fx/convert`.
2. **Tool > Get** with that ID. The `input_schema` tells you which fields the tool accepts. It has up to three parts: `body`, `queryParams` and `pathParams`.
3. **Tool > Run** with the same ID. Put the `body` fields in **Body** as a JSON object. If the schema lists `queryParams` or `pathParams`, add them under **Additional Input**.

In the Run operation you can also pick the tool from a list. Type the job into the list's search box and each match shows its price.

Example Body for `1toolring/fx/convert`:

```json
{ "from": "USD", "to": "IDR", "amount": 100 }
```

The output of Tool > Run looks like this:

```json
{
	"run_id": "run_01JC8Q4Z6N4M2V9W3X7Y5T1R0P",
	"tool": "1toolring/fx/convert",
	"status": "completed",
	"output": { "from": "USD", "to": "IDR", "amount": 100, "rate": 18249, "result": 1824900 },
	"provider_status": 200,
	"cost": { "usd": 0.000274, "idr": 5 },
	"held": { "usd": 0, "idr": 0 }
}
```

`output` is the tool's own answer, passed through as is. `cost` is what was actually charged. Turn on **Options > Return Only Tool Output** if you only want the answer.

### Slow tools

Some tools, such as a large business listings search, take longer than one request. The node then waits and checks the run every few seconds until it finishes. Checking is free. You can change this under **Options**:

- **Wait for Completion**: turn off to get the run ID right away.
- **Polling Interval (Seconds)**: default 4.
- **Max Wait (Seconds)**: default 120. When the time is up, the node returns the run with status `running`. Read the result later with **Run > Get**.

### Errors

- **401**: the key is missing, wrong or revoked. Check the credential.
- **402 `INSUFFICIENT_BALANCE`**: the balance cannot cover the call. The error shows your balance, the amount needed and the top-up page.
- **400 `VALIDATION_ERROR`**: the input does not match the tool. Compare it with the schema from Tool > Get.
- **400 `RUN_TOO_LARGE`**: the run could cost more than the per-run cap. Ask for fewer results or split the job.
- **404 `TOOL_NOT_FOUND`**: check the tool ID with Tool > Search.
- **429**: the limit is 60 requests per minute per key. The node waits and tries again up to three times.
- A run whose provider fails comes back as a node error with the provider's reason. A failed run is not charged.

The node retries free calls after a 429 or a temporary server error. A paid run is retried only after a 429, where nothing ran and nothing was charged, so a tool is never run twice by the node.

## Use as an AI Agent tool

Connect the 1ToolRing node to the **Tool** input of an AI Agent. A setup that works well is three copies of the node, one per step, so the agent can search, check and run on its own:

- Tool > Search, with **Query** set by the model.
- Tool > Get, with **Tool** (By ID) set by the model.
- Tool > Run, with **Tool** (By ID) and **Body** set by the model.

To limit what the agent can spend, give it only a Tool > Run node with a fixed tool, or set a spending cap on the key in the 1ToolRing console. On self-hosted instances, community nodes as tools may need `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`.

## Example workflows

Import these from the n8n editor with **Workflow menu > Import from File**, then select your 1ToolRing credential:

- [Convert a currency](examples/convert-currency.json): runs `1toolring/fx/convert` once (Rp5 per call at the time of writing).
- [Find a tool and read its price](examples/find-a-tool.json): searches the catalog and reads the first match's input schema. Free.

Tool runs are charged. Check the price with Tool > Get before you run a tool you have not used before.

## Compatibility

Requires Node.js 20 or newer. Built and tested with `@n8n/node-cli` 0.57 against the live 1ToolRing API. The package has no runtime dependencies.

## Development

```bash
npm install
npm run lint
npm test
TOOLRING_API_KEY=aip_live_... npm run smoke   # live check, spends Rp5
npm run dev                                   # starts n8n with the node loaded
```

## Resources

- [1ToolRing documentation](https://docs.1toolring.com/overview/)
- [Tool catalog and prices](https://1toolring.com/tools/)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)
