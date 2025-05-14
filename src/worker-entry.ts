import { startWorker } from './worker';
import dotenv from 'dotenv';

dotenv.config();

console.log('Starting worker process...');

startWorker().catch(error => {
  console.error('Fatal worker error:', error);
  process.exit(1);
}); 