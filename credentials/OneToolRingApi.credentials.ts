import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class OneToolRingApi implements ICredentialType {
	name = 'oneToolRingApi';

	displayName = '1ToolRing API';

	icon: Icon = { light: 'file:../icons/1toolring.svg', dark: 'file:../icons/1toolring.dark.svg' };

	documentationUrl = 'https://docs.1toolring.com/authentication/api-keys/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your 1ToolRing key (starts with aip_live_). Create one at app.1toolring.com/keys. The key is shown once.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Listing runs is free and answers 401 for a missing, invalid or revoked key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.1toolring.com',
			url: '/api/v1/tools/runs',
			method: 'GET',
			qs: { limit: 1 },
		},
	};
}
