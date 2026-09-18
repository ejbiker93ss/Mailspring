import React from 'react';
interface ChatStore {
  listen(callback: () => void): () => void;
  selectedChatId(): string | null;
  selectedChat(id: string): unknown;
  isChatHidden(id: string): boolean;
  setVisibleChats(ids: string[]): void;
}

export function recentChats(ids: string[], selected: string) {
  return [selected, ...ids.filter((id) => id !== selected)].slice(0, 12);
}

export function chatPaneCount(width: number) {
  return Math.max(1, Math.min(4, Math.floor(width / 420)));
}

export function createMultiChat(
  GroupMeChatStore: ChatStore,
  GroupMeConversation: React.ComponentType<{ chatId?: string }>,
  name: string
) {
  // Keep each provider's open chats when its workspace is unmounted by tab navigation.
  let openChatIds: string[] = [];
  return class MultiChat extends React.Component {
    static displayName = name;
    static containerStyles = { minWidth: 420, maxWidth: 10000 };
    state = { ids: openChatIds, width: 0 };
    private root = React.createRef<HTMLDivElement>();
    private observer?: ResizeObserver;
    private unlisten?: () => void;
    private selected: string | null = null;
    private visible = '';

    componentDidMount() {
      this.unlisten = GroupMeChatStore.listen(this.onStoreChange);
      this.observer = new ResizeObserver((entries) =>
        this.setState({ width: entries[0].contentRect.width })
      );
      if (this.root.current) this.observer.observe(this.root.current);
      this.onStoreChange();
    }

    componentDidUpdate() {
      const ids = this.state.ids.slice(0, chatPaneCount(this.state.width));
      const key = ids.join('|');
      if (key !== this.visible) {
        this.visible = key;
        GroupMeChatStore.setVisibleChats(ids);
      }
    }

    componentWillUnmount() {
      this.unlisten?.();
      this.observer?.disconnect();
      GroupMeChatStore.setVisibleChats([]);
    }

    onStoreChange = () => {
      const selected = GroupMeChatStore.selectedChatId();
      this.setState(({ ids }: { ids: string[] }) => {
        let next = ids.filter(
          (id) => GroupMeChatStore.selectedChat(id) && !GroupMeChatStore.isChatHidden(id)
        );
        if (selected && selected !== this.selected) next = recentChats(next, selected);
        this.selected = selected;
        openChatIds = next;
        return { ids: next };
      });
    };

    render() {
      const ids = this.state.ids.slice(0, chatPaneCount(this.state.width));
      return (
        <div className="groupme-multichat" ref={this.root}>
          {ids.length ? (
            ids.map((id) => <GroupMeConversation key={id} chatId={id} />)
          ) : (
            <GroupMeConversation />
          )}
        </div>
      );
    }
  };
}
