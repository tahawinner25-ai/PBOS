import { Badge } from '@/components/ui/badge';

/** Every seeded row carries this so demo data can never be mistaken for the creator's real numbers. */
export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge variant="warning" title="Sample data you can remove in Settings">
      Demo
    </Badge>
  );
}
