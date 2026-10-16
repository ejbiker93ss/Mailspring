import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { dismissAppContextMenu, showAppContextMenu } from '../../src/components/app-context-menu';
const EventedIFrame = require('../../src/components/evented-iframe').EventedIFrame;

describe('EventedIFrame', () =>
  describe('link clicking behavior', function () {
    beforeEach(function () {
      this.frame = ReactTestUtils.renderIntoDocument(<EventedIFrame src="about:blank" />);

      this.setAttributeSpy = jasmine.createSpy('setAttribute');
      this.preventDefaultSpy = jasmine.createSpy('preventDefault');
      this.openLinkSpy = jasmine.createSpy('openLink');

      this.oldOpenLink = AppEnv.windowEventHandler.openLink;
      AppEnv.windowEventHandler.openLink = this.openLinkSpy;

      this.fakeEvent = (href) => {
        return {
          stopPropagation() {},
          preventDefault: this.preventDefaultSpy,
          target: {
            getAttribute(attr) {
              return href;
            },
            setAttribute: this.setAttributeSpy,
          },
        };
      };
    });

    afterEach(function () {
      AppEnv.windowEventHandler.openLink = this.oldOpenLink;
    });

    it('works for acceptable link types', function () {
      const hrefs = [
        'http://mailspring.com',
        'https://www.mailspring.com',
        'mailto:evan@summermail.com',
        'tel:8585311718',
        'custom:www.summermail.com',
      ];
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        this.frame._onIFrameClick(this.fakeEvent(href));
        expect(this.setAttributeSpy).not.toHaveBeenCalled();
        expect(this.openLinkSpy).toHaveBeenCalled();
        const { target } = this.openLinkSpy.calls[i].args[0];
        const targetHref = this.openLinkSpy.calls[i].args[0].href;
        expect(target).not.toBeDefined();
        expect(targetHref).toBe(href);
      }
    });

    it('corrects relative uris', function () {
      const hrefs = ['summermail.com', 'www.summermail.com'];
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        this.frame._onIFrameClick(this.fakeEvent(href));
        expect(this.setAttributeSpy).toHaveBeenCalled();
        const modifiedHref = this.setAttributeSpy.calls[i].args[1];
        expect(modifiedHref).toBe(`http://${href}`);
      }
    });

    it('corrects protocol-relative uris', function () {
      const hrefs = ['//summermail.com', '//www.summermail.com'];
      for (let i = 0; i < hrefs.length; i++) {
        const href = hrefs[i];
        this.frame._onIFrameClick(this.fakeEvent(href));
        expect(this.setAttributeSpy).toHaveBeenCalled();
        const modifiedHref = this.setAttributeSpy.calls[i].args[1];
        expect(modifiedHref).toBe(`https:${href}`);
      }
    });

    it('disallows malicious uris', function () {
      const hrefs = ['file://usr/bin/bad'];
      for (const href of hrefs) {
        this.frame._onIFrameClick(this.fakeEvent(href));
        expect(this.preventDefaultSpy).toHaveBeenCalled();
        expect(this.openLinkSpy).not.toHaveBeenCalled();
      }
    });
  }));

describe('EventedIFrame selection menu dismissal', function () {
  beforeEach(function () {
    this.container = document.createElement('div');
    document.body.appendChild(this.container);
    this.frame = ReactDOM.render(
      <EventedIFrame src="about:blank" onQuoteSelection={() => {}} />,
      this.container
    );
    this.dismissed = jasmine.createSpy('dismissed');
    this.frame._selectionMenuOpen = true;
    showAppContextMenu(
      [{ label: 'Quote', click: () => {} }],
      { x: 10, y: 10 },
      {
        onDismiss: () => {
          this.frame._selectionMenuOpen = false;
          this.dismissed();
        },
      }
    );
  });

  afterEach(function () {
    dismissAppContextMenu();
    ReactDOM.unmountComponentAtNode(this.container);
    this.container.remove();
  });

  it('dismisses on a left press in the message and still forwards the press', function () {
    const node = ReactDOM.findDOMNode(this.frame) as HTMLIFrameElement;
    const pressed = jasmine.createSpy('pressed');
    node.addEventListener('mousedown', pressed);
    this.frame._onIFrameMouseEvent(new MouseEvent('mousedown', { button: 0 }));

    expect(this.dismissed.calls.length).toBe(1);
    expect(this.frame._selectionMenuOpen).toBe(false);
    expect(document.querySelector('.app-context-menu-root')).toBe(null);
    expect(pressed.calls.length).toBe(1);
  });

  it('keeps the menu available while the pointer moves toward an action', function () {
    this.frame._onIFrameMouseEvent(new MouseEvent('mousemove'));

    expect(this.dismissed).not.toHaveBeenCalled();
    expect(this.frame._selectionMenuOpen).toBe(true);
    expect(document.querySelectorAll('.app-context-menu-root').length).toBe(1);
  });

  it('clears the old selection so the release does not reopen the menu', function () {
    const node = ReactDOM.findDOMNode(this.frame) as HTMLIFrameElement;
    node.contentDocument.body.textContent = 'Selected email text';
    const range = node.contentDocument.createRange();
    range.selectNodeContents(node.contentDocument.body);
    const selection = node.contentWindow.getSelection();
    selection.addRange(range);

    this.frame._onIFrameMouseEvent(new MouseEvent('mousedown', { button: 0 }));
    this.frame._onIFrameMouseEvent(new MouseEvent('mouseup', { button: 0 }));

    expect(selection.toString()).toBe('');
    expect(document.querySelector('.app-context-menu-root')).toBe(null);
  });

  it('dismisses an outside press even when its handler stops propagation', function () {
    this.container.addEventListener('mousedown', (event) => event.stopPropagation());
    this.container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(this.dismissed.calls.length).toBe(1);
    expect(document.querySelector('.app-context-menu-root')).toBe(null);
  });

  it('orders the selection actions alphabetically', function () {
    const labels = this.frame
      ._selectionMenuItems('Email text', '<p>Email text</p>')
      .map((item) => item.label);

    expect(labels).toEqual(['Copy', 'Copy as Plain Text', 'Copy Quote', 'Quote']);
  });
});
