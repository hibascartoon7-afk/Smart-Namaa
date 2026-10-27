import { useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import EnvironmentBar from './components/EnvironmentBar';
import FieldMap from './components/FieldMap';
import Dashboard from './components/Dashboard';
import Advisories from './components/Advisories';
import Savings from './components/Savings';
import Footer from './components/Footer';
import Architecture from './components/Architecture';
import AuthModal from './components/AuthModal';
import AIAssistantPage from './components/AIAssistantPage';
import { useAuth } from '@/lib/auth';
import { useHashRoute } from '@/lib/router';
import type { Persona } from '@/types';

export default function App() {
  const [authOpen, setAuthOpen] = useState(false);
  const { user } = useAuth();
  const [{ route, persona }, navigate] = useHashRoute();
  const [pendingPersona, setPendingPersona] = useState<Persona | null>(null);

  const handleAsk = (p: Persona) => {
    if (!user) {
      setPendingPersona(p);
      setAuthOpen(true);
    } else {
      navigate('ai-assistant', p);
    }
  };

  // Right after signing in from the home page, bring the user to "My environments".
  useEffect(() => {
    if (user && !pendingPersona && route === 'home') {
      document.getElementById('environments')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a successful sign-in, continue to the chat the user asked for.
  useEffect(() => {
    if (user && pendingPersona) {
      setAuthOpen(false);
      navigate('ai-assistant', pendingPersona);
      setPendingPersona(null);
    }
  }, [user, pendingPersona]); // eslint-disable-line react-hooks/exhaustive-deps

  if (route === 'ai-assistant') {
    if (!user) {
      return (
        <div className="min-h-screen grid place-items-center bg-cream-100">
          <div className="text-center max-w-sm px-6">
            <p className="font-display text-xl font-semibold text-forest-700 mb-2">Sign in required</p>
            <p className="text-sm text-forest-700/60 mb-6">Please sign in to use the AI Smart Irrigation Assistant.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setAuthOpen(true)} className="btn-primary">Sign in</button>
              <button onClick={() => navigate('home')} className="btn-ghost">Back home</button>
            </div>
          </div>
          {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
        </div>
      );
    }
    return <AIAssistantPage key={persona} initialPersona={persona} onNavigateHome={() => navigate('home')} />;
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <Navbar onAsk={handleAsk} onAuthClick={() => setAuthOpen(true)} />
      <main>
        <Hero onAsk={handleAsk} />
        <EnvironmentBar onAuthClick={() => setAuthOpen(true)} />
        <Architecture />
        <FieldMap />
        <Dashboard />
        <Advisories />
        <Savings />
      </main>
      <Footer />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
