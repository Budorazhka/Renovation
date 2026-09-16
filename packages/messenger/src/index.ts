export {
  MessengerAccountDocument,
  MessengerAccountSchema,
  MESSENGER_PLATFORMS,
  MESSENGER_ACCOUNT_TYPES,
  MESSENGER_AUTH_STATUSES,
  type MessengerPlatform,
  type MessengerAccountType,
  type MessengerAuthStatus,
} from './schemas/messenger-account.schema';
export {
  MessengerDialogDocument,
  MessengerDialogSchema,
  type DialogLastMessage,
} from './schemas/messenger-dialog.schema';
export {
  MessengerMessageDocument,
  MessengerMessageSchema,
  MESSAGE_AUTHORS,
  MESSAGE_TYPES,
  MESSAGE_STATUSES,
  type MessageAuthor,
  type MessageType,
  type MessageStatus,
  type MessageMedia,
} from './schemas/messenger-message.schema';

export {
  MessengerAccountRepository,
  type CreateMessengerAccountParams,
} from './repository/messenger-account.repository';
export {
  MessengerDialogRepository,
  encodeDialogListCursor,
  decodeDialogListCursor,
  type CreateMessengerDialogParams,
  type ListDialogsFilter,
  type DialogListCursor,
} from './repository/messenger-dialog.repository';
export {
  MessengerMessageRepository,
  type CreateMessengerMessageParams,
  type ListMessagesFilter,
} from './repository/messenger-message.repository';

export {
  TelegramBotClient,
  TelegramApiError,
  type TelegramGetMeResult,
  type TelegramSendMessageResult,
  type TelegramIncomingUpdate,
} from './telegram-bot.client';
