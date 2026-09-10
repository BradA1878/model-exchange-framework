/** Run the shipped viewer script; only Markdown rendering and browser I/O are stubbed. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const viewerHtml = readFileSync(resolve(__dirname, '../../..', 'docs/index.html'), 'utf8');
const viewerUrl = 'https://example.test/project/docs/index.html';
const repository = 'https://github.com/BradA1878/model-exchange-framework';
const pages: Record<string, string> = {
    'sdk/index.md': `
        <h1>SDK guide</h1><h2>Task Identity</h2><h2>Task Identity</h2>
        <h2>Task Identity-1</h2><h2>Task Identity</h2>
        <a id="sibling" href="./authentication.md">Authentication</a>
        <a id="anchored" href="authentication.md#tokens">Tokens</a>
        <a id="fragment" href="#task-identity-1">Repeated heading</a>
        <a id="parent" href="../index.md#overview">Overview</a>
        <a id="package" href="../../packages/sdk/README.md#upgrading-to-40">Upgrade</a>
        <a id="example" href="../../examples/recurring-review">Example</a>
        <a id="external" href="https://example.test/reference.md">External</a>
    `,
    'sdk/authentication.md': '<h1>Authentication</h1><h2>Tokens</h2>',
    'index.md': '<h1>Overview</h1>'
};

interface ViewerApi {
    loadDoc(file: string): Promise<void>;
    resolveDocumentationLink(file: string, href: string): { href: string; file?: string } | null;
}

describe('documentation viewer navigation', () => {
    let dom: JSDOM;
    let api: ViewerApi;
    let fetchDocument: jest.Mock;
    let scheduled: Array<() => void>;
    let scrolledIds: string[];

    beforeEach(() => {
        // outside-only executes no CDN scripts and loads no external resources.
        dom = new JSDOM(viewerHtml, { url: viewerUrl, runScripts: 'outside-only' });
        scheduled = [];
        scrolledIds = [];
        fetchDocument = jest.fn(async (file: string) => ({
            ok: Object.prototype.hasOwnProperty.call(pages, file),
            text: async (): Promise<string> => file
        }));
        Object.assign(dom.window, {
            fetch: fetchDocument,
            matchMedia: jest.fn(() => ({ matches: false })),
            marked: {
                setOptions: jest.fn(),
                // Fixtures represent parser output so the viewer owns all URL and DOM work.
                parse: jest.fn((file: string): string => pages[file])
            },
            hljs: {},
            mermaid: { initialize: jest.fn(), run: jest.fn() },
            setTimeout: (callback: () => void): number => scheduled.push(callback)
        });
        dom.window.HTMLElement.prototype.scrollIntoView = function (): void {
            scrolledIds.push(this.id);
        };
        const script = dom.window.document.querySelector('script:not([src])');
        if (!script?.textContent) throw new Error('Documentation viewer inline script is missing');
        runInContext(script.textContent, dom.getInternalVMContext(), { filename: 'docs/index.html' });
        api = dom.window as unknown as ViewerApi;
    });

    afterEach(() => { dom.window.close(); });

    const anchor = (id: string): HTMLAnchorElement => {
        const link = dom.window.document.getElementById(id);
        if (!(link instanceof dom.window.HTMLAnchorElement)) throw new Error(`Missing fixture link ${id}`);
        return link;
    };

    const click = async (id: string): Promise<void> => {
        const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        const link = anchor(id);
        expect(link.onclick).not.toBeNull();
        link.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        // The real click handler starts loadDoc without returning its promise.
        await new Promise<void>(done => { setImmediate(done); });
        scheduled.splice(0).forEach(callback => { callback(); });
    };

    it.each([
        ['sdk/index.md', 'authentication.md', 'sdk/authentication.md'],
        ['sdk/index.md', './authentication.md', 'sdk/authentication.md'],
        ['sdk/index.md', 'authentication.md#tokens', 'sdk/authentication.md#tokens'],
        ['sdk/index.md', '../index.md#overview', 'index.md#overview'],
        ['sdk/guides/index.md', '../../api/./dag-tools.md#cycles', 'api/dag-tools.md#cycles'],
        ['sdk/index.md', '#task-identity', 'sdk/index.md#task-identity']
    ])('resolves %s -> %s inside the viewer', (file, href, destination) => {
        expect(api.resolveDocumentationLink(file, href)).toEqual({ href: `#${destination}`, file: destination });
    });

    it.each([
        ['index.md', '../packages/sdk/README.md#upgrading-to-40', `${repository}/blob/main/packages/sdk/README.md#upgrading-to-40`],
        ['sdk/session-memory.md', '../../examples/recurring-review', `${repository}/tree/main/examples/recurring-review`]
    ])('routes repository content outside %s to GitHub', (file, href, destination) => {
        expect(api.resolveDocumentationLink(file, href)).toEqual({ href: destination });
    });

    it.each(['https://example.test/reference.md', 'http://example.test/a', 'mailto:author@example.test',
        'tel:+123456789', '//example.test/reference.md', '/docs/index.md'])('leaves absolute destination %s alone', href => {
        expect(api.resolveDocumentationLink('sdk/index.md', href)).toBeNull();
    });

    it('loads a nested sibling using the current document directory', async () => {
        await api.loadDoc('sdk/index.md');
        expect(anchor('sibling').href).toBe(`${viewerUrl}#sdk/authentication.md`);
        await click('sibling');
        expect(fetchDocument.mock.calls.map(call => call[0])).toEqual(['sdk/index.md', 'sdk/authentication.md']);
        expect(dom.window.document.querySelector('#content h1')?.textContent).toBe('Authentication');
    });

    it('loads Markdown anchor links and scrolls to the rendered heading', async () => {
        await api.loadDoc('sdk/index.md');
        await click('anchored');
        expect(fetchDocument).toHaveBeenLastCalledWith('sdk/authentication.md');
        expect(scrolledIds).toEqual(['tokens']);
    });

    it('normalizes parent links without fetching a site-root absolute path', async () => {
        await api.loadDoc('sdk/index.md');
        await click('parent');
        expect(fetchDocument).toHaveBeenLastCalledWith('index.md');
        expect(scrolledIds).toEqual(['overview']);
    });

    it('assigns stable collision-free heading IDs and handles same-document fragments', async () => {
        await api.loadDoc('sdk/index.md');
        const headingIds = (): string[] => Array.from(dom.window.document.querySelectorAll('#content h1, #content h2'), heading => heading.id);
        const expectedIds = ['sdk-guide', 'task-identity', 'task-identity-1', 'task-identity-1-1', 'task-identity-2'];
        expect(headingIds()).toEqual(expectedIds);
        await click('fragment');
        expect(fetchDocument).toHaveBeenLastCalledWith('sdk/index.md');
        expect(headingIds()).toEqual(expectedIds);
        expect(scrolledIds).toEqual(['task-identity-1']);
    });

    it('renders outside-docs and external links as ordinary links without local fetch handlers', async () => {
        await api.loadDoc('sdk/index.md');
        expect(anchor('package').href).toBe(`${repository}/blob/main/packages/sdk/README.md#upgrading-to-40`);
        expect(anchor('example').href).toBe(`${repository}/tree/main/examples/recurring-review`);
        expect(anchor('external').href).toBe('https://example.test/reference.md');
        for (const id of ['package', 'example', 'external']) expect(anchor(id).onclick).toBeNull();
        expect(fetchDocument).toHaveBeenCalledTimes(1);
    });

    const nativeClicks: Array<{ name: string; event?: MouseEventInit; target?: string; download?: boolean; prevented?: boolean }> = [
        { name: 'Ctrl-click', event: { ctrlKey: true } },
        { name: 'Meta-click', event: { metaKey: true } },
        { name: 'Shift-click', event: { shiftKey: true } },
        { name: 'Alt-click', event: { altKey: true } },
        { name: 'middle-click', event: { button: 1 } },
        { name: 'new-tab target', target: '_blank' },
        { name: 'named-window target', target: 'reference' },
        { name: 'download link', download: true },
        { name: 'previously prevented click', prevented: true }
    ];

    it.each(nativeClicks)('preserves native behavior for $name', async ({ event: init, target, download, prevented }) => {
        await api.loadDoc('sdk/index.md');
        const link = anchor('sibling');
        if (target) link.target = target;
        if (download) link.setAttribute('download', '');
        const event = new dom.window.MouseEvent('click', { cancelable: true, button: 0, ...init });
        if (prevented) event.preventDefault();
        // Invoke the installed handler without asking JSDOM to navigate a new window.
        if (!link.onclick) throw new Error('Internal link click handler is missing');
        link.onclick.call(link, event);
        expect(event.defaultPrevented).toBe(prevented ?? false);
        expect(fetchDocument).toHaveBeenCalledTimes(1);
    });
});
