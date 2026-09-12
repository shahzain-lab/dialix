import { QueryClient, QueryClientProvider, useIsFetching } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { AppShell } from "./components/AppShell";
import { FetchBar, Spinner } from "./components/ui";
import { LoginPage, SignupPage } from "./pages/Auth";
import { OverviewPage } from "./pages/Overview";
import { AgentBuilderPage, AgentsPage } from "./pages/Agents";
import { KnowledgePage, PhoneNumbersPage, VoicesPage } from "./pages/Resources";
import { CampaignsPage, ContactsPage, ListsPage } from "./pages/Outreach";
import { CallDetailPage, CallsPage, OutboundPage } from "./pages/Calls";
import { AppointmentsPage, BillingPage, IntegrationsPage, SettingsPage, TeamPage } from "./pages/Ops";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 12_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Guard() {
  const { loading, session } = useAuth();
  if (loading && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your Dialix session…" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <AppShell />;
}

function PageFrame() {
  const fetching = useIsFetching();
  return (
    <div className="relative min-h-[calc(100vh-2rem)]">
      <FetchBar active={fetching > 0} />
      <div className="dialix-page">
        <Outlet />
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route element={<Guard />}>
                <Route element={<PageFrame />}>
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/agents/:id" element={<AgentBuilderPage />} />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route path="/voices" element={<VoicesPage />} />
                  <Route path="/phone-numbers" element={<PhoneNumbersPage />} />
                  <Route path="/contacts" element={<ContactsPage />} />
                  <Route path="/lists" element={<ListsPage />} />
                  <Route path="/campaigns" element={<CampaignsPage />} />
                  <Route path="/calls" element={<CallsPage />} />
                  <Route path="/calls/outbound" element={<OutboundPage />} />
                  <Route path="/calls/:id" element={<CallDetailPage />} />
                  <Route path="/appointments" element={<AppointmentsPage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/billing" element={<BillingPage />} />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
