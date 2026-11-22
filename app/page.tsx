import { getCatalog } from '@/lib/gundam-sync';
import { GundamAtlasApp } from '@/components/GundamAtlasApp';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const catalog = await getCatalog();
  return <GundamAtlasApp initialCatalog={catalog} />;
}
