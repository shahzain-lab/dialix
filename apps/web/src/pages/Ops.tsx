import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { localDateTimeToIso } from "../lib/datetime";
import { errorMessage, useToast } from "../lib/toast";
import { Badge, Button, Card, ConfirmDialog, Input, Label, PageHeader, QueryPanel } from "../components/ui";

export function AppointmentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [cancelRow, setCancelRow] = useState<{ id: string; title: string } | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ["appointments", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; title: string; startsAt: string; endsAt: string; status: string; attendeePhone: string | null }>>("/api/v1/appointments"),
  });
  const book = useMutation({
    mutationFn: (payload: { title: string; startsAt: string; endsAt: string; attendeePhone?: string }) =>
      api("/api/v1/appointments", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async (_row, vars) => {
      toast.success("Appointment booked", `${vars.title} is on the workspace calendar.`);
      formRef.current?.reset();
      await qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (err) => toast.error("Could not book the appointment", errorMessage(err, "Check the start and end times.")),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/appointments/${cancelRow!.id}`, { method: "PATCH", body: JSON.stringify({ status: "canceled" }) }),
    onSuccess: async () => {
      toast.success("Appointment canceled", `${cancelRow?.title} is no longer scheduled.`);
      setCancelRow(null);
      await qc.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (err) => toast.error("Could not cancel the appointment", errorMessage(err, "Retry cancel.")),
  });
  return (
    <div>
      <PageHeader title="Appointments" subtitle="Booked by agents via Google Calendar or Microsoft 365 tools." />
      <Card className="mb-6 p-5">
        <form
          ref={formRef}
          className="grid gap-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            try {
              const title = String(fd.get("title") ?? "").trim();
              if (!title) throw new Error("Give the appointment a title.");
              book.mutate({
                title,
                startsAt: localDateTimeToIso(String(fd.get("startsAt") ?? ""), "start time"),
                endsAt: localDateTimeToIso(String(fd.get("endsAt") ?? ""), "end time"),
                attendeePhone: String(fd.get("phone") ?? "") || undefined,
              });
            } catch (err) {
              toast.error("Could not book the appointment", errorMessage(err, "Pick a valid start and end time."));
            }
          }}
        >
          <Input name="title" placeholder="Title" required />
          <Input name="startsAt" type="datetime-local" required />
          <Input name="endsAt" type="datetime-local" required />
          <Input name="phone" placeholder="Attendee phone" />
          <Button type="submit" loading={book.isPending}>Book</Button>
        </form>
      </Card>
      <QueryPanel
        loading={isPending}
        error={error}
        empty={!data?.length}
        emptyTitle="No appointments yet"
        emptyDetail="Book a slot here or let an appointment-setter agent write one after a call."
      >
        {(data ?? []).map((a) => (
          <Card key={a.id} className="mb-3 flex items-center justify-between p-4">
            <div>
              <div className="font-medium">{a.title}</div>
              <div className="text-sm text-mist-400">{new Date(a.startsAt).toLocaleString()} → {new Date(a.endsAt).toLocaleTimeString()}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{a.status}</Badge>
              {a.status !== "canceled" ? <Button variant="outline" onClick={() => setCancelRow({ id: a.id, title: a.title })}>Cancel</Button> : null}
            </div>
          </Card>
        ))}
      </QueryPanel>
      <ConfirmDialog
        open={Boolean(cancelRow)}
        title="Cancel this appointment?"
        body={`${cancelRow?.title} will be marked canceled and removed from the connected calendar if one is linked.`}
        confirmLabel="Cancel appointment"
        loading={cancel.isPending}
        onCancel={() => setCancelRow(null)}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}

export function IntegrationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const [params] = useSearchParams();
  const [disconnect, setDisconnect] = useState<{ id: string; label: string } | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["integrations", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ provider: string; status: string }>>("/api/v1/integrations"),
  });
  useEffect(() => {
    const connected = params.get("connected");
    if (connected) {
      toast.success("Integration connected", `${connected.replaceAll("_", " ")} tokens are stored encrypted in this workspace.`);
    }
  }, [params, toast]);
  const connect = useMutation({
    mutationFn: (provider: string) => api<{ url: string }>(`/api/v1/integrations/${provider}/start`),
    onSuccess: (res, provider) => {
      toast.info("Redirecting to OAuth", `Continue in the ${provider.replaceAll("_", " ")} consent screen.`);
      window.location.assign(res.url);
    },
    onError: (err) => toast.error("Could not start OAuth", errorMessage(err, "Set the provider client ID and secret on the API.")),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/integrations/${disconnect!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Integration disconnected", `${disconnect?.label} tokens were removed from this workspace.`);
      setDisconnect(null);
      await qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) => toast.error("Could not disconnect", errorMessage(err, "Retry disconnect.")),
  });
  const saveCrm = useMutation({
    mutationFn: (payload: Record<string, string>) => api("/api/v1/integrations/custom_crm", { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: async () => {
      toast.success("Custom CRM saved", "Lookup, upsert, and call-log paths will be used from agent tools.");
      await qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err) => toast.error("Could not save the custom CRM", errorMessage(err, "Check the base URL and auth header.")),
  });
  const status = (p: string) => data?.find((d) => d.provider === p)?.status ?? "disconnected";
  return (
    <div>
      <PageHeader title="Integrations" subtitle="OAuth tokens stay encrypted in Dialix. Cartesia only calls Dialix tool URLs." />
      <QueryPanel loading={isPending} error={error}>
        {[
          ["google_calendar", "Google Calendar"],
          ["microsoft_365", "Microsoft 365"],
          ["hubspot", "HubSpot"],
        ].map(([id, label]) => (
          <Card key={id} className="mb-3 flex items-center justify-between p-5">
            <div>
              <div className="font-medium">{label}</div>
              <Badge tone={status(id) === "connected" ? "good" : "neutral"}>{status(id)}</Badge>
            </div>
            <div className="flex gap-2">
              <Button loading={connect.isPending} onClick={() => connect.mutate(id)}>Connect</Button>
              <Button variant="danger" onClick={() => setDisconnect({ id, label })}>Disconnect</Button>
            </div>
          </Card>
        ))}
        <Card className="p-5">
          <h3 className="mb-3 font-medium">Custom REST CRM</h3>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              saveCrm.mutate({
                baseUrl: String(fd.get("baseUrl")),
                authHeaderName: String(fd.get("authHeaderName") || "Authorization"),
                authHeaderValue: String(fd.get("authHeaderValue")),
                lookupPath: String(fd.get("lookupPath") || "/contacts/lookup"),
                upsertPath: String(fd.get("upsertPath") || "/contacts"),
                logCallPath: String(fd.get("logCallPath") || "/calls"),
                phoneQueryParam: "phone",
              });
            }}
          >
            <Input name="baseUrl" placeholder="https://crm.example.com" required />
            <Input name="authHeaderValue" placeholder="Bearer token" required />
            <Input name="authHeaderName" placeholder="Authorization" />
            <Input name="lookupPath" placeholder="/contacts/lookup" />
            <Button type="submit" loading={saveCrm.isPending}>Save custom CRM</Button>
          </form>
        </Card>
      </QueryPanel>
      <ConfirmDialog
        open={Boolean(disconnect)}
        title="Disconnect this integration?"
        body={`${disconnect?.label} will stop receiving calendar or CRM tool calls until you connect it again.`}
        confirmLabel="Disconnect"
        loading={remove.isPending}
        onCancel={() => setDisconnect(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export function BillingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const [params] = useSearchParams();
  const { data, isPending, error } = useQuery({
    queryKey: ["billing", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<{
      balance: number;
      minutes: number;
      packs: Array<{ id: string; name: string; minutes: number }>;
      ledger: Array<{ id: string; type: string; amount: number; description: string | null; createdAt: string }>;
      stripeConfigured: boolean;
    }>("/api/v1/billing"),
  });
  useEffect(() => {
    if (params.get("checkout") === "success") toast.success("Payment received", "Credits will appear on the ledger after the Stripe webhook settles.");
    if (params.get("checkout") === "cancel") toast.info("Checkout canceled", "No credits were purchased.");
  }, [params, toast]);
  const buy = useMutation({
    mutationFn: (packId: string) => api<{ url: string | null; granted?: number }>(" /api/v1/billing/checkout".trim(), { method: "POST", body: JSON.stringify({ packId }) }),
    onSuccess: async (res, packId) => {
      const pack = data?.packs.find((p) => p.id === packId);
      if (res.url) {
        toast.info("Redirecting to Stripe", `Complete checkout for ${pack?.name ?? "this pack"}.`);
        window.location.assign(res.url);
        return;
      }
      toast.success("Credits granted", `${pack?.name ?? "Pack"} added ${(res.granted ?? 0).toLocaleString()} credits in development mode.`);
      await qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (err) => toast.error("Could not start checkout", errorMessage(err, "Only owners and admins can buy credit packs.")),
  });
  return (
    <div>
      <PageHeader title="Billing" subtitle="Prepaid credits. 1 credit = 1 second of billed agent time at your org rate." />
      <QueryPanel loading={isPending} error={error}>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <div className="text-xs uppercase text-mist-400">Balance</div>
            <div className="mt-2 font-mono text-4xl">{data?.balance.toLocaleString()}</div>
            <div className="text-sm text-mist-400">≈ {data?.minutes.toFixed(1)} minutes</div>
          </Card>
          <Card className="flex flex-wrap gap-2 p-5">
            {(data?.packs ?? []).map((p) => (
              <Button key={p.id} loading={buy.isPending} onClick={() => buy.mutate(p.id)}>
                {p.name} · {p.minutes.toLocaleString()} min
              </Button>
            ))}
            {!data?.stripeConfigured ? <p className="w-full text-xs text-mist-400">Stripe unset — packs grant credits locally for development.</p> : null}
          </Card>
        </div>
        {(data?.ledger ?? []).length ? (data?.ledger ?? []).map((row) => (
          <div key={row.id} className="flex justify-between border-b border-ink-600 py-2 text-sm">
            <span>{row.type} · {row.description}</span>
            <span className="font-mono">{row.amount}</span>
          </div>
        )) : <p className="text-sm text-mist-400">No ledger entries yet. Buy a pack to add credits.</p>}
      </QueryPanel>
    </div>
  );
}

export function TeamPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["team", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<{ members: Array<{ id: string; role: string; user: { name: string; email: string } | null }>; invites: Array<{ id: string; email: string; role: string }> }>("/api/v1/team"),
  });
  const invite = useMutation({
    mutationFn: (payload: { email: string; role: string }) =>
      api<{ inviteUrl: string; email: string }>("/api/v1/team/invites", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async (row) => {
      toast.success("Invite created", `${row.email} can join via ${row.inviteUrl}`);
      await qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (err) => toast.error("Could not send the invite", errorMessage(err, "Only owners and admins can invite teammates.")),
  });
  return (
    <div>
      <PageHeader title="Team" subtitle="Owners and admins invite operators and viewers into this isolated workspace." />
      <Card className="mb-6 p-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const email = String(fd.get("email") ?? "").trim();
            if (!email) {
              toast.error("Email required", "Enter the teammate's email address.");
              return;
            }
            invite.mutate({ email, role: String(fd.get("role")) });
            e.currentTarget.reset();
          }}
        >
          <Input name="email" type="email" placeholder="email" required />
          <select name="role" className="rounded-lg border border-ink-600 bg-ink-950 px-3">
            <option>operator</option>
            <option>admin</option>
            <option>viewer</option>
          </select>
          <Button type="submit" loading={invite.isPending}>Invite</Button>
        </form>
      </Card>
      <QueryPanel loading={isPending} error={error}>
        {(data?.members ?? []).map((m) => (
          <Card key={m.id} className="mb-2 flex justify-between p-4">
            <div>{m.user?.name} · {m.user?.email}</div>
            <Badge>{m.role}</Badge>
          </Card>
        ))}
        {(data?.invites ?? []).length ? <h3 className="mb-2 mt-6 text-sm font-medium text-mist-400">Pending invites</h3> : null}
        {(data?.invites ?? []).map((i) => (
          <Card key={i.id} className="mb-2 flex justify-between p-4">
            <div>{i.email}</div>
            <Badge tone="warn">{i.role} · pending</Badge>
          </Card>
        ))}
      </QueryPanel>
    </div>
  );
}

export function SettingsPage() {
  const { org, refresh } = useAuth();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (payload: Record<string, string | null>) => api(`/api/v1/organizations/${org!.id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: async (_row, vars) => {
      toast.success("Workspace updated", `${vars.name || org?.name} settings are saved.`);
      await refresh();
    },
    onError: (err) => toast.error("Could not save settings", errorMessage(err, "Only owners and admins can change organization settings.")),
  });
  if (!org) return null;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Timezone, default transfer number, and TCPA disclaimer for this workspace." />
      <form
        className="max-w-xl space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const name = String(fd.get("name") ?? "").trim();
          if (!name) {
            toast.error("Name required", "The workspace needs a name.");
            return;
          }
          save.mutate({
            name,
            timezone: String(fd.get("timezone")),
            defaultTransferNumber: String(fd.get("defaultTransferNumber")),
            tcpaDisclaimer: String(fd.get("tcpaDisclaimer")),
          });
        }}
      >
        <div>
          <Label>Workspace name</Label>
          <Input name="name" defaultValue={org.name} />
        </div>
        <div>
          <Label>Timezone</Label>
          <Input name="timezone" defaultValue={org.timezone} />
        </div>
        <div>
          <Label>Default transfer number</Label>
          <Input name="defaultTransferNumber" defaultValue={org.defaultTransferNumber ?? ""} placeholder="+1…" />
        </div>
        <div>
          <Label>TCPA disclaimer</Label>
          <Input name="tcpaDisclaimer" defaultValue={org.tcpaDisclaimer ?? ""} placeholder="Shown on campaigns" />
        </div>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </form>
    </div>
  );
}
