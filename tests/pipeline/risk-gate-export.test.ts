import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function writeJson(path: string, payload: unknown): void {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

test('export_artifacts.py emits canonical runtime policy fields and model payloads', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'risk-gate-export-test-'));
  try {
    const fixturesDir = join(tempRoot, 'fixtures');
    const outDir = join(tempRoot, 'out');
    mkdirSync(fixturesDir, { recursive: true });

    const localModelPath = join(fixturesDir, 'local_model.json');
    const openaiModelPath = join(fixturesDir, 'openai_model.json');
    const policyPath = join(fixturesDir, 'policy.json');
    const featureSchemaPath = join(fixturesDir, 'feature_schema.json');
    const localMetricsPath = join(fixturesDir, 'local_metrics.json');
    const openaiMetricsPath = join(fixturesDir, 'openai_metrics.json');
    const policyMetricsPath = join(fixturesDir, 'policy_metrics.json');

    writeJson(localModelPath, {
      local_model: {
        intercept: -0.11,
        coefficients: [0.4, -0.2],
      },
    });
    writeJson(openaiModelPath, {
      model: {
        bias: 0.23,
        weights: [0.7, -0.9, 0.1],
      },
    });
    writeJson(policyPath, {
      thresholds: {
        local_low: 0.15,
        local_high: 0.8,
        openai_threshold: 0.55,
      },
      max_feature_chars: 6000,
    });
    writeJson(featureSchemaPath, {
      schema_version: 'risk-gate-v1',
    });
    writeJson(localMetricsPath, { accuracy: 0.72 });
    writeJson(openaiMetricsPath, { accuracy: 0.74 });
    writeJson(policyMetricsPath, { recall: 0.99 });

    const exportScriptPath = resolve(process.cwd(), 'scripts/risk_gate/export_artifacts.py');
    const result = spawnSync(
      'python3',
      [
        exportScriptPath,
        '--local-model',
        localModelPath,
        '--openai-model',
        openaiModelPath,
        '--policy',
        policyPath,
        '--feature-schema',
        featureSchemaPath,
        '--local-metrics',
        localMetricsPath,
        '--openai-metrics',
        openaiMetricsPath,
        '--policy-metrics',
        policyMetricsPath,
        '--out-dir',
        outDir,
      ],
      {
        encoding: 'utf-8',
      }
    );

    assert.equal(
      result.status,
      0,
      `export_artifacts.py failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );

    const canonicalPolicy = readJson(join(outDir, 'policy.json'));
    const requiredFields = [
      'policy_version',
      'created_at',
      'local_low',
      'local_high',
      'openai_threshold',
      'local_model',
      'openai_model',
      'sources',
    ];

    for (const field of requiredFields) {
      assert.ok(field in canonicalPolicy, `Missing required top-level field: ${field}`);
    }

    assert.equal(canonicalPolicy.policy_version, 'risk-gate-v1');
    assert.equal(typeof canonicalPolicy.created_at, 'string');
    assert.ok(Number.isFinite(Date.parse(String(canonicalPolicy.created_at))));
    assert.equal(canonicalPolicy.local_low, 0.15);
    assert.equal(canonicalPolicy.local_high, 0.8);
    assert.equal(canonicalPolicy.openai_threshold, 0.55);
    assert.equal(canonicalPolicy.max_feature_chars, 6000);
    assert.deepEqual(canonicalPolicy.local_model, {
      intercept: -0.11,
      coefficients: [0.4, -0.2],
    });
    assert.deepEqual(canonicalPolicy.openai_model, {
      intercept: 0.23,
      coefficients: [0.7, -0.9, 0.1],
    });

    const sources = canonicalPolicy.sources as Record<string, unknown>;
    assert.equal(sources.local_model, localModelPath);
    assert.equal(sources.openai_model, openaiModelPath);
    assert.equal(sources.selected_policy, policyPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
