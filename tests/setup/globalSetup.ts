/**
 * Jest Global Setup
 *
 * Checks that the MXF server is running before integration tests.
 * The server must be started manually with: npm run dev
 */

import waitOn from 'wait-on';

export default async function globalSetup(): Promise<void> {
    const serverUrl = process.env.TEST_SERVER_URL || 'http://localhost:3001';
    const healthEndpoint = `${serverUrl}/health`;

    console.log('\n');
    console.log('='.repeat(60));
    console.log('MXF Integration Test Setup');
    console.log('='.repeat(60));
    console.log(`Server URL: ${serverUrl}`);
    console.log('');

    console.log('[Setup] Checking for running server...');
    try {
        await waitOn({
            resources: [healthEndpoint],
            timeout: 10000,
            interval: 1000,
            validateStatus: (status: number) => status === 200
        });
        console.log('[Setup] Server is ready');
    } catch (error) {
        console.error('');
        console.error('='.repeat(60));
        console.error('ERROR: MXF Server is not running!');
        console.error('='.repeat(60));
        console.error('');
        console.error('Please start the server before running integration tests:');
        console.error('');
        console.error('  npm run dev');
        console.error('');
        console.error('Then run tests in another terminal:');
        console.error('');
        console.error('  npm run test:integration');
        console.error('');
        console.error('='.repeat(60));
        throw new Error(`Server not available at ${healthEndpoint}. Start server with 'npm run dev' first.`);
    }

    console.log('='.repeat(60));
    console.log('Setup complete - running tests');
    console.log('='.repeat(60));
    console.log('');
}
