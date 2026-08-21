/**
 * The app version is read from the root package.json on disk. It used to come
 * from npm_package_version, which is only set when the process is started
 * through `bun run`/`npm run` — `bun src/server/index.ts` reported "unknown"
 * from /health — and the CLI hard-coded a version string that went stale.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readAppVersion } from '../../../src/shared/appVersion';

describe('readAppVersion', () => {
    it('returns the version declared in the root package.json', () => {
        const packageJson = JSON.parse(
            readFileSync(resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')
        ) as { version: string };

        expect(readAppVersion()).toBe(packageJson.version);
        expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });
});
