import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGENT_LANGUAGES, KNOWLEDGE_SOURCES, formatFaqDocument } from "@dialix/shared";
import { api, downloadBlob, fileToBase64 } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import { useVoiceCatalog } from "../lib/voices";
import { VoicePicker } from "../components/VoicePicker";
import { Badge, Button, Card, ConfirmDialog, Input, Label, PageHeader, QueryPanel, Select, Textarea } from "../components/ui";

type Folder = { id: string; name: string; parentId: string | null; isRoot: boolean };
type Doc = { id: string; name: string; folderId: string; content: string | null; metadata?: Record<string, unknown> };
type SourceId = (typeof KNOWLEDGE_SOURCES)[number]["id"];

const TEXT_TYPES = ".txt,.md,.csv,.json,.html,.htm";

async function readTextFiles(files: FileList | File[]) {
  const allowed = new Set(["txt", "md", "csv", "json", "html", "htm"]);
  const rows: Array<{ name: string; text: string }> = [];
  const skipped: string[] = [];
  for (const file of Array.from(files)) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.has(ext)) {
      skipped.push(file.name);
      continue;
    }
    rows.push({ name: file.name, text: await file.text() });
  }
  return { rows, skipped };
}

export function KnowledgePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const { data: folders, isPending, error } = useQuery({
    queryKey: ["folders", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Folder[]>("/api/v1/knowledge/folders"),
  });
  const [folderId, setFolderId] = useState<string>("");
  const [deleteDoc, setDeleteDoc] = useState<Doc | null>(null);
  const selected = folderId || folders?.find((f) => f.isRoot)?.id || folders?.[0]?.id;
  const { data: docs, isPending: docsPending } = useQuery({
    queryKey: ["docs", org?.id, selected],
    enabled: Boolean(selected) && Boolean(org),
    queryFn: () => api<Doc[]>(`/api/v1/knowledge/documents?folderId=${selected}`),
  });
  const [source, setSource] = useState<SourceId>("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [folderName, setFolderName] = useState("");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [faqs, setFaqs] = useState([{ q: "", a: "" }]);
  const sourceMeta = KNOWLEDGE_SOURCES.find((item) => item.id === source)!;
  const metadata = useMemo(() => {
    const extra: Record<string, string> = {};
    if (category.trim()) extra.category = category.trim();
    if (audience.trim()) extra.audience = audience.trim();
    return extra;
  }, [category, audience]);

  const createFolder = useMutation({
    mutationFn: () => {
      if (!folderName.trim()) throw new Error("Give the folder a name before creating it.");
      return api("/api/v1/knowledge/folders", { method: "POST", body: JSON.stringify({ name: folderName, parentId: selected }) });
    },
    onSuccess: async () => {
      toast.success("Folder created", `${folderName} is ready to hold documents in this workspace.`);
      setFolderName("");
      await qc.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (err) => toast.error("Could not create the folder", errorMessage(err, "Try a different folder name.")),
  });

  const createDoc = useMutation({
    mutationFn: async (payload?: { files?: Array<{ name: string; text: string }> }) => {
      if (!selected) throw new Error("Select a knowledge folder first.");
      const files = payload?.files;
      if (source === "faq") {
        const text = formatFaqDocument(faqs);
        if (!text) throw new Error("Add at least one question and answer.");
        return api("/api/v1/knowledge/documents/upload", {
          method: "POST",
          body: JSON.stringify({ folderId: selected, name: name || "FAQ", content: text, sourceType: "faq", metadata }),
        });
      }
      if (files?.length) {
        return api("/api/v1/knowledge/documents/upload", {
          method: "POST",
          body: JSON.stringify({ folderId: selected, files, sourceType: source, metadata }),
        });
      }
      if (!name.trim()) throw new Error("Give the document a name.");
      if (!content.trim()) throw new Error("Paste document content before saving.");
      return api("/api/v1/knowledge/documents/upload", {
        method: "POST",
        body: JSON.stringify({ folderId: selected, name, content, sourceType: source, metadata }),
      });
    },
    onSuccess: async (res) => {
      const uploaded = typeof res === "object" && res && "uploaded" in res ? Number((res as { uploaded?: number }).uploaded ?? 1) : 1;
      toast.success(uploaded > 1 ? "Documents uploaded" : "Document saved", `${uploaded} item(s) indexed for agents that attach this folder.`);
      setName("");
      setContent("");
      setFaqs([{ q: "", a: "" }]);
      await qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: (err) => toast.error("Could not save the document", errorMessage(err, "Check the folder and try again.")),
  });

  const removeDoc = useMutation({
    mutationFn: () => api(`/api/v1/knowledge/documents/${deleteDoc!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Document deleted", `${deleteDoc?.name} was removed from this workspace.`);
      setDeleteDoc(null);
      await qc.invalidateQueries({ queryKey: ["docs"] });
    },
    onError: (err) => toast.error("Could not delete the document", errorMessage(err, "Retry the delete.")),
  });

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const { rows, skipped } = await readTextFiles(list);
    if (skipped.length) toast.error("Unsupported files skipped", `${skipped.join(", ")}. Cartesia indexes text, Markdown, CSV, JSON, and HTML (max 1 MB). Paste PDF text instead.`);
    if (!rows.length) return;
    createDoc.mutate({ files: rows });
  }

  return (
    <div>
      <PageHeader title="Knowledge" subtitle="Cartesia indexes pasted text and files in this org’s folders. Attach folders on the agent Tools step so the agent can retrieve them on calls." />
      <QueryPanel loading={isPending} error={error}>
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <Card className="p-4">
            <Label>Folders</Label>
            <div className="mt-2 space-y-1">
              {(folders ?? []).map((f) => (
                <button key={f.id} onClick={() => setFolderId(f.id)} className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm ${selected === f.id ? "bg-ink-700" : "hover:bg-ink-700/50"}`}>
                  {f.name}
                  {f.isRoot ? <span className="ml-2 text-xs text-mist-400">root</span> : null}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Input placeholder="New nested folder" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
              <Button variant="outline" className="w-full" loading={createFolder.isPending} onClick={() => createFolder.mutate()}>
                Add folder
              </Button>
            </div>
          </Card>
          <div className="space-y-4">
            <Card className="space-y-4 p-4 sm:p-5">
              <div>
                <Label>Upload type</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {KNOWLEDGE_SOURCES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSource(item.id)}
                      className={`rounded-xl border px-3 py-3 text-left ${source === item.id ? "border-accent/70 bg-accent/10" : "border-ink-600 hover:border-ink-500"}`}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-1 text-xs text-mist-400">{item.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
              {source !== "file" && source !== "bulk" ? (
                <Input placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
              ) : null}
              {source === "faq" ? (
                <div className="space-y-3">
                  {faqs.map((row, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-2">
                      <Input placeholder={`Question ${i + 1}`} value={row.q} onChange={(e) => setFaqs((rows) => rows.map((r, idx) => (idx === i ? { ...r, q: e.target.value } : r)))} />
                      <Input placeholder="Answer" value={row.a} onChange={(e) => setFaqs((rows) => rows.map((r, idx) => (idx === i ? { ...r, a: e.target.value } : r)))} />
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => setFaqs((rows) => [...rows, { q: "", a: "" }])}>Add Q&A</Button>
                </div>
              ) : source === "file" || source === "bulk" ? (
                <div>
                  <Label>{source === "bulk" ? "Bulk files" : "Text file"}</Label>
                  <input
                    className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:text-mist-100"
                    type="file"
                    accept={TEXT_TYPES}
                    multiple={source === "bulk"}
                    disabled={createDoc.isPending}
                    onChange={(e) => {
                      const files = e.target.files;
                      e.target.value = "";
                      void onFiles(files);
                    }}
                  />
                  <p className="mt-2 text-xs text-mist-400">{sourceMeta.hint}</p>
                </div>
              ) : (
                <Textarea
                  placeholder={source === "script" ? "Opening line, objections, close…" : source === "policy" ? "Hours, returns, compliance language…" : "Paste text Cartesia should retrieve on the call…"}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Metadata · category</Label>
                  <Input placeholder="policy, billing, product…" value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <div>
                  <Label>Metadata · audience</Label>
                  <Input placeholder="customer, staff…" value={audience} onChange={(e) => setAudience(e.target.value)} />
                </div>
              </div>
              {source !== "file" && source !== "bulk" ? (
                <Button loading={createDoc.isPending} onClick={() => createDoc.mutate({})} disabled={!selected}>
                  Save to folder
                </Button>
              ) : null}
            </Card>
            {docsPending ? <QueryPanel loading error={null}>{null}</QueryPanel> : null}
            {!docsPending && !docs?.length ? (
              <p className="text-sm text-mist-400">No documents in this folder yet. Choose an upload type above.</p>
            ) : null}
            {(docs ?? []).map((doc) => (
              <Card key={doc.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{doc.name}</div>
                    {doc.metadata && Object.keys(doc.metadata).length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(doc.metadata).map(([key, value]) => (
                          <Badge key={key}>{key}: {String(value)}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          const blob = await api<Blob>(`/api/v1/knowledge/documents/${doc.id}/download`);
                          downloadBlob(blob, doc.name);
                          toast.success("Download started", `${doc.name} is saving to your computer.`);
                        } catch (err) {
                          toast.error("Download failed", errorMessage(err, "Could not fetch the document file."));
                        }
                      }}
                    >
                      Download
                    </Button>
                    <Button variant="danger" onClick={() => setDeleteDoc(doc)}>Delete</Button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-4 text-sm text-mist-400">{doc.content}</p>
              </Card>
            ))}
          </div>
        </div>
      </QueryPanel>
      <ConfirmDialog
        open={Boolean(deleteDoc)}
        title="Delete this document?"
        body={`${deleteDoc?.name} will be removed from this folder and from Cartesia retrieval.`}
        confirmLabel="Delete document"
        loading={removeDoc.isPending}
        onCancel={() => setDeleteDoc(null)}
        onConfirm={() => removeDoc.mutate()}
      />
    </div>
  );
}

export function VoicesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { org } = useAuth();
  const [confirmId, setConfirmId] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [gender, setGender] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [cloneName, setCloneName] = useState("Custom voice");
  const [cloneLanguage, setCloneLanguage] = useState("en");
  const catalog = useVoiceCatalog({ search, language, gender });
  const { data: agents } = useQuery({
    queryKey: ["agents", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string; voiceId: string }>>("/api/v1/agents"),
  });
  const selected = catalog.voices.find((v) => v.id === selectedId);
  const clone = useMutation({
    mutationFn: async (file: File) => {
      if (!cloneName.trim()) throw new Error("Give the cloned voice a name.");
      const audioBase64 = await fileToBase64(file);
      return api("/api/v1/voices/clone", { method: "POST", body: JSON.stringify({ name: cloneName, language: cloneLanguage, audioBase64, filename: file.name }) });
    },
    onSuccess: async () => {
      toast.success("Voice cloned", `${cloneName} is now available in this workspace.`);
      await qc.invalidateQueries({ queryKey: ["voices"] });
    },
    onError: (err) => toast.error("Could not clone the voice", errorMessage(err, "Cartesia must be configured and the file must be audio.")),
  });
  const apply = useMutation({
    mutationFn: (agentId: string) => api(`/api/v1/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ voiceId: selectedId }) }),
    onSuccess: async (_row, agentId) => {
      const agent = agents?.find((a) => a.id === agentId);
      toast.success("Voice assigned", `${selected?.name ?? "Voice"} is now used by ${agent?.name ?? "the agent"}. Preview it on the agent page.`);
      await qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (err) => toast.error("Could not assign the voice", errorMessage(err, "Save failed. The agent may need a full save first.")),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/voices/${confirmId!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Voice deleted", `${confirmId?.name} was removed from this workspace.`);
      setConfirmId(null);
      await qc.invalidateQueries({ queryKey: ["voices"] });
    },
    onError: (err) => toast.error("Could not delete the voice", errorMessage(err, "Retry the delete.")),
  });
  return (
    <div>
      <PageHeader
        title="Voices"
        subtitle="Every public Cartesia library voice plus clones owned by this workspace. Preview, then assign to a calling agent."
      />
      <Card className="mb-6 space-y-3 p-4 sm:p-5">
        <h3 className="font-medium">Clone from audio</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="Voice name" />
          <Select value={cloneLanguage} onChange={(e) => setCloneLanguage(e.target.value)}>
            {AGENT_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>{lang.label}</option>
            ))}
          </Select>
        </div>
        <input
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:text-mist-100"
          type="file"
          accept="audio/*"
          disabled={clone.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) clone.mutate(file);
          }}
        />
        {clone.isPending ? <p className="text-sm text-mist-400">Uploading and cloning {cloneName}…</p> : null}
      </Card>
      {selected ? (
        <Card className="mb-6 space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-mist-400">Selected for calling agents</div>
              <div className="font-medium">{selected.name}</div>
            </div>
            <Button onClick={() => nav(`/agents/new?voiceId=${encodeURIComponent(selected.id)}`)}>New agent with this voice</Button>
          </div>
          {(agents ?? []).length ? (
            <div>
              <Label>Apply to existing agent</Label>
              <Select
                onChange={(e) => {
                  if (!e.target.value) return;
                  apply.mutate(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="">Choose agent</option>
                {(agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </Select>
            </div>
          ) : (
            <p className="text-sm text-mist-400">No agents yet. Create one to use this voice on live calls.</p>
          )}
        </Card>
      ) : null}
      <QueryPanel
        loading={catalog.isPending}
        error={catalog.error as Error | null}
        empty={!catalog.voices.length}
        emptyTitle={catalog.configured ? "No voices match" : "Cartesia is not connected"}
        emptyDetail={catalog.configured ? "Try another search or language filter." : "Add CARTESIA_API_KEY to list the public Cartesia library and clone voices."}
      >
        <p className="mb-3 text-sm text-mist-400">{catalog.voices.length} voice{catalog.voices.length === 1 ? "" : "s"} loaded{catalog.hasNextPage ? " · more available" : ""}.</p>
        {catalog.cloned.length ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {catalog.cloned.map((voice) => (
              <Badge key={voice.id}>
                {voice.name}
                <button className="ml-2 text-rose-300" onClick={() => setConfirmId({ id: voice.id, name: voice.name })}>remove</button>
              </Badge>
            ))}
          </div>
        ) : null}
        <VoicePicker
          voices={catalog.voices}
          selectedId={selectedId}
          onSelect={(voice) => setSelectedId(voice.id)}
          search={search}
          onSearch={setSearch}
          language={language}
          onLanguage={setLanguage}
          gender={gender}
          onGender={setGender}
          hasMore={catalog.hasNextPage}
          loadingMore={catalog.isFetchingNextPage}
          onLoadMore={() => catalog.fetchNextPage()}
        />
        {catalog.hasNextPage ? (
          <Button
            className="mt-3 w-full"
            variant="outline"
            loading={catalog.isFetchingNextPage}
            onClick={async () => {
              let more = true;
              while (more) {
                const next = await catalog.fetchNextPage();
                more = Boolean(next.hasNextPage);
              }
            }}
          >
            Load remaining Cartesia voices
          </Button>
        ) : null}
      </QueryPanel>
      <ConfirmDialog
        open={Boolean(confirmId)}
        title="Delete this cloned voice?"
        body={`${confirmId?.name} will be removed from Cartesia and this workspace.`}
        confirmLabel="Delete voice"
        loading={remove.isPending}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

export function PhoneNumbersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { org } = useAuth();
  const { data: numbers, isPending, error } = useQuery({
    queryKey: ["numbers", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; e164: string; label: string; kind: string; agentId: string | null }>>("/api/v1/phone-numbers"),
  });
  const { data: agents } = useQuery({
    queryKey: ["agents", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; name: string }>>("/api/v1/agents"),
  });
  const { data: providers } = useQuery({
    queryKey: ["providers", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<Array<{ id: string; label: string; kind: string }>>("/api/v1/telephony-providers"),
  });
  const [label, setLabel] = useState("Support line");
  const [releaseId, setReleaseId] = useState<{ id: string; e164: string } | null>(null);
  const [twilio, setTwilio] = useState({ accountSid: "", apiKeySid: "", apiKeySecret: "", label: "Twilio" });
  const [sip, setSip] = useState({ label: "Primary trunk", outboundAddress: "", outboundTransport: "tls" });
  const [imp, setImp] = useState({ label: "Imported", number: "", providerId: "" });

  const provision = useMutation({
    mutationFn: () => {
      if (!label.trim()) throw new Error("Give the number a label, for example Support line.");
      return api("/api/v1/phone-numbers/provision", { method: "POST", body: JSON.stringify({ label }) });
    },
    onSuccess: async () => {
      toast.success("Number provisioned", `${label} is now in this workspace.`);
      await qc.invalidateQueries({ queryKey: ["numbers"] });
    },
    onError: (err) => toast.error("Could not provision a number", errorMessage(err, "Cartesia must be configured and have available slots.")),
  });
  const connectTwilio = useMutation({
    mutationFn: () => {
      if (!twilio.accountSid || !twilio.apiKeySid || !twilio.apiKeySecret) {
        throw new Error("Enter the Twilio Account SID, API key SID, and API key secret.");
      }
      return api("/api/v1/telephony-providers/twilio", { method: "POST", body: JSON.stringify(twilio) });
    },
    onSuccess: async () => {
      toast.success("Twilio connected", `${twilio.label} can now import existing numbers.`);
      await qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err) => toast.error("Could not connect Twilio", errorMessage(err, "Check the SID and API key values.")),
  });
  const registerSip = useMutation({
    mutationFn: () => {
      if (!sip.outboundAddress.trim()) throw new Error("Enter the SIP outbound address, for example sip.example.com.");
      return api("/api/v1/telephony-providers/sip", { method: "POST", body: JSON.stringify(sip) });
    },
    onSuccess: async () => {
      toast.success("SIP trunk registered", `${sip.label} is ready for number import.`);
      await qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (err) => toast.error("Could not register the SIP trunk", errorMessage(err, "Check the outbound address and transport.")),
  });
  const importNumber = useMutation({
    mutationFn: () => {
      if (!imp.providerId) throw new Error("Select a Twilio or SIP provider first.");
      if (!imp.number.trim()) throw new Error("Enter the number to import in E.164, for example +14155551234.");
      return api("/api/v1/phone-numbers/import", { method: "POST", body: JSON.stringify(imp) });
    },
    onSuccess: async () => {
      toast.success("Number imported", `${imp.number} is now assigned to this workspace.`);
      await qc.invalidateQueries({ queryKey: ["numbers"] });
    },
    onError: (err) => toast.error("Could not import the number", errorMessage(err, "Check the provider and E.164 format.")),
  });
  const assign = useMutation({
    mutationFn: ({ id, agentId }: { id: string; agentId: string | null }) =>
      api(`/api/v1/phone-numbers/${id}`, { method: "PATCH", body: JSON.stringify({ agentId }) }),
    onSuccess: async (_row, vars) => {
      const agentName = agents?.find((a) => a.id === vars.agentId)?.name;
      toast.success("Inbound routing updated", agentName ? `${agentName} now answers this number.` : "This number no longer has an inbound agent.");
      await qc.invalidateQueries({ queryKey: ["numbers"] });
    },
    onError: (err) => toast.error("Could not assign the agent", errorMessage(err, "Retry the assignment.")),
  });
  const release = useMutation({
    mutationFn: () => api(`/api/v1/phone-numbers/${releaseId!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Number released", `${releaseId?.e164} is no longer in this workspace.`);
      setReleaseId(null);
      await qc.invalidateQueries({ queryKey: ["numbers"] });
    },
    onError: (err) => toast.error("Could not release the number", errorMessage(err, "Retry the release.")),
  });

  return (
    <div>
      <PageHeader title="Phone numbers" subtitle="Provision Cartesia US numbers, import Twilio, or connect SIP for an existing phone system." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5">
          <h3 className="font-medium">Cartesia number</h3>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button loading={provision.isPending} onClick={() => provision.mutate()}>Provision</Button>
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-medium">Twilio account</h3>
          <Input placeholder="Account SID" value={twilio.accountSid} onChange={(e) => setTwilio({ ...twilio, accountSid: e.target.value })} />
          <Input placeholder="API key SID" value={twilio.apiKeySid} onChange={(e) => setTwilio({ ...twilio, apiKeySid: e.target.value })} />
          <Input placeholder="API key secret" type="password" value={twilio.apiKeySecret} onChange={(e) => setTwilio({ ...twilio, apiKeySecret: e.target.value })} />
          <Button variant="outline" loading={connectTwilio.isPending} onClick={() => connectTwilio.mutate()}>Connect Twilio</Button>
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="font-medium">SIP trunk</h3>
          <Input placeholder="sip.example.com" value={sip.outboundAddress} onChange={(e) => setSip({ ...sip, outboundAddress: e.target.value })} />
          <Button variant="outline" loading={registerSip.isPending} onClick={() => registerSip.mutate()}>Register trunk</Button>
        </Card>
      </div>
      <Card className="mt-4 space-y-3 p-5">
        <h3 className="font-medium">Import existing number</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={imp.providerId} onChange={(e) => setImp({ ...imp, providerId: e.target.value })}>
            <option value="">Provider</option>
            {(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <Input placeholder="+14155551234" value={imp.number} onChange={(e) => setImp({ ...imp, number: e.target.value })} />
          <Button loading={importNumber.isPending} onClick={() => importNumber.mutate()}>Import</Button>
        </div>
      </Card>
      <div className="mt-6 space-y-3">
        <QueryPanel
          loading={isPending}
          error={error}
          empty={!numbers?.length}
          emptyTitle="No phone numbers yet"
          emptyDetail="Provision a Cartesia number or import Twilio/SIP after connecting a provider."
        >
          {(numbers ?? []).map((n) => (
            <Card key={n.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono">{n.e164}</div>
                <div className="text-sm text-mist-400">{n.label} · {n.kind}</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={n.agentId ?? ""} onChange={(e) => assign.mutate({ id: n.id, agentId: e.target.value || null })}>
                  <option value="">No inbound agent</option>
                  {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
                <Button variant="danger" onClick={() => setReleaseId({ id: n.id, e164: n.e164 })}>Release</Button>
              </div>
            </Card>
          ))}
        </QueryPanel>
      </div>
      <ConfirmDialog
        open={Boolean(releaseId)}
        title="Release this number?"
        body={`${releaseId?.e164} will stop routing inbound calls in this workspace.`}
        confirmLabel="Release number"
        loading={release.isPending}
        onCancel={() => setReleaseId(null)}
        onConfirm={() => release.mutate()}
      />
    </div>
  );
}
