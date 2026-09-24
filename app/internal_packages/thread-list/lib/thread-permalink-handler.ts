import url from 'url';
import querystring from 'querystring';
import { ipcRenderer } from 'electron';
import { localized, DatabaseStore, Thread, Matcher, Actions } from 'summermail-exports';

const DATE_EPSILON = 60; // Seconds

interface SummerMailLinkParams {
  subject: string;
  lastDate?: number;
  date?: number;
}

const _parseOpenThreadUrl = (summermailUrlString: string) => {
  const parsedUrl = url.parse(summermailUrlString);
  const params = querystring.parse(parsedUrl.query) as any;
  return {
    subject: params.subject,
    date: params.date ? parseInt(params.date, 10) : undefined,
    lastDate: params.lastDate ? parseInt(params.lastDate, 10) : undefined,
  } as SummerMailLinkParams;
};

const _findCorrespondingThread = (
  { subject, lastDate, date }: SummerMailLinkParams,
  dateEpsilon = DATE_EPSILON
) => {
  const dateClause = date
    ? new Matcher.And([
        Thread.attributes.firstMessageTimestamp.lessThan(new Date((date + dateEpsilon) * 1000)),
        Thread.attributes.firstMessageTimestamp.greaterThan(new Date((date - dateEpsilon) * 1000)),
      ])
    : new Matcher.Or([
        new Matcher.And([
          Thread.attributes.lastMessageSentTimestamp.lessThan(
            new Date((lastDate + dateEpsilon) * 1000)
          ),
          Thread.attributes.lastMessageSentTimestamp.greaterThan(
            new Date((lastDate - dateEpsilon) * 1000)
          ),
        ]),
        new Matcher.And([
          Thread.attributes.lastMessageReceivedTimestamp.lessThan(
            new Date((lastDate + dateEpsilon) * 1000)
          ),
          Thread.attributes.lastMessageReceivedTimestamp.greaterThan(
            new Date((lastDate - dateEpsilon) * 1000)
          ),
        ]),
      ]);

  return DatabaseStore.findBy<Thread>(Thread).where([
    Thread.attributes.subject.equal(subject),
    dateClause,
  ]);
};

const _onOpenThreadFromWeb = (event: Electron.IpcRendererEvent, summermailUrl: string) => {
  const params = _parseOpenThreadUrl(summermailUrl);

  _findCorrespondingThread(params)
    .then((thread) => {
      if (!thread) {
        throw new Error('Thread not found');
      }
      Actions.popoutThread(thread);
    })
    .catch((error) => {
      AppEnv.reportError(error);
      AppEnv.showErrorDialog(
        localized(`The thread %@ does not exist in your mailbox!`, params.subject)
      );
    });
};

export function activate() {
  ipcRenderer.on('openThreadFromWeb', _onOpenThreadFromWeb);
}
