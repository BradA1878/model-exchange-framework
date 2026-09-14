import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { resolveImportMetaUrl } from '../../setup/typescript-transform.cjs';

describe('ESM source URLs in the CommonJS test runtime', () => {
    it('uses the source module location and leaves comments and literal text unchanged', () => {
        const filename = resolve('/tmp/with spaces/module.ts');
        const source = '// import.meta.url\nconst text = "import.meta.url";\nconst url = import.meta.url;';
        expect(resolveImportMetaUrl(source, filename)).toBe(
            '// import.meta.url\nconst text = "import.meta.url";\nconst url = ' + JSON.stringify(pathToFileURL(filename).href) + ';'
        );
    });

    it('does not rewrite unrelated TypeScript or other import.meta properties', () => {
        const source = 'const broken: number = "still a type error"; const other = import.meta.resolve;';
        expect(resolveImportMetaUrl(source, '/tmp/module.ts')).toBe(source);
    });
});
