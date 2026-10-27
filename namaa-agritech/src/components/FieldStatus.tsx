import { useFieldData } from '@/lib/field-data';

/** Shared empty / error states so every section explains why it has nothing to show. */
export default function FieldStatus({ needs }: { needs: 'field' | 'points' }) {
  const { signedIn, loading, error, field, points } = useFieldData();

  let msg: string | null = null;
  if (!signedIn) msg = 'Sign in to see your field data.';
  else if (loading) msg = 'Loading…';
  else if (error) msg = `Could not load data: ${error}`;
  else if (!field) msg = 'No environment yet. Create one in “My environments” at the top of the page.';
  else if (needs === 'points' && points.length === 0)
    msg = 'This field has no sensor points yet (or access to them has not been granted).';

  if (!msg) return null;
  return <div className="glass-card p-8 text-center text-sm text-forest-700/70">{msg}</div>;
}
