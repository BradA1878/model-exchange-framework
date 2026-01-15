/**
 * Jest Global Teardown
 *
 * Cleanup after integration tests complete.
 * Server is managed externally, so no cleanup needed.
 */

export default async function globalTeardown(): Promise<void> {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('MXF Integration Test Teardown');
    console.log('='.repeat(60));
    console.log('[Teardown] Tests complete');
    console.log('[Teardown] Server remains running for further development');
    console.log('='.repeat(60));
    console.log('');
}
