import { NavLink } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Filter,
  GaugeCircle,
  History,
  PackageCheck,
  Plug,
  ShipWheel,
  Sparkles,
  Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV: { to: string; label: string; icon: typeof Activity }[] = [
  { to: '/', label: 'Command Center', icon: GaugeCircle },
  { to: '/funnel', label: 'Pipeline Funnel', icon: ShipWheel },
  { to: '/validated', label: 'Validated Products', icon: PackageCheck },
  { to: '/rejected', label: 'Rejected Products', icon: AlertTriangle },
  { to: '/competition', label: 'Competition Review', icon: Filter },
  { to: '/shipping', label: 'Shipping Review', icon: Truck },
  { to: '/exports', label: 'Export Center', icon: History },
  { to: '/manual-qa', label: 'Manual QA', icon: ClipboardCheck },
  { to: '/agent-logs', label: 'Agent Logs', icon: Activity },
  { to: '/discovery-agents', label: 'Discovery Agents', icon: Plug },
];

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand" />
          OTTO Ops
        </div>
        <div className="text-[11px] text-muted mt-0.5">V1 internal dashboard</div>
      </div>
      <nav className="px-2 py-3 flex flex-col gap-0.5 text-sm">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-muted transition',
                  isActive ? 'bg-panel2 text-text' : 'hover:bg-panel2 hover:text-text',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="mt-auto p-3 text-[11px] text-muted border-t border-border">
        Read-only · no public auth
      </div>
    </aside>
  );
}
