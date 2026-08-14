import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import React, { Component } from 'react';
import { Actions, Utils, AttachmentStore, File } from 'mailspring-exports';
import { AttachmentItem, ImageAttachmentItem } from 'mailspring-component-kit';

interface MessageAttachmentsProps {
  files: File[];
  downloads: { [fileId: string]: null };
  headerMessageId?: string;
  messageId?: string;
  filePreviewPaths: { [fileId: string]: string };
  canRemoveAttachments: boolean;
}

interface MessageAttachmentsState {
  errorById: { [fileId: string]: string };
  loadingById: { [fileId: string]: boolean };
  openById: { [fileId: string]: boolean };
  resolvedPathById: { [fileId: string]: string };
  rotationById: { [fileId: string]: number };
}

const PDF_CONTENT_TYPE = 'application/pdf';
let pdfJsModulePromise: Promise<any> | null = null;

function loadPdfJsModule(moduleURL: string) {
  const existingPdfJs = (window as any).pdfjsLib;
  if (existingPdfJs) return Promise.resolve(existingPdfJs);
  if (pdfJsModulePromise) return pdfJsModulePromise;

  pdfJsModulePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = moduleURL;
    script.onload = () => {
      const pdfjs = (window as any).pdfjsLib;
      if (pdfjs) {
        resolve(pdfjs);
      } else {
        reject(new Error('The built-in PDF renderer loaded without exposing its API.'));
      }
    };
    script.onerror = () => reject(new Error('The built-in PDF renderer could not be loaded.'));
    document.head.appendChild(script);
  }).catch((error) => {
    pdfJsModulePromise = null;
    throw error;
  });

  return pdfJsModulePromise;
}

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

function extensionForFile(file: File) {
  return (file.displayExtension() || '').toLowerCase().replace(/^\./, '');
}

function isPdfFile(file: File) {
  return (
    extensionForFile(file) === 'pdf' || (file.contentType || '').toLowerCase() === PDF_CONTENT_TYPE
  );
}

function isImageFile(file: File) {
  return (
    (file.contentType || '').toLowerCase().startsWith('image/') ||
    IMAGE_EXTENSIONS.has(extensionForFile(file)) ||
    Utils.shouldDisplayAsImage(file)
  );
}

function canInlinePreview(file: File) {
  return isPdfFile(file) || isImageFile(file);
}

interface PdfCanvasPreviewProps {
  filePath: string;
  onError: (error: Error) => void;
  onReady: () => void;
  rotation?: number;
}

class PdfCanvasPreview extends Component<PdfCanvasPreviewProps> {
  _container: HTMLDivElement;
  _generation = 0;
  _loadingTask: any;
  _renderTasks: any[] = [];

  componentDidMount() {
    this._renderPdf();
  }

  componentDidUpdate(prevProps: PdfCanvasPreviewProps) {
    if (prevProps.filePath !== this.props.filePath || prevProps.rotation !== this.props.rotation) {
      this._renderPdf();
    }
  }

  componentWillUnmount() {
    this._generation += 1;
    this._renderTasks.forEach((task) => task.cancel());
    if (this._loadingTask) this._loadingTask.destroy();
  }

  async _renderPdf() {
    const generation = ++this._generation;
    this._renderTasks.forEach((task) => task.cancel());
    this._renderTasks = [];
    if (this._loadingTask) await this._loadingTask.destroy();
    if (this._container) this._container.innerHTML = '';

    try {
      const { resourcePath } = AppEnv.getLoadSettings();
      const pdfRoot = path
        .join(resourcePath, 'src', 'quickpreview', 'pdfjs-4.3.136')
        .replace('app.asar', 'app.asar.unpacked');
      const pdfModuleURL = pathToFileURL(path.join(pdfRoot, 'build', 'pdf.mjs')).href;
      const pdfjs = await loadPdfJsModule(pdfModuleURL);
      if (generation !== this._generation) return;

      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        path.join(pdfRoot, 'build', 'pdf.worker.mjs')
      ).href;
      const data = new Uint8Array(await fs.promises.readFile(this.props.filePath));
      this._loadingTask = pdfjs.getDocument({
        data,
        cMapUrl: pathToFileURL(path.join(pdfRoot, 'web', 'cmaps') + path.sep).href,
        cMapPacked: true,
      });
      const pdf = await this._loadingTask.promise;
      if (generation !== this._generation) return;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        if (generation !== this._generation) return;
        const initialViewport = page.getViewport({ scale: 1, rotation: this.props.rotation || 0 });
        const availableWidth = Math.max(320, this._container.clientWidth - 28);
        const cssScale = Math.min(2, availableWidth / initialViewport.width);
        const outputScale = window.devicePixelRatio || 1;
        const viewport = page.getViewport({
          scale: cssScale * outputScale,
          rotation: this.props.rotation || 0,
        });
        const canvas = document.createElement('canvas');
        canvas.className = 'attachment-pdf-page';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / outputScale}px`;
        canvas.style.height = `${viewport.height / outputScale}px`;
        canvas.setAttribute('aria-label', `Page ${pageNumber} of ${pdf.numPages}`);
        this._container.appendChild(canvas);
        const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        this._renderTasks.push(renderTask);
        await renderTask.promise;
      }

      if (generation === this._generation) this.props.onReady();
    } catch (error) {
      if (generation === this._generation && error?.name !== 'RenderingCancelledException') {
        this.props.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  render() {
    return <div className="attachment-pdf-pages" ref={(element) => (this._container = element)} />;
  }
}

class MessageAttachments extends Component<MessageAttachmentsProps, MessageAttachmentsState> {
  static displayName = 'MessageAttachments';
  static containerRequired = false;
  static defaultProps = { downloads: {}, filePreviewPaths: {} };

  state: MessageAttachmentsState = {
    errorById: {},
    loadingById: {},
    openById: {},
    resolvedPathById: {},
    rotationById: {},
  };

  _openPreview = async (file: File) => {
    if (this.state.openById[file.id]) {
      this._closePreview(file.id);
      return;
    }

    this.setState((prevState) => ({
      errorById: { ...prevState.errorById, [file.id]: '' },
      loadingById: { ...prevState.loadingById, [file.id]: true },
      openById: { ...prevState.openById, [file.id]: true },
    }));

    try {
      const filePath = await AttachmentStore.resolveFilePathForPreview(file);
      this.setState((prevState) => ({
        resolvedPathById: { ...prevState.resolvedPathById, [file.id]: filePath },
      }));
    } catch (error) {
      this._setPreviewError(file.id, error instanceof Error ? error : new Error(String(error)));
    }
  };

  _closePreview = (fileId: string) => {
    this.setState((prevState) => ({
      errorById: { ...prevState.errorById, [fileId]: '' },
      loadingById: { ...prevState.loadingById, [fileId]: false },
      openById: { ...prevState.openById, [fileId]: false },
    }));
  };

  _setPreviewReady = (fileId: string) => {
    this.setState((prevState) => ({
      loadingById: { ...prevState.loadingById, [fileId]: false },
    }));
  };

  _setPreviewError = (fileId: string, error: Error) => {
    this.setState((prevState) => ({
      errorById: {
        ...prevState.errorById,
        [fileId]: error.message || 'This attachment could not be previewed.',
      },
      loadingById: { ...prevState.loadingById, [fileId]: false },
    }));
  };

  _openLargePreview = (fileId: string) => {
    const filePath = this.state.resolvedPathById[fileId];
    if (filePath) Actions.quickPreviewFile(filePath);
  };

  _rotatePreview = (fileId: string, amount: number) => {
    this.setState((prevState) => ({
      rotationById: {
        ...prevState.rotationById,
        [fileId]: ((prevState.rotationById[fileId] || 0) + amount + 360) % 360,
      },
    }));
  };

  renderAttachment(AttachmentRenderer: React.ComponentType<any>, file: File) {
    const { canRemoveAttachments, downloads, filePreviewPaths } = this.props;
    const displayFilePreview = AppEnv.config.get('core.attachments.displayFilePreview');

    return (
      <AttachmentRenderer
        key={file.id}
        focusable
        filePath={AttachmentStore.pathForFile(file)}
        download={downloads[file.id]}
        contentType={file.contentType}
        displayName={file.displayName()}
        displaySize={file.displayFileSize()}
        fileIconName={`file-${file.displayExtension()}.png`}
        filePreviewPath={displayFilePreview ? filePreviewPaths[file.id] : null}
        onOpenAttachment={() => Actions.fetchAndOpenFile(file)}
        onSaveAttachment={() => Actions.fetchAndSaveFile(file)}
        onRemoveAttachment={
          canRemoveAttachments
            ? () =>
                Actions.removeAttachment({
                  headerMessageId: this.props.headerMessageId || this.props.messageId,
                  file,
                })
            : null
        }
        onClick={canInlinePreview(file) ? () => this._openPreview(file) : null}
      />
    );
  }

  renderInlinePreview(file: File) {
    if (!canInlinePreview(file) || !this.state.openById[file.id]) return null;

    const filePath = this.state.resolvedPathById[file.id];
    const loading = !!this.state.loadingById[file.id];
    const error = this.state.errorById[file.id];
    const rotation = this.state.rotationById[file.id] || 0;

    return (
      <div key={`attachment-preview-${file.id}`} className="inline-attachment-preview is-open">
        <div className="inline-pdf-preview-header">
          <span className="inline-pdf-preview-title" title={file.displayName()}>
            {file.displayName()}
          </span>
          <span className="inline-attachment-preview-hint">Double-click for larger view</span>
          <div className="inline-attachment-preview-actions">
            <button
              aria-label="Rotate counterclockwise"
              className="btn btn-small"
              onClick={() => this._rotatePreview(file.id, -90)}
              title="Rotate counterclockwise"
              type="button"
            >
              ↶
            </button>
            <button
              aria-label="Rotate clockwise"
              className="btn btn-small"
              onClick={() => this._rotatePreview(file.id, 90)}
              title="Rotate clockwise"
              type="button"
            >
              ↷
            </button>
            <button
              className="btn btn-small"
              onClick={() => this._closePreview(file.id)}
              type="button"
            >
              Close Preview
            </button>
          </div>
        </div>
        <div
          className={`inline-attachment-preview-body ${isImageFile(file) ? 'is-image' : 'is-pdf'}`}
          onDoubleClick={() => this._openLargePreview(file.id)}
        >
          {filePath && isPdfFile(file) ? (
            <PdfCanvasPreview
              filePath={filePath}
              rotation={rotation}
              onReady={() => this._setPreviewReady(file.id)}
              onError={(previewError) => this._setPreviewError(file.id, previewError)}
            />
          ) : null}
          {filePath && isImageFile(file) ? (
            <img
              className="inline-attachment-preview-image"
              src={pathToFileURL(filePath).href}
              alt={file.displayName()}
              style={{ transform: `rotate(${rotation}deg)` }}
              onLoad={() => this._setPreviewReady(file.id)}
              onError={() =>
                this._setPreviewError(
                  file.id,
                  new Error('This image format is not supported by the built-in viewer.')
                )
              }
            />
          ) : null}
          {loading ? <div className="inline-pdf-preview-loading">Loading preview…</div> : null}
          {error ? <div className="inline-attachment-preview-error">{error}</div> : null}
        </div>
      </div>
    );
  }

  render() {
    const { files } = this.props;
    const nonImageFiles = files.filter((file) => !isImageFile(file));
    const imageFiles = files.filter((file) => isImageFile(file));

    return (
      <div className="message-attachments-inline-pdf">
        {nonImageFiles.map((file) =>
          this.state.openById[file.id] ? null : this.renderAttachment(AttachmentItem, file)
        )}
        {imageFiles.map((file) =>
          this.state.openById[file.id] ? null : this.renderAttachment(ImageAttachmentItem, file)
        )}
        {files.map((file) => this.renderInlinePreview(file))}
      </div>
    );
  }
}

export default MessageAttachments;
