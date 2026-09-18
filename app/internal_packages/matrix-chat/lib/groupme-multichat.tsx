import GroupMeChatStore from './groupme-store';
import GroupMeConversation from './groupme-conversation';
import { createMultiChat } from './chat-multichat';
export { chatPaneCount, recentChats } from './chat-multichat';
export default createMultiChat(GroupMeChatStore, GroupMeConversation, 'GroupMeConversation');
