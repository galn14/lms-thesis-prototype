import { migrateAuxiliaryDatabase } from '../../lib/prototype/auxiliary-migrator';

async function main(): Promise<void> {
  const result = await migrateAuxiliaryDatabase();
  console.log(
    `Auxiliary migrations complete: ${result.applied.length} applied, ${result.skipped.length} skipped.`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown auxiliary migration error';
  console.error(message);
  process.exitCode = 1;
});
