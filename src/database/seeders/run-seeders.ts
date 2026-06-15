import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { AppDataSource } from '../data-source';
import { UserSeeder } from './user.seeder';
import { TaskCategorySeeder } from './task-category.seeder';
import { HealthTaskSeeder } from './health-task.seeder';

/**
 * Main seeder runner script.
 * Executes all seeders in the correct order.
 *
 * Usage:
 *   npx ts-node src/database/seeders/run-seeders.ts
 *   npm run seed
 */
async function runSeeders() {
  const logger = new Logger('Seeders');
  logger.log('🚀 Starting database seeding...\n');

  let dataSource;

  try {
    // Initialize DataSource
    dataSource = await AppDataSource.initialize();
    logger.log('✅ Database connection established\n');

    // Run seeders in order
    const seeders = [
      new UserSeeder(dataSource),
      new TaskCategorySeeder(dataSource),
      new HealthTaskSeeder(dataSource),
    ];

    for (const seeder of seeders) {
      await seeder.seed();
    }

    logger.log('\n🎉 Database seeding completed successfully!');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    logger.error('\n❌ Database seeding failed: ' + errorMessage);
    if (errorStack) {
      logger.error(errorStack);
    }
    process.exit(1);
  } finally {
    // Close database connection
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
      logger.log('\n🔌 Database connection closed');
    }
  }
}

// Run the seeders
runSeeders();
