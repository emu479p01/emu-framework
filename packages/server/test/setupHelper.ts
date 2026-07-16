import type { FastifyInstance } from 'fastify';

export const TEST_SETUP_CODE = 'ABCDEF123456';
export const TEST_ADMIN_PASSWORD = 'Admin-password-123';

export async function completeTestSetup(app: FastifyInstance, username = 'admin'): Promise<{ cookie: string }> {
  const response = await app.inject({
    method: 'POST', url: '/api/setup/complete',
    payload: { code: TEST_SETUP_CODE, username, displayName: 'Administrator', password: TEST_ADMIN_PASSWORD },
  });
  if (response.statusCode !== 200) throw new Error(`Test setup failed (${response.statusCode}): ${response.body}`);
  return { cookie: (response.headers['set-cookie'] as string).split(';')[0] };
}
