import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, downloadBlob, fileToBase64 } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, useToast } from "../lib/toast";
import { Button, Card, ConfirmDialog, Input, Label, PageHeader, QueryPanel, Select, Textarea } from "../components/ui";

type Folder = { id: string; name: string; parentId: string | null; isRoot: boolean };
type Doc = { id: string; name: string; folderId: string; content: string | null };

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
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [folderName, setFolderName] = useState("");

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
    mutationFn: () => {
      if (!selected) throw new Error("Select a knowledge folder first.");
      if (!name.trim()) throw new Error("Give the document a name.");
      if (!content.trim()) throw new Error("Paste document content before saving.");
      return api("/api/v1/knowledge/documents", { method: "POST", body: JSON.stringify({ folderId: selected, name, content }) });
    },
    onSuccess: async () => {
      toast.success("Document saved", `${name} is attached to this folder and will be used by agents that include it.`);
      setName("");
      setContent("");
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

  return (
    <div>
      <PageHeader title="Knowledge" subtitle="Documents stay in this org’s Cartesia folders and are never listed across tenants." />
      <QueryPanel loading={isPending} error={error}>
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <Card className="p-4">
            <Label>Folders</Label>
            <div className="mt-2 space-y-1">
              {(folders ?? []).map((f) => (
                <button key={f.id} onClick={() => setFolderId(f.id)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${selected === f.id ? "bg-ink-700" : "hover:bg-ink-700/50"}`}>
                  {f.name}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Input placeholder="New folder" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
              <Button variant="outline" className="w-full" loading={createFolder.isPending} onClick={() => createFolder.mutate()}>
                Add folder
              </Button>
            </div>
          </Card>
          <div className="space-y-4">
            <Card className="space-y-3 p-5">
              <Label>Upload / create document</Label>
              <Input placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea placeholder="Paste text, FAQs, scripts, policies…" value={content} onChange={(e) => setContent(e.target.value)} />
              <Button loading={createDoc.isPending} onClick={() => createDoc.mutate()} disabled={!selected}>
                Save document
              </Button>
            </Card>
            {docsPending ? <QueryPanel loading error={null}>{null}</QueryPanel> : null}
            {!docsPending && !docs?.length ? (
              <p className="text-sm text-mist-400">No documents in this folder yet. Paste a script or FAQ above.</p>
            ) : null}
            {(docs ?? []).map((doc) => (
              <Card key={doc.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{doc.name}</div>
                  <div className="flex gap-2">
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
                    <Button variant="danger" onClick={() => setDeleteDoc(doc)}>
                      Delete
                    </Button>
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
  const { org } = useAuth();
  const [confirmId, setConfirmId] = useState<{ id: string; name: string } | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["voices", org?.id],
    enabled: Boolean(org),
    queryFn: () => api<{ library: Array<{ id: string; name?: string; language?: string }>; cloned: Array<{ id: string; name: string; cartesiaVoiceId: string }> }>("/api/v1/voices"),
  });
  const [name, setName] = useState("Custom voice");
  const clone = useMutation({
    mutationFn: async (file: File) => {
      if (!name.trim()) throw new Error("Give the cloned voice a name.");
      const audioBase64 = await fileToBase64(file);
      return api("/api/v1/voices/clone", { method: "POST", body: JSON.stringify({ name, audioBase64, filename: file.name }) });
    },
    onSuccess: async () => {
      toast.success("Voice cloned", `${name} is now available in this workspace.`);
      await qc.invalidateQueries({ queryKey: ["voices"] });
    },
    onError: (err) => toast.error("Could not clone the voice", errorMessage(err, "Cartesia must be configured and the file must be audio.")),
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
      <PageHeader title="Voices" subtitle="Cartesia library voices plus clones owned by this workspace." />
      <Card className="mb-6 space-y-3 p-5">
        <Label>Clone from audio</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="file"
          accept="audio/*"
          disabled={clone.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) clone.mutate(file);
          }}
        />
        {clone.isPending ? <p className="text-sm text-mist-400">Uploading and cloning {name}…</p> : null}
      </Card>
      <QueryPanel
        loading={isPending}
        error={error}
        empty={!data?.library?.length && !data?.cloned?.length}
        emptyTitle="No voices yet"
        emptyDetail="Library voices appear when CARTESIA_API_KEY is set. You can still clone after that."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.library ?? []).slice(0, 24).map((v) => (
            <Card key={v.id} className="p-4">
              <div className="font-medium">{v.name || v.id}</div>
              <div className="font-mono text-xs text-mist-400">{v.id}</div>
            </Card>
          ))}
          {(data?.cloned ?? []).map((v) => (
            <Card key={v.id} className="p-4">
              <div className="flex justify-between">
                <div>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-mist-400">cloned</div>
                </div>
                <Button variant="danger" onClick={() => setConfirmId({ id: v.id, name: v.name })}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
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
            <Card key={n.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-mono">{n.e164}</div>
                <div className="text-sm text-mist-400">{n.label} · {n.kind}</div>
              </div>
              <div className="flex gap-2">
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
