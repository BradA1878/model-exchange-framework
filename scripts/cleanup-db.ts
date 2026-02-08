/**
 * Database Cleanup Script
 *
 * Backs up and cleans test data from the MXF database.
 * Preserves the users collection.
 *
 * Usage:
 *   bun run cleanup:db           # Backup and clean
 *   bun run cleanup:db --no-backup  # Clean without backup
 */

import mongoose from 'mongoose';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf';
const BACKUP_DIR = path.join(process.cwd(), 'backups');

// Collections to clean (users is intentionally excluded)
const COLLECTIONS_TO_CLEAN = [
    'channels',
    'agents',
    'tasks',
    'toolcallaudit',
    'memoryentries',
    'mcptoolexecutions',
    'auditlogs',
    'channelkeys',
    'mcptools',
    'plans',
    'relationships',
    'agentmemories',
    'memorystrata'
];

/**
 * Create a backup of the database using mongodump
 */
async function backupDatabase(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `mxf-backup-${timestamp}`);

    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    console.log(`\n📦 Creating backup at: ${backupPath}`);

    try {
        // Extract database name from URI
        const dbName = MONGODB_URI.split('/').pop()?.split('?')[0] || 'mxf';

        // Run mongodump
        execSync(`mongodump --uri="${MONGODB_URI}" --out="${backupPath}"`, {
            stdio: 'inherit'
        });

        console.log(`✅ Backup created successfully: ${backupPath}`);
        return backupPath;
    } catch (error) {
        console.error('❌ Backup failed:', error);
        throw error;
    }
}

/**
 * Clean specified collections from the database
 */
async function cleanDatabase(): Promise<void> {
    console.log('\n🧹 Starting database cleanup...\n');

    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;

    if (!db) {
        throw new Error('Database connection not available');
    }

    // Get list of existing collections
    const existingCollections = await db.listCollections().toArray();
    const existingNames = existingCollections.map(c => c.name);

    let totalDeleted = 0;

    for (const collectionName of COLLECTIONS_TO_CLEAN) {
        if (existingNames.includes(collectionName)) {
            const collection = db.collection(collectionName);
            const countBefore = await collection.countDocuments();

            if (countBefore > 0) {
                const result = await collection.deleteMany({});
                console.log(`  ✓ ${collectionName}: deleted ${result.deletedCount} documents`);
                totalDeleted += result.deletedCount;
            } else {
                console.log(`  - ${collectionName}: already empty`);
            }
        } else {
            console.log(`  - ${collectionName}: collection doesn't exist`);
        }
    }

    // Report on preserved collections
    const usersCount = await db.collection('users').countDocuments();
    console.log(`\n📋 Preserved collections:`);
    console.log(`  - users: ${usersCount} documents (kept)`);

    console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} total documents.`);

    await mongoose.disconnect();
}

/**
 * Main execution
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const skipBackup = args.includes('--no-backup');

    console.log('═'.repeat(60));
    console.log('  MXF Database Cleanup Script');
    console.log('═'.repeat(60));
    console.log(`\nDatabase: ${MONGODB_URI}`);
    console.log(`Backup: ${skipBackup ? 'SKIPPED' : 'Yes'}`);

    try {
        // Step 1: Backup (unless skipped)
        if (!skipBackup) {
            await backupDatabase();
        }

        // Step 2: Clean
        await cleanDatabase();

        console.log('\n🎉 Database cleanup completed successfully!\n');

    } catch (error) {
        console.error('\n❌ Cleanup failed:', error);
        process.exit(1);
    }
}

main();
