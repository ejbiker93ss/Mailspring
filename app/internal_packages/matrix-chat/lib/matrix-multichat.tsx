import MatrixChatStore from './matrix-chat-store';
import MatrixConversation from './matrix-conversation';
import { createMultiChat } from './chat-multichat';

export default createMultiChat(
  {
    listen: (callback) => MatrixChatStore.listen(callback),
    selectedChatId: () => MatrixChatStore.selectedRoomId(),
    selectedChat: (id) => MatrixChatStore.selectedRoom(id),
    isChatHidden: () => false,
    setVisibleChats: (ids) => MatrixChatStore.setVisibleRooms(ids),
  },
  MatrixConversation,
  'MatrixConversation'
);
