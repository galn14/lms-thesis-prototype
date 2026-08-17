function responseCookies(response) {
  const values = response.headers?.getSetCookie?.() ?? [];
  return values.map((value) => value.split(';')[0]).filter(Boolean);
}

async function authenticate(baseUrl, username, password, request) {
  const csrfResponse = await request(`${baseUrl}/api/auth/csrf`, { redirect: 'manual' });
  if (!csrfResponse.ok) return null;
  const { csrfToken } = await csrfResponse.json();
  const csrfCookies = responseCookies(csrfResponse);
  const response = await request(`${baseUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: csrfCookies.join('; '),
    },
    body: new URLSearchParams({
      csrfToken,
      username,
      password,
      json: 'true',
      callbackUrl: `${baseUrl}/dashboard`,
    }),
  });
  const cookies = responseCookies(response);
  if (!response.ok || !cookies.some((value) => /^(?:__Secure-)?next-auth\.session-token=/.test(value))) {
    return null;
  }
  return [...csrfCookies, ...cookies].join('; ');
}

async function signIn(baseUrl, username, password, request = global.fetch) {
  return Boolean(await authenticate(baseUrl, username, password, request));
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function authenticatedHeaders(cookie, extra = {}) {
  return { ...extra, Cookie: cookie };
}

async function productionSmokeTest(deployment, environment, request = global.fetch) {
  const baseUrl = deployment.url.startsWith('http') ? deployment.url : `https://${deployment.url}`;
  try {
    const login = await request(`${baseUrl}/login`, { redirect: 'manual' });
    if (!login.ok) return { healthy: false, error: 'Production login page is unavailable' };

    const sessions = {};
    for (const [role, username] of [
      ['admin', 'demo_admin'],
      ['teacher', 'demo_teacher'],
      ['student', 'demo_student'],
    ]) {
      sessions[role] = await authenticate(baseUrl, username, environment.DEMO_SHARED_PASSWORD, request);
      if (!sessions[role]) {
        return { healthy: false, error: `Production login smoke test failed for ${username}` };
      }
    }

    const adminRead = await request(`${baseUrl}/api/admin/users`, {
      headers: authenticatedHeaders(sessions.admin),
      redirect: 'manual',
    });
    const adminBody = await readJson(adminRead);
    if (adminRead.status !== 200 || !adminBody?.success || !Array.isArray(adminBody.data?.users)) {
      return { healthy: false, error: 'Production admin read smoke test failed' };
    }

    for (const role of ['teacher', 'student']) {
      const response = await request(`${baseUrl}/api/scores`, {
        headers: authenticatedHeaders(sessions[role]),
        redirect: 'manual',
      });
      const body = await readJson(response);
      if (response.status !== 200 || !body?.success || !Array.isArray(body.data) || body.data.length === 0) {
        return { healthy: false, error: `Production ${role} read smoke test failed` };
      }
    }

    const grading = await request(`${baseUrl}/api/ai-grading/results/1?studentId=5`, {
      headers: authenticatedHeaders(sessions.teacher),
      redirect: 'manual',
    });
    const gradingBody = await readJson(grading);
    if (grading.status !== 200 || !gradingBody?.success || !gradingBody.data?.job || !gradingBody.data.results?.length) {
      return { healthy: false, error: 'Production prepared grading results smoke test failed' };
    }

    const plagiarism = await request(`${baseUrl}/api/plagiarism/results/1`, {
      headers: authenticatedHeaders(sessions.teacher),
      redirect: 'manual',
    });
    const plagiarismBody = await readJson(plagiarism);
    if (plagiarism.status !== 200 || !Array.isArray(plagiarismBody) || plagiarismBody.length === 0) {
      return { healthy: false, error: 'Production prepared plagiarism results smoke test failed' };
    }

    const observedRisks = new Set();
    for (const submissionId of [1, 3, 5, 7]) {
      const response = await request(`${baseUrl}/api/plagiarism/similarities/${submissionId}`, {
        headers: authenticatedHeaders(sessions.teacher),
        redirect: 'manual',
      });
      const body = await readJson(response);
      if (response.status !== 200 || !Array.isArray(body?.matches)) {
        return { healthy: false, error: 'Production plagiarism risk coverage smoke test failed' };
      }
      body.matches.forEach((match) => observedRisks.add(match.risk_level));
    }
    if (!['HIGH', 'MEDIUM', 'LOW', 'NONE'].every((risk) => observedRisks.has(risk))) {
      return { healthy: false, error: 'Production plagiarism risk coverage smoke test failed' };
    }

    const disabled = await request(`${baseUrl}/api/ai-grading/run-all`, {
      method: 'POST',
      redirect: 'manual',
      headers: authenticatedHeaders(sessions.teacher, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ assignmentId: '1' }),
    });
    const disabledBody = await readJson(disabled);
    if (disabled.status !== 503 || disabledBody?.code !== 'PROTOTYPE_EXTERNAL_PROCESSING_DISABLED') {
      return { healthy: false, error: 'Production authenticated 503 guard smoke test failed' };
    }

    const materialsUrl = `${baseUrl}/api/courses/DEMO-GEO/sessions/1/materials`;
    const teacherJsonHeaders = authenticatedHeaders(sessions.teacher, { 'Content-Type': 'application/json' });
    const baseline = await request(materialsUrl, { headers: authenticatedHeaders(sessions.teacher), redirect: 'manual' });
    const baselineBody = await readJson(baseline);
    const seededMaterial = baselineBody?.data?.find((material) => material.id === 1);
    if (baseline.status !== 200 || seededMaterial?.title !== 'Ringkasan Materi 1') {
      return { healthy: false, error: 'Production material baseline smoke test failed' };
    }

    const created = await request(materialsUrl, {
      method: 'POST', redirect: 'manual', headers: teacherJsonHeaders,
      body: JSON.stringify({ title: 'Smoke test material', content: 'Synthetic deployment smoke test data.' }),
    });
    const createdBody = await readJson(created);
    const dummyId = createdBody?.data?.id;
    if (created.status !== 200 || !dummyId) return { healthy: false, error: 'Production dummy create smoke test failed' };

    const afterCreate = await request(materialsUrl, { headers: authenticatedHeaders(sessions.teacher), redirect: 'manual' });
    const afterCreateBody = await readJson(afterCreate);
    if (afterCreate.status !== 200 || !afterCreateBody?.data?.some((material) => material.id === dummyId)) {
      return { healthy: false, error: 'Production dummy read smoke test failed' };
    }

    const dummyUrl = `${materialsUrl}/${dummyId}`;
    const updated = await request(dummyUrl, {
      method: 'PUT', redirect: 'manual', headers: teacherJsonHeaders,
      body: JSON.stringify({ title: 'Smoke test material updated', content: 'Synthetic deployment smoke test data.' }),
    });
    const updatedBody = await readJson(updated);
    if (updated.status !== 200 || updatedBody?.data?.title !== 'Smoke test material updated') {
      return { healthy: false, error: 'Production dummy update smoke test failed' };
    }

    const afterUpdate = await request(materialsUrl, { headers: authenticatedHeaders(sessions.teacher), redirect: 'manual' });
    const afterUpdateBody = await readJson(afterUpdate);
    if (!afterUpdateBody?.data?.some((material) => material.id === dummyId && material.title === 'Smoke test material updated')) {
      return { healthy: false, error: 'Production dummy updated-read smoke test failed' };
    }

    const deleted = await request(dummyUrl, { method: 'DELETE', redirect: 'manual', headers: authenticatedHeaders(sessions.teacher) });
    if (deleted.status !== 200) return { healthy: false, error: 'Production dummy delete smoke test failed' };
    const afterDelete = await request(materialsUrl, { headers: authenticatedHeaders(sessions.teacher), redirect: 'manual' });
    const afterDeleteBody = await readJson(afterDelete);
    if (afterDelete.status !== 200 || afterDeleteBody?.data?.some((material) => material.id === dummyId)) {
      return { healthy: false, error: 'Production dummy deletion verification failed' };
    }

    const sentinel = await request(`${materialsUrl}/1`, {
      method: 'PUT', redirect: 'manual', headers: teacherJsonHeaders,
      body: JSON.stringify({ title: 'Smoke reset sentinel', content: seededMaterial.content ?? '' }),
    });
    if (sentinel.status !== 200) return { healthy: false, error: 'Production reset sentinel smoke test failed' };

    const unauthorizedCron = await request(`${baseUrl}/api/cron/reset`, {
      headers: { Authorization: 'Bearer intentionally-wrong' }, redirect: 'manual',
    });
    const reset = await request(`${baseUrl}/api/cron/reset`, {
      headers: { Authorization: `Bearer ${environment.CRON_SECRET}` }, redirect: 'manual',
    });
    if (unauthorizedCron.status !== 401) return { healthy: false, error: 'Production cron authorization smoke test failed' };
    if (reset.status !== 200) return { healthy: false, error: 'Production reset smoke test failed' };

    const restored = await request(materialsUrl, { headers: authenticatedHeaders(sessions.teacher), redirect: 'manual' });
    const restoredBody = await readJson(restored);
    if (
      restored.status !== 200
      || restoredBody?.data?.find((material) => material.id === 1)?.title !== 'Ringkasan Materi 1'
      || restoredBody?.data?.some((material) => material.id === dummyId)
    ) {
      return { healthy: false, error: 'Production post-reset restoration smoke test failed' };
    }

    return { healthy: true };
  } catch {
    return { healthy: false, error: 'Production smoke test request failed' };
  }
}

module.exports = { productionSmokeTest, signIn };
