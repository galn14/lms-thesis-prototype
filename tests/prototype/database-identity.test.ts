import {
  assertSameDatabaseTarget,
  databaseTargetIdentity,
} from '@/lib/prototype/database-identity';

describe('database target identity', () => {
  it('normalizes Neon pooled and direct hosts to the same branch and database', () => {
    expect(databaseTargetIdentity(
      'postgresql://role:secret@ep-demo-pooler.ap-southeast-1.aws.neon.tech/lms?sslmode=require'
    )).toEqual({
      branchHost: 'ep-demo.ap-southeast-1.aws.neon.tech',
      database: 'lms',
    });
    expect(() => assertSameDatabaseTarget(
      'postgresql://role:secret@ep-demo-pooler.ap-southeast-1.aws.neon.tech/lms?sslmode=require',
      'postgresql://role:secret@ep-demo.ap-southeast-1.aws.neon.tech/lms?sslmode=require',
      'pooled',
      'direct'
    )).not.toThrow();
  });

  it.each([
    [
      'postgresql://role:secret@ep-one-pooler.region.aws.neon.tech/lms',
      'postgresql://role:secret@ep-two.region.aws.neon.tech/lms',
    ],
    [
      'postgresql://role:secret@ep-one-pooler.region.aws.neon.tech/lms',
      'postgresql://role:secret@ep-one.region.aws.neon.tech/other',
    ],
  ])('rejects different branches or databases', (pooled, direct) => {
    expect(() => assertSameDatabaseTarget(pooled, direct, 'pooled', 'direct')).toThrow(
      'same Neon branch and database'
    );
  });

  it.each(['not-a-url', 'https://example.test/database', 'postgresql://host/'])(
    'rejects malformed PostgreSQL targets',
    (value) => {
      expect(() => databaseTargetIdentity(value)).toThrow('PostgreSQL URL');
    }
  );
});
