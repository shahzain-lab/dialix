import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { APPOINTMENT_SETTER_GREETING, APPOINTMENT_SETTER_INSTRUCTIONS, SUPPORT_GREETING, SUPPORT_INSTRUCTIONS } from "@dialix/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  PageHeader,
  QueryPanel,
  Select,
  Stepper,
  Textarea,
} from "../components/ui";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  initialMessage: string | null;
  modelId: string;
  language: string;
  voiceId: string;
  noiseSuppression: string;
  maxCallDurationMinutes: number;
  template: string;
  cartesiaAgentId: string | null;
  keyterms?: string[];
  transferRules?: Array<{ destination: string; type: "phone" | "sip_uri"; condition: string }>;
  knowledgeFolderIds?: string[];
};

const STEPS = ["Identity", "Voice", "Knowledge & tools", "Review"];

export function AgentsPage() {
  const { org } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agents", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Agent[]>("/api/v1/agents"),
  });
  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Managed Cartesia agents that stay inside this workspace."
        actions={
          <Link to="/agents/new">
            <Button>New agent</Button>
          </Link>
        }
      />
      <QueryPanel
        loading={isLoading}
        error={error}
        empty={!data?.length}
        emptyTitle="No agents yet"
        emptyDetail="Create an appointment setter or support agent. It will be namespaced to this organization."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(data ?? []).map((agent) => (
            <Link key={agent.id} to={`/agents/${agent.id}`}>
              <Card className="p-5 transition hover:border-accent/40">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-medium">{agent.name}</div>
                    <div className="text-sm text-mist-400">{agent.description || agent.template}</div>
                  </div>
                  <Badge tone={agent.cartesiaAgentId ? "good" : "warn"}>{agent.cartesiaAgentId ? "synced to Cartesia" : "saved locally"}</Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </QueryPanel>
    </div>
  );
}

export function AgentBuilderPage() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const [step, setStep] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(
    isNew
      ? {
          template: "appointment_setter",
          instructions: APPOINTMENT_SETTER_INSTRUCTIONS,
          initialMessage: APPOINTMENT_SETTER_GREETING,
        }
      : {},
  );
  const [folderIds, setFolderIds] = useState<string[] | null>(null);
  const [keyterms, setKeyterms] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Agent["transferRules"] | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["agent", org?.id, id],
    enabled: !isNew && Boolean(id) && Boolean(org),
    queryFn: () => api<Agent>(`/api/v1/agents/${id}`),
  });
  const { data: voices } = useQuery({
    queryKey: ["voices", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<{ library: Array<{ id: string; name?: string }>; cloned: Array<{ cartesiaVoiceId: string; name: string }> }>("/api/v1/voices"),
  });
  const { data: folders } = useQuery({
    queryKey: ["folders", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string; isRoot?: boolean }>>("/api/v1/knowledge/folders"),
  });

  const library = useMemo(
    () => [...(voices?.library ?? []), ...(voices?.cloned ?? []).map((v) => ({ id: v.cartesiaVoiceId, name: v.name }))],
    [voices],
  );
  const merged = {
    name: form.name ?? existing?.name ?? "",
    description: form.description ?? existing?.description ?? "",
    template: form.template ?? existing?.template ?? "appointment_setter",
    instructions: form.instructions ?? existing?.instructions ?? "",
    initialMessage: form.initialMessage ?? existing?.initialMessage ?? "",
    modelId: form.modelId ?? existing?.modelId ?? "gpt-5.4-mini",
    language: form.language ?? existing?.language ?? "en",
    voiceId: form.voiceId ?? existing?.voiceId ?? library[0]?.id ?? "e07c00bc-4134-4eae-9ea4-1a55fb45746b",
    noiseSuppression: form.noiseSuppression ?? existing?.noiseSuppression ?? "auto",
    maxCallDurationMinutes: form.maxCallDurationMinutes ?? String(existing?.maxCallDurationMinutes ?? 10),
  };
  const selectedFolders = folderIds ?? existing?.knowledgeFolderIds ?? [];
  const keytermList = (keyterms ?? (existing?.keyterms ?? []).join(", "));
  const transferRules = transfers ?? existing?.transferRules ?? [];

  function applyTemplate(template: string) {
    if (template === "appointment_setter") {
      setForm((f) => ({ ...f, template, instructions: APPOINTMENT_SETTER_INSTRUCTIONS, initialMessage: APPOINTMENT_SETTER_GREETING }));
    } else if (template === "support") {
      setForm((f) => ({ ...f, template, instructions: SUPPORT_INSTRUCTIONS, initialMessage: SUPPORT_GREETING }));
    } else {
      setForm((f) => ({ ...f, template }));
    }
  }

  const save = useMutation({
    mutationFn: () => {
      if (!merged.name.trim()) throw new Error("Give the agent a name before saving.");
      if (!merged.instructions.trim()) throw new Error("Instructions cannot be empty. Pick a template or write the prompt.");
      const cleanedTransfers = transferRules.filter((rule) => rule.destination.trim() && rule.condition.trim());
      return api<{ id: string }>(isNew ? "/api/v1/agents" : `/api/v1/agents/${id}`, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify({
          ...merged,
          maxCallDurationMinutes: Number(merged.maxCallDurationMinutes),
          keyterms: keytermList.split(",").map((s) => s.trim()).filter(Boolean),
          transferRules: cleanedTransfers,
          knowledgeFolderIds: selectedFolders,
        }),
      });
    },
    onSuccess: async (row) => {
      toast.success(isNew ? "Agent created" : "Agent updated", `${merged.name} is saved for ${org?.name}.`);
      await qc.invalidateQueries({ queryKey: ["agents"] });
      nav(`/agents/${row.id ?? id}`);
    },
    onError: (err) => toast.error("Could not save the agent", errorMessage(err, "Check the form and Cartesia configuration.")),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/v1/agents/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(false);
      toast.success("Agent deleted", `${merged.name || "The agent"} was removed from this workspace.`);
      await qc.invalidateQueries({ queryKey: ["agents"] });
      nav("/agents");
    },
    onError: (err) => toast.error("Could not delete the agent", errorMessage(err, "Try again.")),
  });

  const preview = useMutation({
    mutationFn: () => api<{ token: string | null; agentId: string | null; configured: boolean }>(`/api/v1/agents/${id}/preview-token`, { method: "POST" }),
    onSuccess: (data) => {
      if (data.configured && data.token) toast.success("Preview token issued", "Use this short-lived token for an in-dashboard WebSocket test call.");
      else if (data.configured) toast.info("Cartesia is connected", "No scoped browser token was returned. Live phone tests still work from Calls.");
      else toast.info("Saved locally only", "Add CARTESIA_API_KEY to enable live preview calls.");
    },
    onError: (err) => toast.error("Preview failed", errorMessage(err, "Save the agent first, then retry.")),
  });

  if (!isNew && isLoading) {
    return <QueryPanel loading error={null}>{null}</QueryPanel>;
  }

  return (
    <div>
      <PageHeader title={isNew ? "New agent" : merged.name || "Agent"} subtitle="Four steps: identity, voice, knowledge, then save." />
      <Stepper steps={STEPS} current={step} onSelect={setStep} />
      <Card className="space-y-4 p-6">
        {step === 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={merged.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Template</Label>
                <Select value={merged.template} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="blank">Blank</option>
                  <option value="appointment_setter">Appointment setter</option>
                  <option value="support">Support</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={merged.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Instructions</Label>
              <Textarea value={merged.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
            </div>
            <div>
              <Label>Greeting</Label>
              <Input value={merged.initialMessage} onChange={(e) => setForm((f) => ({ ...f, initialMessage: e.target.value }))} />
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Voice</Label>
              <Select value={merged.voiceId} onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))}>
                {library.length ? library.map((v) => <option key={v.id} value={v.id}>{v.name || v.id}</option>) : <option value={merged.voiceId}>Default voice</option>}
              </Select>
            </div>
            <div>
              <Label>Language</Label>
              <Input value={merged.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} />
            </div>
            <div>
              <Label>Noise suppression</Label>
              <Select value={merged.noiseSuppression} onChange={(e) => setForm((f) => ({ ...f, noiseSuppression: e.target.value }))}>
                <option value="off">Off</option>
                <option value="auto">Auto</option>
                <option value="max">Max</option>
              </Select>
            </div>
            <div>
              <Label>Max call minutes</Label>
              <Input type="number" min={1} max={60} value={merged.maxCallDurationMinutes} onChange={(e) => setForm((f) => ({ ...f, maxCallDurationMinutes: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Keyterms (comma separated)</Label>
              <Input value={keytermList} onChange={(e) => setKeyterms(e.target.value)} placeholder="Acme, ProGrip" />
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <>
            <div>
              <Label>Attach knowledge folders</Label>
              <div className="mt-2 space-y-2">
                {(folders ?? []).map((folder) => (
                  <label key={folder.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedFolders.includes(folder.id)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selectedFolders, folder.id]
                          : selectedFolders.filter((x) => x !== folder.id);
                        setFolderIds(next);
                      }}
                    />
                    {folder.name}
                  </label>
                ))}
                {!folders?.length ? <p className="text-sm text-mist-400">No folders yet. Create them on the Knowledge page, then return here.</p> : null}
              </div>
            </div>
            <div>
              <Label>Warm transfer destinations</Label>
              {(transferRules ?? []).map((rule, i) => (
                <div key={i} className="mt-2 grid gap-2 md:grid-cols-3">
                  <Input value={rule.destination} placeholder="+1…" onChange={(e) => {
                    const next = [...transferRules];
                    next[i] = { ...rule, destination: e.target.value };
                    setTransfers(next);
                  }} />
                  <Input value={rule.condition} placeholder="When to transfer" onChange={(e) => {
                    const next = [...transferRules];
                    next[i] = { ...rule, condition: e.target.value };
                    setTransfers(next);
                  }} />
                  <Button variant="outline" onClick={() => setTransfers(transferRules.filter((_, idx) => idx !== i))}>Remove</Button>
                </div>
              ))}
              <Button className="mt-3" variant="outline" onClick={() => setTransfers([...(transferRules ?? []), { destination: "", type: "phone", condition: "Caller asks for a human." }])}>
                Add transfer
              </Button>
            </div>
          </>
        ) : null}
        {step === 3 ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-mist-400">Name:</span> {merged.name || "—"}</p>
            <p><span className="text-mist-400">Template:</span> {merged.template}</p>
            <p><span className="text-mist-400">Voice:</span> {merged.voiceId}</p>
            <p><span className="text-mist-400">Knowledge folders:</span> {selectedFolders.length}</p>
            <p><span className="text-mist-400">Transfers:</span> {transferRules.length}</p>
            {!isNew && existing?.cartesiaAgentId ? <Badge tone="good">Will PATCH Cartesia agent {existing.cartesiaAgentId}</Badge> : <Badge tone="warn">Will create locally; Cartesia sync needs CARTESIA_API_KEY</Badge>}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {step > 0 ? <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
          {step < 3 ? (
            <Button
              onClick={() => {
                if (step === 0 && !merged.name.trim()) {
                  toast.error("Name required", "Give the agent a name before continuing.");
                  return;
                }
                if (step === 0 && !merged.instructions.trim()) {
                  toast.error("Instructions required", "Pick a template or write the prompt before continuing.");
                  return;
                }
                setStep((s) => s + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {isNew ? "Create agent" : "Save changes"}
            </Button>
          )}
          {!isNew ? <Button variant="outline" loading={preview.isPending} onClick={() => preview.mutate()}>Issue preview token</Button> : null}
          {!isNew ? <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button> : null}
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this agent?"
        body="Inbound numbers assigned to it will stop routing. This cannot be undone."
        confirmLabel="Delete agent"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
