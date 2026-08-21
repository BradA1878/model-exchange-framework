import fs from 'fs';
import path from 'path';

describe('MCP REST mutation policy', () => {
    it('keeps tool registry registration and updates administrator-only', () => {
        const routeSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/routes/mcp.ts'),
            'utf8'
        );

        expect(routeSource).toContain(
            "router.post('/tools', requireAdmin, validateToolInput, mcpController.registerTool);"
        );
        expect(routeSource).toContain(
            "router.put('/tools/:name', requireAdmin, validateToolInput, mcpController.updateTool);"
        );
        expect(routeSource).not.toContain('requireProvider');
    });

    it('keeps a controller-level administrator check and fails closed without a provider protocol', () => {
        const controllerSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/server/api/controllers/mcpController.ts'),
            'utf8'
        );

        const registerStart = controllerSource.indexOf('export const registerTool');
        const updateStart = controllerSource.indexOf('export const updateTool');
        const deleteStart = controllerSource.indexOf('export const deleteTool');
        const registerBody = controllerSource.slice(registerStart, updateStart);
        const updateBody = controllerSource.slice(updateStart, deleteStart);

        expect(registerBody).toContain('requireRegistryAdministrator(req, res)');
        expect(registerBody).toContain("code: 'MCP_PROVIDER_INVOCATION_UNAVAILABLE'");
        expect(registerBody).toContain('res.status(501)');
        expect(registerBody).not.toContain('.registerTool(');
        expect(registerBody).not.toContain('Tool registered via API');
        expect(updateBody).toContain('requireRegistryAdministrator(req, res)');
        expect(updateBody.indexOf('requireRegistryAdministrator(req, res)'))
            .toBeLessThan(updateBody.indexOf('McpToolRegistry.getInstance()'));
    });
});
