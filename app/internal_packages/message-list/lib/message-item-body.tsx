import fs from 'fs';

import React from 'react';
import {
  Utils,
  MessageUtils,
  MessageBodyProcessor,
  QuotedHTMLTransformer,
  AttachmentStore,
  Message,
} from 'mailspring-exports';
import { InjectedComponentSet, RetinaImg } from 'mailspring-component-kit';

import EmailFrame from './email-frame';
import { BrowserWindow } from '@electron/remote';

const TransparentPixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNikAQAACIAHF/uBd8AAAAASUVORK5CYII=';

const SpinnerImg =
  '<img alt="spinner.gif" src="mailspring://message-list/assets/spinner.gif" style="-webkit-user-drag: none;">';

class ConditionalQuotedTextControl extends React.Component<{
  body: string;
  onClick?: () => void;
  controlRef?: (el: HTMLAnchorElement) => void;
  anchoredTop: number | null;
}> {
  static displayName = 'ConditionalQuotedTextControl';

  shouldComponentUpdate(nextProps: { body: string; anchoredTop: number | null }) {
    return this.props.body !== nextProps.body || this.props.anchoredTop !== nextProps.anchoredTop;
  }

  render() {
    if (!QuotedHTMLTransformer.hasQuotedHTML(this.props.body)) {
      return null;
    }
    return (
      <a
        className={`quoted-text-control${this.props.anchoredTop === null ? '' : ' anchored'}`}
        onClick={this.props.onClick}
        ref={this.props.controlRef}
        style={
          this.props.anchoredTop === null
            ? undefined
            : { position: 'absolute', top: this.props.anchoredTop, left: 0, zIndex: 2 }
        }
      >
        <span className="dots">&bull;&bull;&bull;</span>
      </a>
    );
  }
}

interface MessageItemBodyProps {
  message: Message;
  downloads: any;
}

interface MessageItemBodyState {
  processedBody: string;
  clipped: boolean;
  showQuotedText: boolean;
  quotedTextControlTop: number | null;
}

export default class MessageItemBody extends React.Component<
  MessageItemBodyProps,
  MessageItemBodyState
> {
  static displayName = 'MessageItemBody';

  _mounted = false;
  _unsub: () => void;
  _quotedTextControlEl: HTMLElement;

  constructor(props: MessageItemBodyProps, context: object) {
    super(props, context);

    const cached = MessageBodyProcessor.retrieveCached(props.message);

    this.state = {
      showQuotedText: props.message.isForwarded(),
      processedBody: cached ? cached.body : null,
      clipped: cached ? cached.clipped : false,
      quotedTextControlTop: null,
    };
  }

  componentDidMount() {
    this._mounted = true;
    const needInitialCallback = this.state.processedBody === null;
    this._unsub = MessageBodyProcessor.subscribe(
      this.props.message,
      needInitialCallback,
      this._onBodyProcessed
    );
  }

  componentDidUpdate(prevProps: MessageItemBodyProps) {
    if (this.props.message.id !== prevProps.message.id) {
      if (this._unsub) {
        this._unsub();
      }
      this._unsub = MessageBodyProcessor.subscribe(this.props.message, true, this._onBodyProcessed);
    }
  }

  componentWillUnmount() {
    this._mounted = false;
    if (this._unsub) {
      this._unsub();
    }
  }

  _onBodyProcessed = ({ body, clipped }) => this.setState({ processedBody: body, clipped });

  _onToggleQuotedText = () => {
    const showQuotedText = !this.state.showQuotedText;
    this.setState({
      showQuotedText,
      quotedTextControlTop:
        showQuotedText && this._quotedTextControlEl ? this._quotedTextControlEl.offsetTop : null,
    });
  };

  _onShowClipped = async () => {
    const { message } = this.props;
    const filepath = require('path').join(
      require('@electron/remote').app.getPath('temp'),
      `${message.id}.html`
    );
    // Prepend charset meta tag to ensure proper encoding (fixes garbled text for non-ASCII characters)
    const htmlWithCharset = `<meta charset="UTF-8">\n${message.body}`;
    fs.writeFileSync(filepath, htmlWithCharset);
    const win = new BrowserWindow({
      title: `${message.subject}`,
      width: 800,
      height: 600,
      webPreferences: {
        javascript: false,
        nodeIntegration: false,
      },
    });
    win.loadURL(`file://${filepath}`);
  };

  _mergeBodyWithFiles(body: string) {
    let merged = body;

    // Replace cid: references with the paths to downloaded files
    this.props.message.files
      .filter((f) => f.contentId)
      .forEach((file) => {
        const download = this.props.downloads[file.id];
        const safeContentId = Utils.escapeRegExp(file.contentId);

        // Note: I don't like doing this with RegExp before the body is inserted into
        // the DOM, but we want to avoid "could not load cid://" in the console.
        const inlineImgRegexp = new RegExp(
          `<\\s*img[^>/]*src=['"]cid:${safeContentId}['"][^>]*>`,
          'gi'
        );

        if (download && download.state !== 'finished') {
          // Render a spinner
          merged = merged.replace(inlineImgRegexp, () => SpinnerImg);
        } else {
          merged = merged.replace(inlineImgRegexp, (match) => {
            const filePath = AttachmentStore.pathForFile(file);
            if (!filePath) return match;
            return match.replace(`cid:${file.contentId}`, `file://${filePath}`);
          });
        }
      });

    // Replace remaining cid: references - we will not display them since they'll
    // throw "unknown ERR_UNKNOWN_URL_SCHEME". Show a transparent pixel so that there's
    // no "missing image" region shown, just a space.
    merged = merged.replace(MessageUtils.cidRegex, `src="${TransparentPixel}"`);

    return merged;
  }

  _renderBody() {
    const { message } = this.props;
    const { showQuotedText, processedBody } = this.state;

    if (typeof message.body === 'string' && typeof processedBody === 'string') {
      return (
        <EmailFrame
          showQuotedText={showQuotedText}
          content={this._mergeBodyWithFiles(processedBody)}
          message={message}
        />
      );
    }

    return (
      <div className="message-body-loading">
        <RetinaImg
          name="inline-loading-spinner.gif"
          mode={RetinaImg.Mode.ContentDark}
          style={{ width: 14, height: 14 }}
        />
      </div>
    );
  }

  render() {
    const body = this.props.message.body || '';
    return (
      <span>
        <InjectedComponentSet
          matching={{ role: 'message:BodyHeader' }}
          exposedProps={{ message: this.props.message }}
          direction="column"
          style={{ width: '100%' }}
        />
        <div className="message-body-with-quoted-text-control">
          {this._renderBody()}
          <ConditionalQuotedTextControl
            body={body}
            onClick={this._onToggleQuotedText}
            anchoredTop={this.state.quotedTextControlTop}
            controlRef={(el) => {
              this._quotedTextControlEl = el;
            }}
          />
        </div>
        {this.state.clipped && <a onClick={this._onShowClipped}>[Message Clipped - Show All]</a>}
      </span>
    );
  }
}
