import fs from 'fs';
import path from 'path';

describe('hybrid MCP route scope policy', () => {
    it('keeps global topology reads admin-only and exposes explicit channel-scoped variants', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/hybridMcp.ts'),
            'utf8'
        );

        expect(routeSource).toContain(
            "router.get('/tools', requireAdmin, hybridMcpController.getAllTools);"
        );
        expect(routeSource).toContain(
            "router.get('/channels/:channelId/tools', requireChannelAccess, hybridMcpController.getAllTools);"
        );
        expect(routeSource).toContain(
            "router.get('/servers', requireAdmin, hybridMcpController.getExternalServers);"
        );
        expect(routeSource).toContain(
            "router.get('/channels/:channelId/servers', requireChannelAccess, hybridMcpController.getExternalServers);"
        );
        expect(routeSource).toContain(
            "router.get('/servers/:serverId/status', requireAdmin, hybridMcpController.getServerStatus);"
        );
        expect(routeSource).toContain('requireChannelAccess,');
        expect(routeSource).toContain('hybridMcpController.getServerStatus');
    });
});
