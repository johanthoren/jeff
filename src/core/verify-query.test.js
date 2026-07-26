// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function loadQueryVerificationState() {
  let module;
  try {
    module = await import('./verify-query.js');
  } catch (error) {
    assert.fail(`[verify-query] fixed verifier query seam is missing: ${String(error)}`);
  }
  assert.equal(typeof module.queryVerificationState, 'function', '[verify-query] queryVerificationState must be exported');
  return module.queryVerificationState;
}

test('issue 101 cycle 2: verifier query seam exposes only fixed Git and HTTPS reads', async (t) => {
  const queryVerificationState = await loadQueryVerificationState();

  await t.test('Git ref query fixes the executable and argument vector', async () => {
    /** @type {Array<{ cwd: string, args: string[], options: Record<string, any> }>} */
    const calls = [];
    const result = await queryVerificationState('/repo', {
      kind: 'git-ref',
      target: 'refs/heads/release',
    }, {
      verificationSeams: ['git-ref refs/heads/release'],
      git: (cwd, args, options) => {
        calls.push({ cwd, args, options });
        return { status: 0, stdout: '0123456789abcdef\n', stderr: '' };
      },
      fetch: assert.fail,
    });

    assert.deepEqual(calls, [{
      cwd: '/repo',
      args: [
        '--no-optional-locks',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.untrackedCache=false',
        'rev-parse', '--verify', '--end-of-options', 'refs/heads/release^{object}',
      ],
      options: { env: { GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' } },
    }]);
    assert.deepEqual(result, {
      command: 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false rev-parse --verify --end-of-options refs/heads/release^{object}',
      output: '{"status":0,"stdout":"0123456789abcdef\\n","stderr":""}',
    });
  });

  await t.test('external query is HTTPS GET with redirects rejected', async () => {
    /** @type {Array<{ url: string, options: Record<string, unknown> }>} */
    const calls = [];
    const result = await queryVerificationState('/repo', {
      kind: 'https-get',
      url: 'https://registry.example.test/v1/entries/release',
    }, {
      verificationSeams: ['https-get https://registry.example.test/v1/entries/release'],
      git: assert.fail,
      fetch: async (url, options) => {
        calls.push({ url: String(url), options });
        return {
          status: 200,
          url: String(url),
          text: async () => '{"state":"moved"}',
        };
      },
    });

    assert.deepEqual(calls, [{
      url: 'https://registry.example.test/v1/entries/release',
      options: { method: 'GET', redirect: 'error' },
    }]);
    assert.deepEqual(result, {
      command: 'GET https://registry.example.test/v1/entries/release',
      output: '{"status":200,"url":"https://registry.example.test/v1/entries/release","body":"{\\"state\\":\\"moved\\"}"}',
    });
  });

  await t.test('free-form, unsafe, and plan-unnamed queries fail closed', async () => {
    const dependencies = {
      verificationSeams: [
        'git-ref --upload-pack=evil',
        'https-get http://registry.example.test/v1/entries/release',
      ],
      git: assert.fail,
      fetch: assert.fail,
    };
    for (const query of [
      { kind: 'git', command: ['reset', '--hard'] },
      { kind: 'git-ref', target: '--upload-pack=evil' },
      { kind: 'https-get', url: 'http://registry.example.test/v1/entries/release' },
    ]) {
      await assert.rejects(
        queryVerificationState('/repo', query, dependencies),
        /\[verify-query\]/,
      );
    }
    await assert.rejects(
      queryVerificationState('/repo', {
        kind: 'https-get',
        url: 'https://registry.example.test/v1/entries/unplanned',
      }, {
        verificationSeams: ['https-get https://registry.example.test/v1/entries/release'],
        git: assert.fail,
        fetch: assert.fail,
      }),
      /\[verify-query\].*(?:plan|seam|named)/,
    );
  });
});
