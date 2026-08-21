import fs from 'fs';
import path from 'path';

describe('channel MCP process-management route policy', () => {
    it('requires an administrator before channel ownership on every process-management route', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/index.ts'),
            'utf8'
        );

        expect(routeSource).toMatch(
            /router\.post\(\s*'\/channels\/:channelId\/mcp-servers',\s*requireAdmin,/
        );
        expect(routeSource).toMatch(
            /router\.get\(\s*'\/channels\/:channelId\/mcp-servers',\s*requireAdmin,\s*requireChannelOwner,/
        );
        expect(routeSource).toMatch(
            /router\.delete\(\s*'\/channels\/:channelId\/mcp-servers\/:serverId',\s*requireAdmin,\s*requireChannelOwner,/
        );
    });
});
