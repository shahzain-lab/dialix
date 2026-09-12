import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, downloadBlob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import { Badge, Button, Card, Input, Label, PageHeader, QueryPanel, Select } from "../components/ui";

type Call = {
  id: string;
  direction: string;
  status: string;
  fromNumber: string | null;
  toNumber: string | null;
  durationSeconds: number;
  creditsCharged: number;
  summary: string | null;
  transcript: unknown[];
  crmSyncStatus: string;
  recordingUrl: string | null;
};

export function CallsPage() {
  const toast = useToast();
  const { org } = useAuth();
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["calls", org?.id, status, direction],
    enabled: Boolean(org),
    queryFn: () => {
      const q = new URLSearchParams();
      if (status) q.set("status", status);
      if (direction) q.set("direction", direction);
      const suffix = q.toString() ? `?${q}` : "";
      return api<Call[]>(`/api/v1/calls${suffix}`);
    },
  });
  return (
    <div>
      <PageHeader
        title="Calls"
        subtitle="Transcripts and usage for this organization only."
        actions={
          <div className="flex gap-2">
            <Link to="/calls/outbound"><Button>Place outbound call</Button></Link>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  downloadBlob(await api<Blob>("/api/v1/calls/export"), "calls.csv");
                  toast.success("Export started", "calls.csv is downloading.");
                } catch (err) {
                  toast.error("Export failed", errorMessage(err, "Could not download calls.csv."));
                }
              }}
            >
              Export
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="queued">queued</option>
          <option value="ringing">ringing</option>
          <option value="started">started</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </Select>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">All directions</option>
          <option value="inbound">inbound</option>
          <option value="outbound">outbound</option>
        </Select>
      </div>
      <QueryPanel
        loading={isPending}
        error={error}
        empty={!data?.length}
        emptyTitle="No calls yet"
        emptyDetail="Place an outbound call or wait for inbound traffic on an assigned number."
      >
        <div className="space-y-2">
          {(data ?? []).map((c) => (
            <Link key={c.id} to={`/calls/${c.id}`}>
              <Card className="flex items-center justify-between p-4 hover:border-accent/40">
                <div>
                  <div className="font-medium">{c.direction} · {c.toNumber || c.fromNumber}</div>
                  <div className="text-sm text-mist-400">{c.durationSeconds}s · {c.creditsCharged} credits · CRM {c.crmSyncStatus}</div>
                </div>
                <Badge tone={c.status === "completed" ? "good" : c.status === "failed" ? "bad" : "warn"}>{c.status}</Badge>
              </Card>
            </Link>
          ))}
        </div>
      </QueryPanel>
    </div>
  );
}

export function CallDetailPage() {
  const { id } = useParams();
  const { org } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["call", org?.id, id],
    enabled: Boolean(id) && Boolean(org),
    queryFn: () => api<Call>(`/api/v1/calls/${id}`),
  });
  return (
    <div>
      <PageHeader title="Call detail" subtitle={data ? `${data.direction} ${data.toNumber || data.fromNumber || ""}` : undefined} />
      <QueryPanel loading={isPending} error={error}>
        <Card className="p-6">
          <div className="mb-4 flex gap-2">
            <Badge>{data?.direction}</Badge>
            <Badge tone={data?.status === "completed" ? "good" : data?.status === "failed" ? "bad" : "warn"}>{data?.status}</Badge>
          </div>
          <p className="text-mist-400">{data?.summary || "No summary yet. Summaries appear after Cartesia post-call analysis."}</p>
          <div className="mt-6 space-y-3">
            {(Array.isArray(data?.transcript) ? data!.transcript : []).map((turn, i) => (
              <div key={i} className="rounded-lg bg-ink-900 p-3 text-sm">{typeof turn === "string" ? turn : JSON.stringify(turn)}</div>
            ))}
            {!data?.transcript || (Array.isArray(data.transcript) && !data.transcript.length) ? (
              <p className="text-sm text-mist-400">Transcript turns will show here when the call completes.</p>
            ) : null}
          </div>
        </Card>
      </QueryPanel>
    </div>
  );
}

export function OutboundPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { org } = useAuth();
  const [agentId, setAgentId] = useState("");
  const [fromNumberId, setFromNumberId] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [contactId, setContactId] = useState("");
  const { data: agents, isPending: agentsPending } = useQuery({
    queryKey: ["agents", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string }>>("/api/v1/agents"),
  });
  const { data: numbers, isPending: numbersPending } = useQuery({
    queryKey: ["numbers", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; e164: string }>>("/api/v1/phone-numbers"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; phone: string; firstName: string | null }>>("/api/v1/contacts"),
  });
  const dial = useMutation({
    mutationFn: () => {
      if (!agentId) throw new Error("Choose an agent before dialing.");
      if (!fromNumberId) throw new Error("Choose a from-number (caller ID) before dialing.");
      if (!toNumber.trim()) throw new Error("Enter the destination in E.164, for example +14155551234.");
      return api<{ id: string; toNumber: string }>("/api/v1/calls/outbound", {
        method: "POST",
        body: JSON.stringify({
          agentId,
          fromNumberId,
          toNumber,
          contactId: contactId || undefined,
        }),
      });
    },
    onSuccess: (row) => {
      toast.success("Outbound call queued", `Dialix reserved credits and asked Cartesia to call ${row.toNumber}.`);
      nav("/calls");
    },
    onError: (err) => toast.error("Could not place the call", errorMessage(err, "Check credits, consent, and Cartesia provisioning.")),
  });
  const loading = agentsPending || numbersPending;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Place outbound call" subtitle="Credits are reserved before Cartesia dials." />
      <QueryPanel loading={loading} error={null}>
        <div className="space-y-4">
          <div>
            <Label>Agent</Label>
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Choose agent</option>
              {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>From number</Label>
            <Select value={fromNumberId} onChange={(e) => setFromNumberId(e.target.value)}>
              <option value="">Choose caller ID</option>
              {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}
            </Select>
          </div>
          <div>
            <Label>Destination</Label>
            <Input value={toNumber} onChange={(e) => setToNumber(e.target.value)} placeholder="+1…" />
          </div>
          <div>
            <Label>CRM contact (optional)</Label>
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">No CRM contact</option>
              {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.phone}</option>)}
            </Select>
          </div>
          <Button loading={dial.isPending} onClick={() => dial.mutate()}>Dial</Button>
        </div>
      </QueryPanel>
    </div>
  );
}
