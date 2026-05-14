import { TEMPLATE_COLUMN_TO_FIELD, escapeCsvCell, loadTemplateColumns } from '../shared.mjs';

export const mapQuestionToTemplateRow = ({ gameSlug, question }) => {
  const columns = loadTemplateColumns(gameSlug);
  return columns.map((column) => {
    const field = TEMPLATE_COLUMN_TO_FIELD[column];
    if (!field) return '';
    const value = question[field];
    return value == null ? '' : String(value);
  });
};

export const exportQuestionBatchToCsv = ({ gameSlug, questions }) => {
  const columns = loadTemplateColumns(gameSlug);
  const lines = [
    columns.map((cell) => escapeCsvCell(cell)).join(','),
    ...questions.map((question) => mapQuestionToTemplateRow({ gameSlug, question }).map((cell) => escapeCsvCell(cell)).join(',')),
  ];
  return `${lines.join('\n')}\n`;
};
