import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createMedication, listMedications } from '@/db/repositories';
import type { Database } from '@/db/types';
import { createBackup, serializeBackup } from '@/features/backup/backup';
import { BackupCard } from '@/features/backup/components/BackupCard';
import type { FileExporter } from '@/features/history/exporter';
import { createTestDb } from '../helpers/testDb';

jest.mock('@/features/reminders/sync');
jest.setTimeout(20_000);

let db: Database;
let shared: string[];
const exporter = (available = true): FileExporter => ({
  canShare: async () => available,
  writeText: async (name) => `file:///cache/${name}`,
  htmlToPdf: async (name) => name,
  share: async (uri) => {
    shared.push(uri);
  },
});

const renderCard = async (props: Partial<Parameters<typeof BackupCard>[0]> = {}) =>
  await render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
      <BackupCard exporter={exporter()} picker={{ pickText: async () => null }} {...props} />
    </DatabaseProvider>,
  );

beforeEach(async () => {
  shared = [];
  db = await createTestDb();
  await createMedication(db, {
    name: 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
});

describe('BackupCard', () => {
  it('exports a backup and warns that the file is private', async () => {
    await renderCard();
    expect(screen.getByText(/not encrypted/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Export backup'));
    expect(await screen.findByText(/Backup ready: 1 medication, 0 dose records/)).toBeTruthy();
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatch(/offlinemedstrack-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('shows an error when sharing is unavailable', async () => {
    await renderCard({ exporter: exporter(false) });
    await fireEvent.press(screen.getByText('Export backup'));
    expect(await screen.findByText('Sharing is not available on this device.')).toBeTruthy();
  });

  it('restores a chosen backup after confirmation and tells the screen', async () => {
    const source = await createTestDb();
    await createMedication(source, {
      name: 'Other',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    await createMedication(source, {
      name: 'Another',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    const text = serializeBackup(await createBackup(source, new Date(2026, 5, 10)));
    const onRestored = jest.fn();
    const confirm = jest.fn().mockResolvedValue(true);
    await renderCard({ picker: { pickText: async () => text }, confirm, onRestored });

    await fireEvent.press(screen.getByText('Restore from backup'));
    expect(await screen.findByText('Restored 2 medications and 0 dose records.')).toBeTruthy();
    expect(confirm).toHaveBeenCalled();
    expect(onRestored).toHaveBeenCalled();
    expect((await listMedications(db)).map((m) => m.name).sort()).toEqual(['Another', 'Other']);
  });

  it('does not replace anything when the person declines, and explains bad files', async () => {
    const source = await createTestDb();
    const text = serializeBackup(await createBackup(source, new Date(2026, 5, 10)));
    await renderCard({ picker: { pickText: async () => text }, confirm: async () => false });
    await fireEvent.press(screen.getByText('Restore from backup'));
    await waitFor(() => expect(screen.queryByText('Working…')).toBeNull());
    expect((await listMedications(db)).map((m) => m.name)).toEqual(['Metformin']);
  });

  it('explains when a backup is from a newer version of the app', async () => {
    const source = await createTestDb();
    const text = serializeBackup(await createBackup(source, new Date(2026, 5, 10)));
    const newer = JSON.stringify({ ...JSON.parse(text), schemaVersion: 99 });
    await renderCard({ picker: { pickText: async () => newer } });
    await fireEvent.press(screen.getByText('Restore from backup'));
    expect(await screen.findByText(/newer version of the app/)).toBeTruthy();
    expect((await listMedications(db)).map((m) => m.name)).toEqual(['Metformin']);
  });
});
