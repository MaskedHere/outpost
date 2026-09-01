import { FiUsers } from 'react-icons/fi';
import type { PlayerSummary } from '../lib/api';

export default function PlayerCount({ players, className = '' }: { players: PlayerSummary | null; className?: string }) {
  if (!players) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <FiUsers className="h-3.5 w-3.5" />
      {players.current}
      {players.max !== null ? `/${players.max}` : ''}
    </span>
  );
}
