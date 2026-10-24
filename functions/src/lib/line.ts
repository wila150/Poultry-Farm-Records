import { messagingApi } from '@line/bot-sdk';
import { logger } from 'firebase-functions';
import { LINE_CHANNEL_ACCESS_TOKEN } from './config';
import { db } from './firebase';

let client: messagingApi.MessagingApiClient | null = null;

export function lineClient() {
  client ??= new messagingApi.MessagingApiClient({ channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN.value() });
  return client;
}

export function linkMessage(text: string, label: string, uri: string): messagingApi.Message {
  return {
    type: 'template',
    altText: text,
    template: { type: 'buttons', text, actions: [{ type: 'uri', label, uri }] },
  };
}

/** 推播按「人數 × 則數」計費，呼叫前請先確認真的需要推。失敗只記錄，不中斷其他人的推播。 */
export async function push(to: string, messages: messagingApi.Message[]) {
  try {
    await lineClient().pushMessage({ to, messages });
  } catch (err) {
    logger.error('LINE push failed', { to, err });
  }
}

/** 找出某雞場的啟用中場長；沒有場長時改找老闆 */
export async function farmManagerIds(farmId: string): Promise<string[]> {
  const managers = await db
    .collection('users')
    .where('status', '==', 'active')
    .where('role', '==', 'manager')
    .where('farmIds', 'array-contains', farmId)
    .get();
  if (!managers.empty) return managers.docs.map((d) => d.id);
  return ownerIds();
}

export async function ownerIds(): Promise<string[]> {
  const owners = await db.collection('users').where('status', '==', 'active').where('role', '==', 'owner').get();
  return owners.docs.map((d) => d.id);
}
