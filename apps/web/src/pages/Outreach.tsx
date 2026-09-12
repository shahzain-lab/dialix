import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CAMPAIGN_REGIONS } from "@dialix/shared";
import { api, downloadBlob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import { Badge, Button, Card, ConfirmDialog, Input, Label, PageHeader, QueryPanel, Select, Stepper } from "../components/ui";

type Contact = { id: string; firstName: string | null; lastName: string | null; phone: string; email: string | null; consentAt: string | null };
type List = { id: string; name: string; memberCount: number };

export function ContactsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["contacts", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Contact[]>("/api/v1/contacts"),
  });
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", consent: true });
  const [deleteId, setDeleteId] = useState<Contact | null>(null);
  const add = useMutation({
    mutationFn: () => {
      if (!form.phone.trim()) throw new Error("Enter a phone number in E.164, for example +14155551234.");
      return api("/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          email: form.email || null,
          consentAt: form.consent ? new Date().toISOString() : null,
          consentSource: "dashboard",
        }),
      });
    },
    onSuccess: async () => {
      toast.success("Contact added", `${form.firstName || form.phone} is now in this workspace${form.consent ? " with TCPA consent" : " without consent"}.`);
      setForm({ firstName: "", lastName: "", phone: "", email: "", consent: true });
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error("Could not add the contact", errorMessage(err, "Check the phone number format.")),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/contacts/${deleteId!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Contact deleted", `${deleteId?.phone} was removed from this workspace.`);
      setDeleteId(null);
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error("Could not delete the contact", errorMessage(err, "Retry the delete.")),
  });
  const importing = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error(`${file.name} needs a header row and at least one contact.`);
      const [header, ...rest] = lines;
      const cols = header.split(",").map((c) => c.replace(/"/g, "").trim());
      if (!cols.some((c) => /phone|number/i.test(c))) {
        throw new Error("CSV must include a phone column (phone, Phone, or number).");
      }
      const rows = rest.map((line) => {
        const vals = line.split(",").map((v) => v.replace(/^"|"$/g, ""));
        return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
      });
      return api<{ imported: number; skipped: number; total: number }>("/api/v1/contacts/import", { method: "POST", body: JSON.stringify({ rows }) });
    },
    onSuccess: async (res, file) => {
      toast.success("CSV imported", `${file.name}: ${res.imported} contact(s) added, ${res.skipped} skipped.`);
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (err) => toast.error("CSV import failed", errorMessage(err, "Use a header row with a phone column.")),
  });

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Outbound campaigns require TCPA consent on each row."
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              try {
                downloadBlob(await api<Blob>("/api/v1/contacts/export"), "contacts.csv");
                toast.success("Export started", "contacts.csv is downloading.");
              } catch (err) {
                toast.error("Export failed", errorMessage(err, "Could not download contacts.csv."));
              }
            }}
          >
            Export CSV
          </Button>
        }
      />
      <Card className="mb-6 grid gap-3 p-5 md:grid-cols-5">
        <Input placeholder="First" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        <Input placeholder="Last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        <Input placeholder="+1…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Button loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
      </Card>
      <Card className="p-5">
        <Label>CSV import</Label>
        <input
          className="mt-2 text-sm"
          type="file"
          accept=".csv"
          disabled={importing.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) importing.mutate(file);
          }}
        />
        {importing.isPending ? <p className="mt-2 text-sm text-mist-400">Importing contacts…</p> : null}
      </Card>
      <div className="mt-4 space-y-2">
        <QueryPanel
          loading={isPending}
          error={error}
          empty={!data?.length}
          emptyTitle="No contacts yet"
          emptyDetail="Add a row or import a CSV with a phone column. Consent is required before campaigns can dial."
        >
          {(data ?? []).map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{c.firstName} {c.lastName}</div>
                <div className="font-mono text-sm text-mist-400">{c.phone}</div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={c.consentAt ? "good" : "bad"}>{c.consentAt ? "consented" : "no consent"}</Badge>
                <Button variant="danger" onClick={() => setDeleteId(c)}>Delete</Button>
              </div>
            </Card>
          ))}
        </QueryPanel>
      </div>
      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete this contact?"
        body={`${deleteId?.phone} will be removed from lists and cannot be dialed from this workspace.`}
        confirmLabel="Delete contact"
        loading={remove.isPending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export function ListsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: ["lists", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<List[]>("/api/v1/lists"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Contact[]>("/api/v1/contacts"),
  });
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [deleteList, setDeleteList] = useState<List | null>(null);
  const { data: members, isPending: membersPending } = useQuery({
    queryKey: ["list-members", org?.id, selected],
    enabled: Boolean(selected) && Boolean(org),
    queryFn: () => api<Contact[]>(`/api/v1/lists/${selected}/members`),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error("Give the list a name.");
      return api("/api/v1/lists", { method: "POST", body: JSON.stringify({ name }) });
    },
    onSuccess: async () => {
      toast.success("List created", `${name} is ready for campaign audiences.`);
      setName("");
      await qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (err) => toast.error("Could not create the list", errorMessage(err, "Try a different name.")),
  });
  const addMember = useMutation({
    mutationFn: (contactId: string) => api(`/api/v1/lists/${selected}/members`, { method: "POST", body: JSON.stringify({ contactIds: [contactId] }) }),
    onSuccess: async () => {
      toast.success("Contact added to list", "This audience now includes the selected contact.");
      await qc.invalidateQueries({ queryKey: ["list-members", org?.id, selected] });
      await qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (err) => toast.error("Could not add the member", errorMessage(err, "Select a contact and retry.")),
  });
  const removeMember = useMutation({
    mutationFn: (contactId: string) => api(`/api/v1/lists/${selected}/members/${contactId}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Member removed", "That contact is no longer on this list.");
      await qc.invalidateQueries({ queryKey: ["list-members", org?.id, selected] });
      await qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (err) => toast.error("Could not remove the member", errorMessage(err, "Retry the removal.")),
  });
  const removeList = useMutation({
    mutationFn: () => api(`/api/v1/lists/${deleteList!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("List deleted", `${deleteList?.name} was removed.`);
      if (selected === deleteList?.id) setSelected("");
      setDeleteList(null);
      await qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (err) => toast.error("Could not delete the list", errorMessage(err, "Retry the delete.")),
  });
  return (
    <div>
      <PageHeader title="Lists" subtitle="Reusable audiences for outbound batches." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button loading={create.isPending} onClick={() => create.mutate()}>Create</Button>
      </div>
      <QueryPanel
        loading={isPending}
        error={error}
        empty={!data?.length}
        emptyTitle="No lists yet"
        emptyDetail="Create an audience, then add consented contacts before starting a campaign."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(data ?? []).map((list) => (
            <Card key={list.id} className={`p-4 ${selected === list.id ? "border-accent/50" : ""}`}>
              <button className="w-full text-left" onClick={() => setSelected(list.id)}>
                <div className="font-medium">{list.name}</div>
                <div className="text-sm text-mist-400">{list.memberCount} contacts</div>
              </button>
              <Button className="mt-3" variant="danger" onClick={() => setDeleteList(list)}>Delete</Button>
            </Card>
          ))}
        </div>
      </QueryPanel>
      {selected ? (
        <Card className="mt-6 p-5">
          <h3 className="mb-3 font-medium">Add members</h3>
          <Select
            onChange={(e) => {
              if (!e.target.value) return;
              addMember.mutate(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Select contact</option>
            {(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.phone}</option>)}
          </Select>
          {membersPending ? <QueryPanel loading error={null}>{null}</QueryPanel> : (
            <div className="mt-4 space-y-2">
              {(members ?? []).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span>{m.firstName} {m.lastName} · {m.phone}</span>
                  <Button variant="outline" onClick={() => removeMember.mutate(m.id)}>Remove</Button>
                </div>
              ))}
              {!members?.length ? <p className="text-sm text-mist-400">This list has no members yet.</p> : null}
            </div>
          )}
        </Card>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteList)}
        title="Delete this list?"
        body={`${deleteList?.name} will no longer be available as a campaign audience. Contacts themselves are kept.`}
        confirmLabel="Delete list"
        loading={removeList.isPending}
        onCancel={() => setDeleteList(null)}
        onConfirm={() => removeList.mutate()}
      />
    </div>
  );
}

const CAMPAIGN_STEPS = ["Audience", "Caller ID", "Dialing", "Review"];

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  targetConcurrency: number;
  scheduledAt: string | null;
  recipientCount?: number;
  consentedCount?: number;
  settings?: { region?: string; ringingTimeoutSeconds?: number | null; maxCallDurationMinutes?: number | null };
};

type CampaignDetail = CampaignRow & {
  recipients?: Array<{ id: string; toNumber: string; status: string; errorMessage?: string | null }>;
  batch?: {
    status?: string;
    total_calls_scheduled?: number;
    total_calls_dispatched?: number;
    total_calls_finished?: number;
    retry_count?: number;
    recipients?: Array<{ to_number: string; status: string; error_message?: string }>;
  } | null;
};

export function CampaignsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const [step, setStep] = useState(0);
  const [cancelId, setCancelId] = useState<{ id: string; name: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["campaigns", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<CampaignRow[]>("/api/v1/campaigns"),
  });
  const { data: detail } = useQuery({
    queryKey: ["campaign", org?.id, openId],
    enabled: Boolean(org) && Boolean(openId),
    queryFn: () => api<CampaignDetail>(`/api/v1/campaigns/${openId}`),
  });
  const { data: agents } = useQuery({
    queryKey: ["agents", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string }>>("/api/v1/agents"),
  });
  const { data: numbers } = useQuery({
    queryKey: ["numbers", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; e164: string }>>("/api/v1/phone-numbers"),
  });
  const { data: lists } = useQuery({
    queryKey: ["lists", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string; memberCount?: number }>>("/api/v1/lists"),
  });
  const [form, setForm] = useState({
    name: "Outreach",
    agentId: "",
    fromNumberId: "",
    listId: "",
    targetConcurrency: "5",
    region: "US",
    scheduledAt: "",
    ringingTimeoutSeconds: "30",
    maxCallDurationMinutes: "10",
  });

  const create = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Give the campaign a name.");
      if (!form.agentId) throw new Error("Choose an agent for this campaign.");
      if (!form.fromNumberId) throw new Error("Choose a from-number before creating the campaign.");
      return api("/api/v1/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          agentId: form.agentId,
          fromNumberId: form.fromNumberId,
          listId: form.listId || null,
          targetConcurrency: Number(form.targetConcurrency),
          region: form.region,
          ringingTimeoutSeconds: Number(form.ringingTimeoutSeconds),
          maxCallDurationMinutes: Number(form.maxCallDurationMinutes),
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        }),
      });
    },
    onSuccess: async () => {
      toast.success("Campaign created", `${form.name} is ${form.scheduledAt ? "scheduled" : "in draft"}. Recipients without consent will be blocked at start.`);
      setStep(0);
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (err) => toast.error("Could not create the campaign", errorMessage(err, "Pick an agent, from-number, and list.")),
  });
  const start = useMutation({
    mutationFn: (id: string) => api(`/api/v1/campaigns/${id}/start`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Campaign started", "Cartesia is dialing consented recipients. Unconsented rows stay blocked.");
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
      await qc.invalidateQueries({ queryKey: ["campaign"] });
    },
    onError: (err) => toast.error("Could not start the campaign", errorMessage(err, "Confirm consent, credits, and Cartesia provisioning.")),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/v1/campaigns/${id}/retry`, { method: "POST" }),
    onSuccess: () => toast.success("Retry queued", "Failed recipients in the Cartesia batch will be retried."),
    onError: (err) => toast.error("Could not retry the campaign", errorMessage(err, "Start the campaign first so a batch exists.")),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${cancelId!.id}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      toast.success("Campaign canceled", `${cancelId?.name} is no longer dialing.`);
      setCancelId(null);
      await qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (err) => toast.error("Could not cancel the campaign", errorMessage(err, "Retry cancel.")),
  });

  const agentName = agents?.find((a) => a.id === form.agentId)?.name ?? "—";
  const fromE164 = numbers?.find((n) => n.id === form.fromNumberId)?.e164 ?? "—";
  const list = lists?.find((l) => l.id === form.listId);

  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Cartesia batch calling: audience, caller ID, concurrency, region, schedule, retry, and cancel. Recipients without consent are blocked." />
      <Card className="mb-6 p-4 sm:p-5">
        <Stepper steps={CAMPAIGN_STEPS} current={step} onSelect={setStep} />
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Campaign name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Audience list</Label>
              <Select value={form.listId} onChange={(e) => setForm({ ...form, listId: e.target.value })}>
                <option value="">No list yet</option>
                {(lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.memberCount != null ? ` · ${l.memberCount}` : ""}</option>)}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Schedule (optional)</Label>
              <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
              <p className="mt-1 text-xs text-mist-400">Leave empty to keep as a draft you start manually. Cartesia runs scheduled batches at this time.</p>
            </div>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Agent</Label>
              <Select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
                <option value="">Agent</option>
                {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>From number</Label>
              <Select value={form.fromNumberId} onChange={(e) => setForm({ ...form, fromNumberId: e.target.value })}>
                <option value="">From number</option>
                {(numbers ?? []).map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}
              </Select>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Region</Label>
              <Select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                {CAMPAIGN_REGIONS.map((region) => (
                  <option key={region.id} value={region.id}>{region.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Target concurrency (1–50)</Label>
              <Input type="number" min={1} max={50} value={form.targetConcurrency} onChange={(e) => setForm({ ...form, targetConcurrency: e.target.value })} />
            </div>
            <div>
              <Label>Ring timeout (seconds)</Label>
              <Input type="number" min={5} max={120} value={form.ringingTimeoutSeconds} onChange={(e) => setForm({ ...form, ringingTimeoutSeconds: e.target.value })} />
            </div>
            <div>
              <Label>Max call minutes</Label>
              <Input type="number" min={1} max={60} value={form.maxCallDurationMinutes} onChange={(e) => setForm({ ...form, maxCallDurationMinutes: e.target.value })} />
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-mist-400">Name:</span> {form.name}</p>
            <p><span className="text-mist-400">List:</span> {list?.name ?? "No list"}{list?.memberCount != null ? ` · ${list.memberCount} contacts` : ""}</p>
            <p><span className="text-mist-400">Agent:</span> {agentName}</p>
            <p><span className="text-mist-400">From:</span> {fromE164}</p>
            <p><span className="text-mist-400">Dialing:</span> {form.region} · {form.targetConcurrency} concurrent · ring {form.ringingTimeoutSeconds}s · max {form.maxCallDurationMinutes} min</p>
            <p><span className="text-mist-400">Schedule:</span> {form.scheduledAt ? new Date(form.scheduledAt).toLocaleString() : "Start manually"}</p>
            <p className="text-mist-400">You are responsible for TCPA and Cartesia Acceptable Use. Dialix will not dial contacts without consent.</p>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {step > 0 ? <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
          {step < 3 ? (
            <Button
              onClick={() => {
                if (step === 0 && !form.name.trim()) {
                  toast.error("Name required", "Give the campaign a name before continuing.");
                  return;
                }
                if (step === 1 && !form.agentId) {
                  toast.error("Agent required", "Choose an agent before continuing.");
                  return;
                }
                if (step === 1 && !form.fromNumberId) {
                  toast.error("From-number required", "Choose a caller ID before continuing.");
                  return;
                }
                setStep((s) => s + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create campaign</Button>
          )}
        </div>
      </Card>
      <QueryPanel
        loading={isPending}
        error={error}
        empty={!data?.length}
        emptyTitle="No campaigns yet"
        emptyDetail="Use the stepper above to name an audience, pick caller ID and dialing options, then create a draft campaign."
      >
        {(data ?? []).map((c) => (
          <Card key={c.id} className="mb-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button className="text-left" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                <div className="font-medium">{c.name}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone={c.status === "running" ? "good" : c.status === "canceled" ? "bad" : "warn"}>{c.status}</Badge>
                  <Badge>{c.consentedCount ?? 0}/{c.recipientCount ?? 0} consented</Badge>
                </div>
              </button>
              <div className="flex flex-wrap gap-2">
                <Button loading={start.isPending} onClick={() => start.mutate(c.id)}>Start</Button>
                <Button variant="outline" loading={retry.isPending} onClick={() => retry.mutate(c.id)}>Retry</Button>
                <Button variant="danger" onClick={() => setCancelId({ id: c.id, name: c.name })}>Cancel</Button>
              </div>
            </div>
            {openId === c.id && detail ? (
              <div className="mt-4 space-y-2 border-t border-ink-600 pt-3 text-sm">
                <p className="text-mist-400">
                  Batch {detail.batch?.status ?? "not started"}
                  {detail.batch?.total_calls_scheduled != null ? ` · ${detail.batch.total_calls_finished ?? 0}/${detail.batch.total_calls_scheduled} finished` : ""}
                  {detail.batch?.retry_count ? ` · retries ${detail.batch.retry_count}` : ""}
                </p>
                {(detail.recipients ?? []).slice(0, 12).map((row) => (
                  <div key={row.id} className="flex justify-between gap-2 font-mono text-xs">
                    <span>{row.toNumber}</span>
                    <span className="text-mist-400">{row.status}{row.errorMessage ? ` · ${row.errorMessage}` : ""}</span>
                  </div>
                ))}
                {(detail.recipients?.length ?? 0) > 12 ? <p className="text-xs text-mist-400">Showing 12 of {detail.recipients?.length} recipients.</p> : null}
              </div>
            ) : null}
          </Card>
        ))}
      </QueryPanel>
      <ConfirmDialog
        open={Boolean(cancelId)}
        title="Cancel this campaign?"
        body={`${cancelId?.name} will stop dialing remaining recipients.`}
        confirmLabel="Cancel campaign"
        loading={cancel.isPending}
        onCancel={() => setCancelId(null)}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}
