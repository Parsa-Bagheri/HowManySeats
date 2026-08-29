export const MAX_SEARCH_DAYS = 3;

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateInput(value: string): boolean {
  const date = parseDateInput(value);
  return Boolean(date && formatDateInput(date) === value);
}

export function getSearchDates(startDate: string, endDate = startDate): string[] | undefined {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);

  if (!start || !end || end < start) {
    return undefined;
  }

  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;

  if (dayCount > MAX_SEARCH_DAYS) {
    return undefined;
  }

  return Array.from({ length: dayCount }, (_, index) => addDays(startDate, index));
}

export function normalizeEndDate(startDate: string, endDate?: string): string {
  if (!isValidDateInput(startDate)) {
    return endDate ?? startDate;
  }

  if (!endDate || !isValidDateInput(endDate) || endDate < startDate) {
    return startDate;
  }

  const latestEndDate = addDays(startDate, MAX_SEARCH_DAYS - 1);
  return endDate > latestEndDate ? latestEndDate : endDate;
}

export function addDays(value: string, days: number): string {
  const date = parseDateInput(value);

  if (!date) {
    return value;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInput(date);
}

export function formatDateRangeLabel(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} to ${endDate}`;
}

function parseDateInput(value: string): Date | undefined {
  if (!DATE_INPUT_PATTERN.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}
