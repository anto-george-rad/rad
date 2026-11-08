import { requireCrmPage } from '@/lib/auth';
import { licenceRows } from '@/lib/ext-data';
import { LicenceRegister } from '@/components/customer-360';

export const metadata = { title: 'Licences' };
export default async function LicencesPage() {
  await requireCrmPage();
  return <LicenceRegister rows={await licenceRows()} />;
}
