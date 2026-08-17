const REQUIRED_NEON_NAMES = Object.freeze([
  'NEON_API_KEY',
  'NEON_PROJECT_ID',
  'NEON_PRODUCTION_BRANCH_ID',
]);

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required to create a Neon pre-release backup`);
  return value;
}

function timestampName(now) {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, '');
}

async function createNeonBackupBranch({
  environment = process.env,
  request = global.fetch,
  now = () => new Date(),
} = {}) {
  const apiKey = required(environment, 'NEON_API_KEY');
  const projectId = required(environment, 'NEON_PROJECT_ID');
  const parentBranchId = required(environment, 'NEON_PRODUCTION_BRANCH_ID');
  const response = await request(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch: {
          parent_id: parentBranchId,
          name: `prototype-pre-release-${timestampName(now())}`,
        },
        endpoints: [{ type: 'read_write' }],
      }),
    }
  );
  if (!response.ok) throw new Error('Neon pre-release backup creation failed');
  const body = await response.json();
  const endpoint = body.endpoints?.find((candidate) => candidate.type === 'read_write');
  if (!body.branch?.id || !endpoint?.id) {
    throw new Error('Neon backup did not return read-write endpoint metadata');
  }
  return {
    branchId: body.branch.id,
    parentBranchId: body.branch.parent_id ?? parentBranchId,
    endpointId: endpoint.id,
    endpointType: endpoint.type,
  };
}

async function readNeonBackupBranch({ environment = process.env, branchId, request = global.fetch } = {}) {
  const apiKey = required(environment, 'NEON_API_KEY');
  const projectId = required(environment, 'NEON_PROJECT_ID');
  if (!branchId) throw new Error('Neon backup branch ID is required');
  const response = await request(
    `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!response.ok) throw new Error('Neon pre-release backup is unavailable');
  const body = await response.json();
  if (body.branch?.id !== branchId) throw new Error('Neon pre-release backup metadata has drifted');
  return { branchId: body.branch.id, parentBranchId: body.branch.parent_id };
}

module.exports = { REQUIRED_NEON_NAMES, createNeonBackupBranch, readNeonBackupBranch, timestampName };
