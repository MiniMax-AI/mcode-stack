const BASE = 'https://open.feishu.cn/open-apis';

async function call(method, path, token, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.code !== undefined && data.code !== 0)) {
    const error = new Error('Feishu ' + path.split('?')[0] + ' failed: ' + response.status + ' ' + (data.code ?? '') + ' ' + (data.msg || ''));
    error.code = data.code;
    throw error;
  }
  return data;
}

export async function tenantToken(appId, appSecret) {
  const data = await call('POST', '/auth/v3/tenant_access_token/internal', null, { app_id: appId, app_secret: appSecret });
  return data.tenant_access_token;
}

export async function sendCard(token, chatId, card) {
  const data = await call('POST', '/im/v1/messages?receive_id_type=chat_id', token, { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) });
  return data.data?.message_id || null;
}

export async function updateCard(token, messageId, card) {
  await call('PATCH', '/im/v1/messages/' + messageId, token, { content: JSON.stringify(card) });
}

// Feishu checks every <at> when it builds a card and rejects the whole card
// (230099, "invalid user resource") when an email is no Feishu user. deliver sends
// or updates a card; a rejected card moves on to the next one. The last card has no
// mention, so a rejection of that one is a real error.
export const CARD_REJECTED = 230099;

export async function deliverFirstAccepted(deliver, cards) {
  for (let index = 0; ; index += 1) {
    try {
      return { result: await deliver(cards[index]), index };
    } catch (error) {
      if (error.code !== CARD_REJECTED || index === cards.length - 1) throw error;
    }
  }
}
