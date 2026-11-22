import { getCatalog } from '@/lib/gundam-sync';
import { GundamAtlasApp } from '@/components/GundamAtlasApp';

export const revalidate = 3600;

export default async function HomePage() {
  const catalog = await getCatalog();
  return <GundamAtlasApp initialCatalog={catalog} />;
}
