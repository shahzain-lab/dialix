import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Card, PageHeader, QueryPanel } from "../components/ui";

type Overview = {
  balance: number;
  liveCalls: number;
  todayAppointments: number;
  recentCalls: Array<{ id: string; direction: string; status: string; toNumber: string | null; fromNumber: string | null; durationSeconds: number }>;
  usage: Array<{ day: string; seconds: number; credits: number }>;
};

export function OverviewPage() {
  const { org } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["overview", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Overview>("/api/v1/overview"),
  });
  return (
    <div>
      <PageHeader title="Overview" subtitle="Live usage across this isolated workspace." />
      <QueryPanel loading={isPending} error={error}>
        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Credit balance" value={data ? data.balance.toLocaleString() : "—"} hint="1 credit = 1 billed second at your rate" />
          <Stat label="Live calls" value={String(data?.liveCalls ?? 0)} />
          <Stat label="Appointments today" value={String(data?.todayAppointments ?? 0)} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 font-medium">Usage</h2>
            <div className="space-y-2">
              {(data?.usage ?? []).slice(-10).map((row) => (
                <div key={row.day} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-mist-400">{row.day}</span>
                  <span>{Math.round(row.seconds / 60)} min · {row.credits} credits</span>
                </div>
              ))}
              {!data?.usage?.length ? <p className="text-sm text-mist-400">No billed minutes yet. Place a test call after you attach a number.</p> : null}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-medium">Recent calls</h2>
            <div className="space-y-2">
              {(data?.recentCalls ?? []).map((call) => (
                <Link key={call.id} to={`/calls/${call.id}`} className="flex items-center justify-between gap-3 text-sm hover:text-white">
                  <div>
                    <div className="font-medium">{call.direction} · {call.toNumber || call.fromNumber}</div>
                    <div className="text-mist-400">{call.durationSeconds}s</div>
                  </div>
                  <Badge tone={call.status === "completed" ? "good" : call.status === "failed" ? "bad" : "warn"}>{call.status}</Badge>
                </Link>
              ))}
              {!data?.recentCalls?.length ? <p className="text-sm text-mist-400">No calls in this workspace yet.</p> : null}
            </div>
          </Card>
        </div>
      </QueryPanel>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-mist-400">{label}</div>
      <div className="mt-2 font-mono text-3xl">{value}</div>
      {hint ? <div className="mt-1 text-xs text-mist-400">{hint}</div> : null}
    </Card>
  );
}
