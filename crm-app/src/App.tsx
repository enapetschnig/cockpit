import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import StatisticsPage from "./pages/StatisticsPage";
import OrderVolumePage from "./pages/OrderVolumePage";
import DmcPage from "./pages/DmcPage";
import OffersPage from "./pages/OffersPage";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import BuchhaltungPage from "./pages/BuchhaltungPage";
import BelegePage from "./pages/BelegePage";
import BelegEditor from "./pages/BelegEditor";
import KundenPage from "./pages/KundenPage";
import KassabuchPage from "./pages/KassabuchPage";
import ArchivPage from "./pages/ArchivPage";
import FirmaPage from "./pages/FirmaPage";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Index />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kennzahlen"
            element={
              <ProtectedRoute>
                <StatisticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/auftragsvolumen"
            element={
              <ProtectedRoute>
                <OrderVolumePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dmc"
            element={
              <ProtectedRoute>
                <DmcPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/angebote"
            element={
              <ProtectedRoute>
                <OffersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/auth"
            element={
              <AuthRoute>
                <Auth />
              </AuthRoute>
            }
          />
          <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
          <Route path="/buchhaltung" element={<ProtectedRoute><BuchhaltungPage /></ProtectedRoute>} />
          <Route path="/angebote-rechnung" element={<ProtectedRoute><BelegePage mode="offer" /></ProtectedRoute>} />
          <Route path="/rechnungen" element={<ProtectedRoute><BelegePage mode="invoice" /></ProtectedRoute>} />
          <Route path="/beleg/:id" element={<ProtectedRoute><BelegEditor /></ProtectedRoute>} />
          <Route path="/kunden" element={<ProtectedRoute><KundenPage /></ProtectedRoute>} />
          <Route path="/kassabuch" element={<ProtectedRoute><KassabuchPage /></ProtectedRoute>} />
          <Route path="/archiv" element={<ProtectedRoute><ArchivPage /></ProtectedRoute>} />
          <Route path="/firma" element={<ProtectedRoute><FirmaPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />

        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
