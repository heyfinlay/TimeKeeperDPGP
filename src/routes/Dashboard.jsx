import { Link } from 'react-router-dom';
import DashboardPage from '@/pages/dashboard/DashboardPage.jsx';

export default function Dashboard() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/5 bg-[#060910]/80 px-6 py-4">
        <h1 className="text-sm font-semibold uppercase tracking-[0.35em] text-neutral-300">Dashboard</h1>
        <Link
          to="/account/setup"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.35em] text-[#9FF7D3] transition hover:border-[#9FF7D3]/60 hover:text-white"
        >
          Update profile
        </Link>
      </div>
      <DashboardPage />
    </div>
  );
}
