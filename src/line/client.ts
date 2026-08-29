import { messagingApi } from '@line/bot-sdk';
import { config } from '../config.js';

export const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN,
});

export const lineBlobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN,
});
