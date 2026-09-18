import { loadAppConfig } from '@harness/config';
import { openHarnessDatabase } from '@harness/persistence';

const config = loadAppConfig();
const store = openHarnessDatabase(config.databasePath);

console.log(`Applied migrations: ${store.migrationCount}`);
console.log(`Database: ${config.databasePath}`);
store.close();
