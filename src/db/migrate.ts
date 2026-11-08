import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from './env';

async function main() {
  config();
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
  console.log('Database is up to date.');
}
main().catch((e) => { console.error(e); process.exit(1); });
