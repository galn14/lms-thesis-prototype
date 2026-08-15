const forbiddenPatterns = [
  /^\.env(?:\..+)?$/,
  /(?:^|\/)node_modules\//,
  /(?:^|\/)\.next\//,
  /(?:^|\/)coverage(?:\/|$)/,
  /(?:^|\/)output(?:\/|$)/,
  /(?:^|\/)tmp(?:\/|$)/,
  /^public\/uploads\//,
  /(?:^|\/)\.agents\//,
  /(?:^|\/)\.claude\//,
  /(?:^|\/)\.codex\//,
  /(?:^|\/)\.gemini\//,
  /(?:^|\/)\.metaswarm\//,
  /(?:^|\/)\.superset\//,
  /(?:^|\/)temp_hash\.js$/,
  /(?:^|\/)temp_resources\.json$/,
  /(?:^|\/)package-test\.json$/,
  /(?:^|\/)[^/]*(?:skripsi|thesis|validation)[^/]*(?:\/|$)/i,
];

function isForbiddenArtifact(file) {
  if (file === '.env.example') return false;
  if (file.startsWith('tests/coverage/')) return false;
  return forbiddenPatterns.some((pattern) => pattern.test(file));
}

function findForbiddenArtifacts(files) {
  return files.filter(isForbiddenArtifact).sort();
}

function trackedFiles(run) {
  const result = run([
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unable to list tracked files (exit ${result.status ?? 'unknown'})`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

function runCli(files, logger) {
  const findings = findForbiddenArtifacts(files);
  if (findings.length > 0) {
    logger.error('Forbidden tracked artifacts:');
    for (const file of findings) logger.error(`- ${file}`);
    return 1;
  }

  logger.log('Artifact scan passed.');
  return 0;
}

module.exports = {
  findForbiddenArtifacts,
  isForbiddenArtifact,
  runCli,
  trackedFiles,
};
