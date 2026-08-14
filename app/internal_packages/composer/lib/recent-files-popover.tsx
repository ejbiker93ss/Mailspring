import React from 'react';
import { Actions, localized, RecentFiles, RecentLocalFile } from 'mailspring-exports';
import { Menu } from 'mailspring-component-kit';

interface RecentFilesPopoverProps {
  headerMessageId: string;
  onBrowse: () => void;
}

interface RecentFilesPopoverState {
  files: RecentLocalFile[];
  loading: boolean;
  error: string;
}

function displaySize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000000) return `${Math.round(bytes / 1000)} KB`;
  return `${Math.round((bytes / 1000000) * 10) / 10} MB`;
}

type RecentFileKind =
  | 'spreadsheet'
  | 'document'
  | 'pdf'
  | 'image'
  | 'presentation'
  | 'archive'
  | 'package'
  | 'code'
  | 'audio'
  | 'video'
  | 'generic';

const extensionsByKind: Record<Exclude<RecentFileKind, 'generic'>, string[]> = {
  spreadsheet: ['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods'],
  document: ['doc', 'docx', 'docm', 'odt', 'rtf', 'txt', 'md'],
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic'],
  presentation: ['ppt', 'pptx', 'pptm', 'odp'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2'],
  package: ['vsix', 'msi', 'exe', 'appx', 'nupkg'],
  code: [
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'html',
    'css',
    'less',
    'scss',
    'py',
    'cs',
    'sql',
    'xml',
    'yaml',
    'yml',
    'sln',
    'csproj',
  ],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv'],
};

function kindForFile(name: string): RecentFileKind {
  const extension = (name.split('.').pop() || '').toLowerCase();
  for (const kind of Object.keys(extensionsByKind) as Array<keyof typeof extensionsByKind>) {
    if (extensionsByKind[kind].includes(extension)) return kind;
  }
  return 'generic';
}

const RecentFileTypeIcon = ({ name }: { name: string }) => {
  const kind = kindForFile(name);
  const symbols: Record<RecentFileKind, JSX.Element> = {
    spreadsheet: <path d="M8 8h8v8H8zm0 4h8M12 8v8" />,
    document: <path d="M8 9h8M8 12h8M8 15h6" />,
    pdf: <path d="M8 9h5a2 2 0 0 1 0 4H8v3m0-3h4" />,
    image: <path d="m7 16 3-4 2 2 2-3 3 5M9 9h.01" />,
    presentation: <path d="M7 8h10v7H7zm5 7v3m-3 0h6" />,
    archive: <path d="M8 9h8v8H8zm2-3h4v3h-4m2 2v3" />,
    package: <path d="m7 9 5-3 5 3-5 3zm0 0v6l5 3 5-3V9m-5 3v6" />,
    code: <path d="m10 9-3 3 3 3m4-6 3 3-3 3" />,
    audio: (
      <path d="M10 16V8l6-1v8m-6 1a2 2 0 1 1-2-2 2 2 0 0 1 2 2Zm6-1a2 2 0 1 1-2-2 2 2 0 0 1 2 2Z" />
    ),
    video: <path d="M7 8h8v8H7zm8 3 3-2v6l-3-2" />,
    generic: <path d="M8 9h8M8 12h8M8 15h5" />,
  };

  return (
    <span className={`recent-file-type-icon type-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path className="file-page" d="M6 3h8l4 4v14H6zM14 3v5h4" />
        <g className="file-symbol">{symbols[kind]}</g>
      </svg>
    </span>
  );
};

export default class RecentFilesPopover extends React.Component<
  RecentFilesPopoverProps,
  RecentFilesPopoverState
> {
  static displayName = 'RecentFilesPopover';
  unsubscribe?: () => void;

  state: RecentFilesPopoverState = {
    files: RecentFiles.getCached(),
    loading: true,
    error: '',
  };

  componentDidMount() {
    this.unsubscribe = RecentFiles.listen(() => {
      this.setState({ files: RecentFiles.getCached(), loading: false });
    });
    this._load(false);
  }

  componentWillUnmount() {
    if (this.unsubscribe) this.unsubscribe();
  }

  _load = async (force: boolean) => {
    this.setState({ loading: true, error: '' });
    try {
      const files = await RecentFiles.getRecentFiles({ force, limit: 40 });
      this.setState({ files, loading: false });
    } catch {
      this.setState({
        loading: false,
        error: localized('Recent files could not be loaded.'),
      });
    }
  };

  _onSelect = (file: RecentLocalFile) => {
    Actions.addAttachment({
      headerMessageId: this.props.headerMessageId,
      filePath: file.path,
    });
    Actions.closePopover();
  };

  _onBrowse = () => {
    Actions.closePopover();
    this.props.onBrowse();
  };

  _content = (file: RecentLocalFile) => (
    <span className="recent-file-row" title={file.path}>
      <RecentFileTypeIcon name={file.name} />
      <span className="recent-file-content">
        <span className="recent-file-name">{file.name}</span>
        <span className="recent-file-details">
          {displaySize(file.size)} - {file.directory}
        </span>
      </span>
    </span>
  );

  render() {
    let status = null;
    if (this.state.loading) {
      status = <div className="recent-files-status">{localized('Finding recent files...')}</div>;
    } else if (this.state.error) {
      status = <div className="recent-files-status is-error">{this.state.error}</div>;
    } else if (!this.state.files.length) {
      status = <div className="recent-files-status">{localized('No recent files found.')}</div>;
    }

    const footer = [
      <div className="item" key="browse" onMouseDown={this._onBrowse}>
        {localized('Browse...')}
      </div>,
      <div className="item" key="refresh" onMouseDown={() => this._load(true)}>
        {localized('Refresh recent files')}
      </div>,
    ];

    return (
      <Menu
        className="recent-files-picker"
        headerComponents={status ? [status] : null}
        footerComponents={footer}
        items={this.state.files}
        itemKey={(file) => file.path}
        itemContent={this._content}
        onSelect={this._onSelect}
        defaultSelectedIndex={this.state.files.length ? 0 : -1}
      />
    );
  }
}
