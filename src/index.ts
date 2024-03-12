import { InteractionResponseFlags, InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';

export interface Env {
	prod_thanks: KVNamespace;
}

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		const signature = request.headers.get('X-Signature-Ed25519');
		const timestamp = request.headers.get('X-Signature-Timestamp');
		const rawBody = await request.clone().text();
		//@ts-ignore
		const isValidRequest = verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);

		if (!isValidRequest) {
			return new Response('Invalid signture', { status: 401 });
		}

		const json: any = await request.json();

		if (json.type === InteractionType.PING) {
			return new Response(JSON.stringify({
				type: InteractionResponseType.PONG
			}));
		}

		const response = await handleResponse(json, env);

		return new Response(response, {
			headers: {
				'Content-type': 'application/json'
			}
		});
	}

}


export async function handleResponse(json: any, env: Env): Promise<string> {
	if (json.type === InteractionType.APPLICATION_COMMAND) {
		if (json.data.name === 'Thank' || json.data.name === 'thank') {
			return await handleThankUser(json, env);
		}

		if (json.data.name === 'my_thanks') {
			return await handleCheckMyThanks(json, env);
		}
	}
	// Didn't catch a command, something went wrong
	return JSON.stringify({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			flags: InteractionResponseFlags.EPHEMERAL,
			content: 'Something went wrong. Please try again.'
		}
	})
}

export async function handleThankUser(json: any, env: Env): Promise<string> {
	// Invoking user is retrieved from a different field depending on
	// if the command was used in a DM or a server
	const invokingUserId = json.member?.user.id || json.user.id;

	// The target user can come from one of three sources
	// 1. A user option of a slash command
	// 2. The target of a user context menu command
	// 3. The author of a message context menu command
	let thankedUserId;
	switch (json.data.type) {
		case 1:
			thankedUserId = json.data.options[0]['value'];
			break;
		case 2:
			thankedUserId = json.data.target_id;
			break;
		case 3:
			thankedUserId = (Object.values(json.data.resolved.messages) as any[])[0].author.id;
			break;
		default:
	}

	if (!thankedUserId || !invokingUserId) {
		// Couldn't fetch the two users
		return JSON.stringify({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				flags: InteractionResponseFlags.EPHEMERAL,
				content: 'Something went wrong. Please try again.'
			}
		});
	}

	if (thankedUserId === invokingUserId) {
		// Can't thank yourself
		return JSON.stringify({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				flags: InteractionResponseFlags.EPHEMERAL,
				content: 'You can\'t thank yourself!'
			}
		});
	}

	await incrementThankedUser(env, thankedUserId);

	return JSON.stringify({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `<@${thankedUserId}> -- you received thanks from <@${invokingUserId}>!`
		}
	});
}

export async function handleCheckMyThanks(json: any, env: Env): Promise<string> {
	// Invoking user is retrieved from a different field depending on
	// if the command was used in a DM or a server
	const invokingUserId = json.member?.user.id || json.user.id;

	const thanksCount = await checkMyThanks(invokingUserId, env);

	return JSON.stringify({
		type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: thanksCount === 0 ? 
						`You don't have any thanks yet!` : 
						`You've received ${thanksCount} thanks :tada:`
		}
	});
}

export async function checkMyThanks(userId: string, env: Env): Promise<number> {
	const response = await env.prod_thanks.get(userId);
	// convert to number
	const myThanks = response ? parseInt(response) : 0;
	return myThanks;
}

export async function incrementThankedUser(env: Env, userId: string): Promise<void> {
	let response = await env.prod_thanks.get(userId);
	// convert to number
	const currentThanks = response ? parseInt(response) : 0;
	const newValue = currentThanks + 1;
	await env.prod_thanks.put(userId, newValue.toString());
}
