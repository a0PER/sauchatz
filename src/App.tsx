import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { PresenceProvider } from './contexts/PresenceContext';
import { ChatProvider } from './contexts/ChatContext';
import { isConfigured } from './lib/supabase';
import { Button, Logo, Spinner } from './components/ui';
import { ForgotPasswordPage, ResetPasswordPage, SetupNeeded, SignInPage, SignUpPage } from './pages/AuthPages';
import AppShell from './pages/AppShell';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import PeoplePage from './pages/PeoplePage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <Logo size={44} />
      <Spinner />
    </div>
  );
}

function ProfileMissing() {
  const { refreshProfile, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo size={40} />
      <p className="max-w-sm text-sm text-muted">We could not load your profile. Check your connection, or make sure the database schema has been installed.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => refreshProfile()}>Try again</Button>
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function Gate() {
  const { session, profile, loading, recoveryMode } = useAuth();

  if (!isConfigured) return <SetupNeeded />;
  if (loading) return <Splash />;
  if (recoveryMode && session) return <ResetPasswordPage />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!profile) return <ProfileMissing />;

  return (
    <PresenceProvider>
      <ChatProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="c/:id" element={<ChatPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="u/:id" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ChatProvider>
    </PresenceProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
