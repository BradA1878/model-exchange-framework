import fs from 'fs';
import path from 'path';

describe('channel discovery route topology', () => {
    it('registers the static search route before the dynamic channel-id route', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/index.ts'),
            'utf8'
        );
        const searchRoute = "router.get('/channels/search', channelController.searchChannels);";
        const dynamicRoute = "router.get('/channels/:channelId', requireChannelOwner, channelController.getChannelById);";

        expect(routeSource).toContain(searchRoute);
        expect(routeSource).toContain(dynamicRoute);
        expect(routeSource.indexOf(searchRoute)).toBeLessThan(routeSource.indexOf(dynamicRoute));
    });

    it('puts user and ownership policy in front of channel management controllers', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/index.ts'),
            'utf8'
        );

        expect(routeSource).toContain(
            "router.get('/channels', requireUserPrincipal, channelController.getAllChannels);"
        );
        expect(routeSource).toContain(
            "router.post('/channels', requireUserPrincipal, channelController.registerChannel);"
        );
        expect(routeSource).toContain(
            "router.get('/channels/:channelId', requireChannelOwner, channelController.getChannelById);"
        );
        expect(routeSource).toContain(
            "router.post('/channels/workspace', requireUserPrincipal, channelController.createChannelWorkspace);"
        );
    });

    it('keeps unscoped cross-tenant operational routers administrator-only', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/index.ts'),
            'utf8'
        );

        const adminOnlyMounts = [
            "router.use('/bulk', requireAdmin, bulkRoutes);",
            "router.use('/dashboard', requireAdmin, dashboardRoutes);",
            "router.use('/analytics', requireAdmin, analyticsRoutes);",
            "router.use('/config', requireAdmin, configRoutes);",
            "router.use('/effectiveness', requireAdmin, taskEffectivenessRoutes);",
            "router.use('/kg', requireAdmin, knowledgeGraphRoutes);",
            "router.use('/dag', requireAdmin, dagRoutes);",
            "router.use('/memory-browser', requireAdmin, memoryBrowserRoutes);",
            "router.use('/orpar', requireAdmin, orparRoutes);"
        ];

        adminOnlyMounts.forEach(mount => expect(routeSource).toContain(mount));
    });
});
