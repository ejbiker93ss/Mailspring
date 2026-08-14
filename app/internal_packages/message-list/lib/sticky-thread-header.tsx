/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- Ported legacy plugin module; compiled by the first-party TypeScript pipeline.
import { React } from 'mailspring-exports';

const STYLE_ID = 'ejbiker93ss-sticky-thread-header-styles';
const ROOT_CLASS = 'ejbiker93ss-sticky-thread-header';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #message-list.${ROOT_CLASS} .message-subject-wrap {
      position: sticky;
      top: 0;
      z-index: 30;
      margin-top: 0;
      margin-bottom: 5px;
      padding-top: 5px;
      padding-bottom: 10px;
      /* Keep sticky subject actions clear of ScrollRegion's 17px overlay track. */
      padding-right: 29px;
    }
  `;

  document.head.appendChild(style);
}

export default class StickyThreadHeader extends React.Component {
  static displayName = 'StickyThreadHeader';

  static containerRequired = false;

  componentDidMount() {
    ensureStyles();
    this._applyStickyLayout();
    window.addEventListener('resize', this._applyStickyLayout);

    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._applyStickyLayout());
      const messageList = this._messageList();
      const subjectWrap = this._subjectWrap();
      if (messageList) {
        this._resizeObserver.observe(messageList);
      }
      if (subjectWrap) {
        this._resizeObserver.observe(subjectWrap);
      }
    }
  }

  componentDidUpdate(prevProps) {
    const prevThread = prevProps.thread || (prevProps.items && prevProps.items[0]);
    const currentThread = this.props.thread || (this.props.items && this.props.items[0]);
    if (prevThread !== currentThread) {
      this._applyStickyLayout();
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this._applyStickyLayout);

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    const messageList = this._messageList();
    const subjectWrap = this._subjectWrap();

    if (messageList) {
      messageList.classList.remove(ROOT_CLASS);
    }

    if (subjectWrap) {
      subjectWrap.style.removeProperty('background');
      subjectWrap.style.removeProperty('box-shadow');
    }
  }

  _messageList() {
    return this._anchor ? this._anchor.closest('#message-list') : null;
  }

  _subjectWrap() {
    const messageList = this._messageList();
    return messageList ? messageList.querySelector('.message-subject-wrap') : null;
  }

  _applyStickyLayout = () => {
    const messageList = this._messageList();
    const subjectWrap = this._subjectWrap();
    if (!messageList || !subjectWrap) {
      return;
    }

    const messageListStyle = window.getComputedStyle(messageList);
    const background =
      messageListStyle.backgroundColor && messageListStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
        ? messageListStyle.backgroundColor
        : messageListStyle.background || '#fff';

    messageList.classList.add(ROOT_CLASS);
    subjectWrap.style.background = background;
    subjectWrap.style.boxShadow = '0 1px 0 rgba(0, 0, 0, 0.08)';
  };

  render() {
    return (
      <span
        ref={(el) => {
          this._anchor = el;
        }}
        style={{ display: 'none' }}
      />
    );
  }
}
