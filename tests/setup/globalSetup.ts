/**
 * Jest Global Setup
 *
 * Checks that the MXF server is running before integration tests
 * and ensures the demo user exists for authentication.
 * The server must be started manually with: npm run dev
 */

import waitOn from 'wait-on';
import axios from 'axios';

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

    // Create demo user for test authentication
    // Tests use demo-user/demo-password-1234 credentials
    console.log('[Setup] Ensuring demo user exists...');
    try {
        await axios.post(`${serverUrl}/api/users/register`, {
            username: 'demo-user',
            email: 'demo@test.local',
            password: 'demo-password-1234',
            role: 'consumer'
        });
        console.log('[Setup] Created demo-user for testing');
    } catch (error: any) {
        if (error.response?.status === 409) {
            console.log('[Setup] Demo user already exists');
        } else if (error.response?.status === 400 && error.response?.data?.message?.includes('already')) {
            console.log('[Setup] Demo user already exists');
        } else {
            // Log warning but don't fail - user might exist from previous run
            console.warn(`[Setup] Demo user setup warning: ${error.response?.data?.message || error.message}`);
        }
    }

    console.log('='.repeat(60));
    console.log('Setup complete - running tests');
    console.log('='.repeat(60));
    console.log('');
}
