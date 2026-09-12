import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AGENT_EMOTIONS,
  AGENT_LANGUAGES,
  APPOINTMENT_SETTER_GREETING,
  APPOINTMENT_SETTER_INSTRUCTIONS,
  NOISE_SUPPRESSION,
  SUPPORT_GREETING,
  SUPPORT_INSTRUCTIONS,
} from "@dialix/shared";
import { api, playApiAudio } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import { useVoiceCatalog } from "../lib/voices";
import { VoicePicker } from "../components/VoicePicker";
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
  speed?: string | null;
  volume?: string | null;
  emotion?: string | null;
  noiseSuppression: string;
  maxCallDurationMinutes: number;
  template: string;
  cartesiaAgentId: string | null;
  keyterms?: string[];
  transferRules?: Array<{ destination: string; type: "phone" | "sip_uri"; condition: string }>;
  knowledgeFolderIds?: string[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
  waitForCaller?: boolean;
  enableEndCall?: boolean;
  enableDtmf?: boolean;
};

const STEPS = ["Identity", "Voice", "Model", "Tools", "Review"];

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
        subtitle="Configure Cartesia managed agents, preview the voice, then attach knowledge and telephony tools."
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
        emptyDetail="Create an appointment setter or support agent. It stays namespaced to this organization."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {(data ?? []).map((agent) => (
            <Link key={agent.id} to={`/agents/${agent.id}`}>
              <Card className="p-5 transition hover:border-accent/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-medium">{agent.name}</div>
                    <div className="truncate text-sm text-mist-400">{agent.description || agent.template}</div>
                  </div>
                  <Badge tone={agent.cartesiaAgentId ? "good" : "warn"}>{agent.cartesiaAgentId ? "synced" : "local"}</Badge>
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
  const [params] = useSearchParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const [step, setStep] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceLang, setVoiceLang] = useState("");
  const [voiceGender, setVoiceGender] = useState("");
  const presetVoice = params.get("voiceId") ?? "";
  const [form, setForm] = useState<Record<string, string>>(
    isNew
      ? {
          template: "appointment_setter",
          instructions: APPOINTMENT_SETTER_INSTRUCTIONS,
          initialMessage: APPOINTMENT_SETTER_GREETING,
          speed: "1",
          volume: "1",
          temperature: "0.3",
          maxOutputTokens: "1024",
          ...(presetVoice ? { voiceId: presetVoice } : {}),
        }
      : presetVoice
        ? { voiceId: presetVoice }
        : {},
  );
  const [folderIds, setFolderIds] = useState<string[] | null>(null);
  const [keyterms, setKeyterms] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Agent["transferRules"] | null>(null);
  const [flags, setFlags] = useState<{ waitForCaller?: boolean; enableEndCall?: boolean; enableDtmf?: boolean }>({});

  const { data: existing, isLoading } = useQuery({
    queryKey: ["agent", org?.id, id],
    enabled: !isNew && Boolean(id) && Boolean(org),
    queryFn: () => api<Agent>(`/api/v1/agents/${id}`),
  });
  const voiceQuery = useVoiceCatalog({ search: voiceSearch, language: voiceLang, gender: voiceGender });
  const library = voiceQuery.voices;
  const { data: folders } = useQuery({
    queryKey: ["folders", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string; isRoot?: boolean }>>("/api/v1/knowledge/folders"),
  });
  const { data: models } = useQuery({
    queryKey: ["agent-models", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<{ models: Array<{ id: string; name?: string; provider?: string }> }>("/api/v1/agents/models"),
  });

  const merged = {
    name: form.name ?? existing?.name ?? "",
    description: form.description ?? existing?.description ?? "",
    template: form.template ?? existing?.template ?? "appointment_setter",
    instructions: form.instructions ?? existing?.instructions ?? "",
    initialMessage: form.initialMessage ?? existing?.initialMessage ?? "",
    modelId: form.modelId ?? existing?.modelId ?? "gpt-5.4-mini",
    language: form.language ?? existing?.language ?? "en",
    voiceId: form.voiceId ?? existing?.voiceId ?? library[0]?.id ?? "",
    speed: form.speed ?? existing?.speed ?? "1",
    volume: form.volume ?? existing?.volume ?? "1",
    emotion: form.emotion ?? existing?.emotion ?? "",
    noiseSuppression: form.noiseSuppression ?? existing?.noiseSuppression ?? "auto",
    maxCallDurationMinutes: form.maxCallDurationMinutes ?? String(existing?.maxCallDurationMinutes ?? 10),
    temperature: form.temperature ?? String(existing?.temperature ?? 0.3),
    maxOutputTokens: form.maxOutputTokens ?? String(existing?.maxOutputTokens ?? 1024),
  };
  const selectedFolders = folderIds ?? existing?.knowledgeFolderIds ?? [];
  const keytermList = keyterms ?? (existing?.keyterms ?? []).join(", ");
  const transferRules = transfers ?? existing?.transferRules ?? [];
  const waitForCaller = flags.waitForCaller ?? existing?.waitForCaller ?? false;
  const enableEndCall = flags.enableEndCall ?? existing?.enableEndCall ?? true;
  const enableDtmf = flags.enableDtmf ?? existing?.enableDtmf ?? false;
  const selectedVoice = library.find((v) => v.id === merged.voiceId);

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
      if (!merged.voiceId) throw new Error("Select a Cartesia voice so callers can hear the agent.");
      const cleanedTransfers = transferRules.filter((rule) => rule.destination.trim() && rule.condition.trim());
      return api<{ id: string }>(isNew ? "/api/v1/agents" : `/api/v1/agents/${id}`, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify({
          ...merged,
          speed: Number(merged.speed),
          volume: Number(merged.volume),
          emotion: merged.emotion || null,
          temperature: Number(merged.temperature),
          maxOutputTokens: Number(merged.maxOutputTokens),
          maxCallDurationMinutes: Number(merged.maxCallDurationMinutes),
          waitForCaller,
          enableEndCall,
          enableDtmf,
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

  const previewGreeting = useMutation({
    mutationFn: () =>
      playApiAudio("/api/v1/voices/preview", {
        method: "POST",
        body: JSON.stringify({
          voiceId: merged.voiceId,
          text: waitForCaller ? "I'll wait for the caller to speak first." : merged.initialMessage || "Hi, thanks for calling.",
          language: merged.language,
          speed: Number(merged.speed),
          volume: Number(merged.volume),
          emotion: merged.emotion || null,
        }),
      }),
    onError: (err) => toast.error("Could not preview speech", errorMessage(err, "Select a voice and connect Cartesia.")),
  });

  const previewCall = useMutation({
    mutationFn: () => api<{ token: string | null; agentId: string | null; configured: boolean }>(`/api/v1/agents/${id}/preview-token`, { method: "POST" }),
    onSuccess: (data) => {
      if (data.configured && data.token) toast.success("Live preview ready", "A short-lived Cartesia token was issued for an in-dashboard test.");
      else if (data.configured) toast.info("Cartesia is connected", "Place a live test from Calls if the browser token is unavailable.");
      else toast.info("Saved locally only", "Add CARTESIA_API_KEY to enable live preview calls.");
    },
    onError: (err) => toast.error("Preview failed", errorMessage(err, "Save the agent first, then retry.")),
  });

  if (!isNew && isLoading) {
    return <QueryPanel loading error={null}>{null}</QueryPanel>;
  }

  return (
    <div>
      <PageHeader title={isNew ? "New agent" : merged.name || "Agent"} subtitle="Voice, model, knowledge, and telephony tools map 1:1 to Cartesia managed agent config." />
      <Stepper steps={STEPS} current={step} onSelect={setStep} />
      <Card className="space-y-4 p-4 sm:p-6">
        {step === 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={waitForCaller} onChange={(e) => setFlags((f) => ({ ...f, waitForCaller: e.target.checked }))} />
              Wait for the caller to speak first (no greeting)
            </label>
            {!waitForCaller ? (
              <div>
                <Label>Greeting</Label>
                <Input value={merged.initialMessage} onChange={(e) => setForm((f) => ({ ...f, initialMessage: e.target.value }))} />
              </div>
            ) : null}
          </>
        ) : null}
        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-sm text-mist-400">
              {selectedVoice ? `Selected: ${selectedVoice.name}` : "Pick a Cartesia library voice or a clone from this workspace, then preview how it will speak."}
              {" "}
              <Link className="text-accent" to="/voices">Browse full catalog</Link>
            </p>
            <VoicePicker
              voices={library}
              selectedId={merged.voiceId}
              onSelect={(voice) => setForm((f) => ({ ...f, voiceId: voice.id }))}
              search={voiceSearch}
              onSearch={setVoiceSearch}
              language={voiceLang}
              onLanguage={setVoiceLang}
              gender={voiceGender}
              onGender={setVoiceGender}
              hasMore={voiceQuery.hasNextPage}
              loadingMore={voiceQuery.isFetchingNextPage}
              onLoadMore={() => voiceQuery.fetchNextPage()}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Speed ({merged.speed}x)</Label>
                <input type="range" min={0.6} max={1.5} step={0.05} value={merged.speed} onChange={(e) => setForm((f) => ({ ...f, speed: e.target.value }))} className="w-full accent-accent" />
              </div>
              <div>
                <Label>Volume ({merged.volume}x)</Label>
                <input type="range" min={0.5} max={2} step={0.05} value={merged.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} className="w-full accent-accent" />
              </div>
              <div>
                <Label>Emotion</Label>
                <Select value={merged.emotion} onChange={(e) => setForm((f) => ({ ...f, emotion: e.target.value }))}>
                  <option value="">Voice default</option>
                  {AGENT_EMOTIONS.map((emotion) => (
                    <option key={emotion} value={emotion}>{emotion}</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="outline" className="w-full" loading={previewGreeting.isPending} onClick={() => previewGreeting.mutate()} disabled={!merged.voiceId}>
                  Preview greeting
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Language</Label>
              <Select value={merged.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}>
                {AGENT_LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>{lang.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>LLM</Label>
              <Select value={merged.modelId} onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}>
                {(models?.models?.length ? models.models : [{ id: "gpt-5.4-mini", name: "GPT-5.4 mini" }]).map((model) => (
                  <option key={model.id} value={model.id}>{model.name || model.id}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Temperature ({merged.temperature})</Label>
              <input type="range" min={0} max={1} step={0.05} value={merged.temperature} onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))} className="w-full accent-accent" />
            </div>
            <div>
              <Label>Max output tokens</Label>
              <Input type="number" min={1} max={4096} value={merged.maxOutputTokens} onChange={(e) => setForm((f) => ({ ...f, maxOutputTokens: e.target.value }))} />
            </div>
            <div>
              <Label>Noise suppression</Label>
              <Select value={merged.noiseSuppression} onChange={(e) => setForm((f) => ({ ...f, noiseSuppression: e.target.value }))}>
                {NOISE_SUPPRESSION.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label} — {opt.hint}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Max call minutes</Label>
              <Input type="number" min={1} max={60} value={merged.maxCallDurationMinutes} onChange={(e) => setForm((f) => ({ ...f, maxCallDurationMinutes: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Label>Keyterms (comma separated)</Label>
              <Input value={keytermList} onChange={(e) => setKeyterms(e.target.value)} placeholder="Acme, ProGrip" />
              <p className="mt-1 text-xs text-mist-400">Helps Ink transcribe brand names. This is recognition, not pronunciation.</p>
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <>
            <div>
              <Label>Attach knowledge folders</Label>
              <div className="mt-2 space-y-2">
                {(folders ?? []).map((folder) => (
                  <label key={folder.id} className="flex min-h-11 items-center gap-2 text-sm">
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
                {!folders?.length ? <p className="text-sm text-mist-400">No folders yet. Create them on Knowledge, then return here.</p> : null}
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={enableEndCall} onChange={(e) => setFlags((f) => ({ ...f, enableEndCall: e.target.checked }))} />
                Allow the agent to hang up (system tool: end_call)
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={enableDtmf} onChange={(e) => setFlags((f) => ({ ...f, enableDtmf: e.target.checked }))} />
                Allow DTMF / keypad tones (system tool: send_dtmf)
              </label>
            </div>
            <div>
              <Label>Warm transfer destinations</Label>
              {(transferRules ?? []).map((rule, i) => (
                <div key={i} className="mt-2 grid gap-2 sm:grid-cols-4">
                  <Select value={rule.type} onChange={(e) => {
                    const next = [...transferRules];
                    next[i] = { ...rule, type: e.target.value as "phone" | "sip_uri" };
                    setTransfers(next);
                  }}>
                    <option value="phone">Phone</option>
                    <option value="sip_uri">SIP URI</option>
                  </Select>
                  <Input value={rule.destination} placeholder={rule.type === "sip_uri" ? "sip:…" : "+1…"} onChange={(e) => {
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
        {step === 4 ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-mist-400">Name:</span> {merged.name || "—"}</p>
            <p><span className="text-mist-400">Voice:</span> {selectedVoice?.name || merged.voiceId || "—"}</p>
            <p><span className="text-mist-400">Model:</span> {merged.modelId} · {merged.language}</p>
            <p><span className="text-mist-400">Audio:</span> speed {merged.speed}x · volume {merged.volume}x · {merged.emotion || "default emotion"}</p>
            <p><span className="text-mist-400">Knowledge folders:</span> {selectedFolders.length}</p>
            <p><span className="text-mist-400">Transfers:</span> {transferRules.length} · end call {enableEndCall ? "on" : "off"} · DTMF {enableDtmf ? "on" : "off"}</p>
            {!isNew && existing?.cartesiaAgentId ? <Badge tone="good">Will PATCH Cartesia agent {existing.cartesiaAgentId}</Badge> : <Badge tone="warn">Will create locally; Cartesia sync needs CARTESIA_API_KEY</Badge>}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {step > 0 ? <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
          {step < 4 ? (
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
                if (step === 1 && !merged.voiceId) {
                  toast.error("Voice required", "Select a Cartesia voice before continuing.");
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
          <Button variant="outline" loading={previewGreeting.isPending} onClick={() => previewGreeting.mutate()} disabled={!merged.voiceId}>
            Preview voice
          </Button>
          {!isNew ? <Button variant="outline" loading={previewCall.isPending} onClick={() => previewCall.mutate()}>Live preview token</Button> : null}
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
