import { resetPrototypeDatabase } from '../../lib/prototype/reset';

async function main(): Promise<void> {
  const result = await resetPrototypeDatabase();
  console.log(`Prototype reset ${result.resetVersion} completed at ${result.completedAt}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown prototype reset error';
  console.error(message);
  process.exitCode = 1;
});
