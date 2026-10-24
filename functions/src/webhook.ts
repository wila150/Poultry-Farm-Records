import { validateSignature, type webhook } from '@line/bot-sdk';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LIFF_URL } from './lib/config';
import { lineClient, linkMessage } from './lib/line';

// 回覆訊息（Reply）免費，所以加好友和員工主動傳訊都用 reply 回應。
export const lineWebhook = onRequest(
  { secrets: [LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET], invoker: 'public' },
  async (req, res) => {
    const signature = req.get('x-line-signature') ?? '';
    if (req.method !== 'POST' || !validateSignature(req.rawBody, LINE_CHANNEL_SECRET.value(), signature)) {
      res.status(401).send('invalid signature');
      return;
    }

    const events = (req.body as webhook.CallbackRequest).events ?? [];
    await Promise.all(
      events.map(async (event) => {
        if (!('replyToken' in event) || !event.replyToken) return;
        let text: string | null = null;
        if (event.type === 'follow') text = '歡迎加入！第一次使用請先申請帳號，場長核准後就能開始填寫每日生產紀錄。';
        else if (event.type === 'message') text = '請點下方選單「填寫每日紀錄」開始填寫喔！';
        if (!text) return;
        try {
          await lineClient().replyMessage({
            replyToken: event.replyToken,
            messages: [linkMessage(text, '開啟填寫頁面', LIFF_URL.value())],
          });
        } catch (err) {
          logger.error('LINE reply failed', err);
        }
      }),
    );
    res.status(200).send('ok');
  },
);
