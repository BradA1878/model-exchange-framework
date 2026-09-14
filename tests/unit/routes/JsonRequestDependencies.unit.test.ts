import express from 'express';
import supertest from 'supertest';

/** Exercise the installed HTTP client; a global mime 1.x override broke JSON sends. */
describe('installed JSON HTTP request dependencies', () => {
    it.each(['post', 'patch'] as const)('sends a real JSON %s request', async method => {
        const app = express();
        app.use(express.json());
        app[method]('/record', (req, res) => { res.json({ received: req.body }); });
        const body = { content: { text: 'Hello', count: 2 } };
        const response = await supertest(app)[method]('/record').send(body);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: body });
    });
});
