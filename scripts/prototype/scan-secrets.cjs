const providerName =
  '(?:OPENAI|AZURE_OPENAI|ANTHROPIC|GEMINI|GOOGLE_AI|GOOGLE_GENERATIVE_AI|COHERE|MISTRAL|GROQ|DEEPSEEK|VOYAGE|OPENROUTER|HUGGINGFACE)_API_KEY|REPLICATE_API_TOKEN';
const applicationSecretName =
  '(?:NEXTAUTH_SECRET|CREDENTIAL_ENCRYPTION_SECRET|CRON_SECRET|DEMO_SHARED_PASSWORD)';

function assignedValues(content, namePattern) {
  const assignment = new RegExp(
    `(?:^|[\\s,{;])["']?(?:${namePattern})["']?\\s*[:=]\\s*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|(\\$\\{[^}\\r\\n]+\\}|[^\\s,;}\\r\\n]+))`,
    'gim'
  );
  return Array.from(content.matchAll(assignment), (match) => match[1] ?? match[2] ?? match[3]);
}

function isEnvironmentReference(value) {
  const candidate = value.trim();
  return (
    /^\$[A-Z_][A-Z0-9_]*$/i.test(candidate) ||
    /^\$\{[A-Z_][A-Z0-9_]*\}$/i.test(candidate) ||
    /^process\.env\.[A-Z_][A-Z0-9_]*$/i.test(candidate) ||
    /^process\.env\[["'][A-Z_][A-Z0-9_]*["']\]$/i.test(candidate)
  );
}

function isPlaceholderOrReference(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (isEnvironmentReference(value)) return true;
  return [
    'replace',
    'placeholder',
    'example',
    'for-tests',
    'for_test',
    'test-',
    'integration-only',
    'credential-present',
    'do-not-print',
  ].some((marker) => normalized.includes(marker));
}

function hasAssignedSecret(content, namePattern) {
  return assignedValues(content, namePattern).some((value) => !isPlaceholderOrReference(value));
}

function hasDatabaseCredential(content) {
  const urls = content.match(/postgres(?:ql)?:\/\/[^\s"']+/gi) ?? [];
  return urls.some((connectionString) => {
    try {
      const password = decodeURIComponent(new URL(connectionString).password);
      return Boolean(password) && !isPlaceholderOrReference(password) && !['password', 'secret'].includes(password.toLowerCase());
    } catch {
      return false;
    }
  });
}

function findSecretFindings(files) {
  const findings = [];

  for (const file of files) {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(file.content)) {
      findings.push({ path: file.path, reason: 'private key material' });
      continue;
    }
    if (hasAssignedSecret(file.content, providerName)) {
      findings.push({ path: file.path, reason: 'provider API credential' });
      continue;
    }
    if (hasDatabaseCredential(file.content)) {
      findings.push({ path: file.path, reason: 'database credential' });
      continue;
    }
    if (hasAssignedSecret(file.content, applicationSecretName)) {
      findings.push({ path: file.path, reason: 'application secret' });
    }
  }

  return findings;
}

function trackedFiles(run, read) {
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

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map((path) => {
      try {
        return { path, content: read(path, 'utf8') };
      } catch {
        return { path, content: '' };
      }
    });
}

function runCli(files, logger) {
  const findings = findSecretFindings(files);
  if (findings.length > 0) {
    logger.error('Potential secrets found:');
    for (const finding of findings) {
      logger.error(`- ${finding.path}: ${finding.reason}`);
    }
    return 1;
  }

  logger.log('Secret scan passed.');
  return 0;
}

module.exports = { findSecretFindings, runCli, trackedFiles };
