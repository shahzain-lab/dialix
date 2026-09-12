import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useState } from "react";
import { Button, Card, FieldError, Input, Label, Spinner, Stepper } from "../components/ui";
import { errorMessage, useToast } from "../lib/toast";

export function LoginPage() {
  const { loading, session, refresh } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading && !session) {
    return (
      <AuthLayout title="Sign in to Dialix">
        <Spinner label="Checking session…" />
      </AuthLayout>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return (
    <AuthLayout title="Sign in to Dialix">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const res = await fetch("/api/auth/sign-in/email", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(data.message || data.error || "Email or password did not match a Dialix account.");
              return;
            }
            await refresh();
            toast.success("Signed in", "Your isolated workspace is ready.");
          } catch (err) {
            setError(errorMessage(err, "Could not reach the Dialix API. Confirm the API is running on port 3001."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </div>
        <div>
          <Label>Password</Label>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </div>
        <FieldError error={error} />
        <Button className="w-full" type="submit" loading={busy}>
          Continue
        </Button>
        <p className="text-center text-sm text-mist-400">
          No workspace yet? <Link className="text-accent" to="/signup">Create one</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { loading, session, refresh } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(window.location.search).get("invite") ?? undefined;
  if (loading && !session) {
    return (
      <AuthLayout title="Create your Dialix workspace">
        <Spinner label="Checking session…" />
      </AuthLayout>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return (
    <AuthLayout title="Create your Dialix workspace">
      <Stepper steps={["Your account", "Workspace"]} current={step} onSelect={setStep} />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (step === 0) {
            if (password.length < 8) {
              setError("Password must be at least 8 characters.");
              return;
            }
            setError(null);
            setStep(1);
            return;
          }
          setError(null);
          setBusy(true);
          try {
            const prepare = await fetch("/api/v1/signup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, email, password, organizationName, inviteToken: invite }),
            });
            const prepared = await prepare.json().catch(() => ({}));
            if (!prepare.ok) {
              setError(prepared.error || prepared.message || "Could not prepare the workspace. Check the organization name and try again.");
              return;
            }
            const res = await fetch("/api/auth/sign-up/email", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, email, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(data.message || data.error || "Could not create the account. That email may already be registered.");
              return;
            }
            const signIn = await fetch("/api/auth/sign-in/email", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            if (!signIn.ok) {
              setError("Account created, but automatic sign-in failed. Use the sign-in page.");
              return;
            }
            await refresh();
            toast.success("Workspace created", `${organizationName} is isolated from every other Dialix client.`);
          } catch (err) {
            setError(errorMessage(err, "Signup failed because the API was unreachable."));
          } finally {
            setBusy(false);
          }
        }}
      >
        {step === 0 ? (
          <>
            <div>
              <Label>Your name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
            <div>
              <Label>Password</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} required />
            </div>
          </>
        ) : (
          <div>
            <Label>Workspace name</Label>
            <Input value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required placeholder="Acme Voice" />
            {invite ? <p className="mt-2 text-xs text-mist-400">You are joining via an invite token.</p> : null}
          </div>
        )}
        <FieldError error={error} />
        <div className="flex gap-2">
          {step === 1 ? (
            <Button type="button" variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
          ) : null}
          <Button className="flex-1" type="submit" loading={busy}>
            {step === 0 ? "Continue" : "Create workspace"}
          </Button>
        </div>
        <p className="text-center text-sm text-mist-400">
          Already have access? <Link className="text-accent" to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Dialix</div>
          <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-mist-400">Isolated voice agents, credits, and calling for each client.</p>
        </div>
        {children}
      </Card>
    </div>
  );
}
