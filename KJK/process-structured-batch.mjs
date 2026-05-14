import fs from 'node:fs';
import path from 'node:path';
import { exportQuestionBatchToCsv } from './exporters/service.mjs';
import { normalizeGeneratedBatch } from './generators/service.mjs';
import { listGameSlugs } from './shared.mjs';
import { validateQuestionBatch } from './validators/service.mjs';

const usage = () => {
  const games = listGameSlugs().join(', ');
  return [
    'Usage: node KJK/process-structured-batch.mjs <game-slug> <input-json> [output-csv] [--regeneration]',
    `Available games: ${games}`,
  ].join('\n');
};

const [, , gameSlug, inputPath, outputPath, modeFlag] = process.argv;

if (!gameSlug || !inputPath) {
  console.error(usage());
  process.exit(1);
}

const mode = modeFlag === '--regeneration' ? 'regeneration' : 'generation';

try {
  const questions = normalizeGeneratedBatch({ gameSlug, filePath: inputPath });
  const report = validateQuestionBatch({ gameSlug, questions, mode });

  if (!report.valid) {
    console.error(JSON.stringify({
      valid: false,
      gameSlug,
      mode,
      batchErrors: report.batchErrors,
      failedRows: report.failedRows.map((row) => ({
        rowIndex: row.index,
        errors: row.errors,
      })),
      regenerationPlan: report.regenerationPlan,
    }, null, 2));
    process.exit(2);
  }

  const csv = exportQuestionBatchToCsv({ gameSlug, questions });
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), csv, 'utf8');
  } else {
    process.stdout.write(csv);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
