import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jsonAppendTool, jsonReadTool } from '@mxf-dev/core/protocols/mcp/tools/JsonTools';

const context = { agentId: 'json-agent', channelId: 'json-channel', requestId: 'json-request' };

describe('JSON tool property paths', () => {
    let workspace: string;
    let previousRoot: string | undefined;

    beforeEach(() => {
        previousRoot = process.env.MXF_WORKSPACE_ROOT;
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-json-paths-'));
        process.env.MXF_WORKSPACE_ROOT = workspace;
        fs.writeFileSync(path.join(workspace, 'data.json'), '{}');
    });

    afterEach(() => {
        Reflect.deleteProperty(Object.prototype, 'mxfJsonReview');
        if (previousRoot === undefined) delete process.env.MXF_WORKSPACE_ROOT;
        else process.env.MXF_WORKSPACE_ROOT = previousRoot;
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    it.each(['__proto__.mxfJsonReview', 'constructor.prototype.mxfJsonReview'])(
        'rejects prototype traversal through %s without modifying objects or files',
        async arrayPath => {
            await expect(jsonAppendTool.handler({
                path: 'data.json', arrayPath, entry: { injected: true }
            }, context)).rejects.toThrow(/reserved property/);
            expect(Object.prototype).not.toHaveProperty('mxfJsonReview');
            expect(fs.readFileSync(path.join(workspace, 'data.json'), 'utf8')).toBe('{}');
        }
    );

    it.each(['__proto__', 'constructor', 'prototype'])('rejects reserved metadata field %s', async field => {
        await expect(jsonAppendTool.handler({
            path: 'data.json', arrayPath: 'entries', entry: { id: 1 },
            updateMetadata: { countField: field }
        }, context)).rejects.toThrow(/reserved property/);
        expect(fs.readFileSync(path.join(workspace, 'data.json'), 'utf8')).toBe('{}');
    });

    it('constructs a missing nested array without adding a literal dotted property', async () => {
        const entry = { id: 1 };
        await jsonAppendTool.handler({
            path: 'new.json', arrayPath: 'data.entries', entry, createIfMissing: true,
            updateMetadata: { countField: 'count' }
        }, context);
        const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'new.json'), 'utf8'));
        expect(saved).toEqual({ data: { entries: [entry] }, count: 1, lastUpdated: expect.any(String) });
        const result = await jsonReadTool.handler({ path: 'new.json', jsonPath: 'data.entries[0].id' }, context);
        expect(result.content).toBe(1);
    });

    it.each(['__proto__', 'constructor.prototype', 'toString'])('does not read inherited JSON path %s', async jsonPath => {
        await expect(jsonReadTool.handler({ path: 'data.json', jsonPath }, context)).rejects.toThrow();
    });

    it('does not replace a scalar parent while constructing a nested array', async () => {
        fs.writeFileSync(path.join(workspace, 'data.json'), '{"data":false}');
        await expect(jsonAppendTool.handler({
            path: 'data.json', arrayPath: 'data.entries', entry: { id: 1 }
        }, context)).rejects.toThrow(/object/);
        expect(fs.readFileSync(path.join(workspace, 'data.json'), 'utf8')).toBe('{"data":false}');
    });
});
