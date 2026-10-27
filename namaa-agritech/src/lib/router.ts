import { useEffect, useState } from 'react';
import type { Persona } from '@/types';

export type Route = 'home' | 'ai-assistant';

interface RouteState {
  route: Route;
  persona: Persona;
}

function parseHash(): RouteState {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('/ai-assistant')) {
    return { route: 'ai-assistant', persona: hash.endsWith('/nada') ? 'nada' : 'ghaith' };
  }
  return { route: 'home', persona: 'ghaith' };
}

export function useHashRoute(): [RouteState, (r: Route, persona?: Persona) => void] {
  const [state, setState] = useState<RouteState>(parseHash);

  useEffect(() => {
    const onHashChange = () => setState(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (r: Route, persona: Persona = 'ghaith') => {
    window.location.hash = r === 'ai-assistant' ? `/ai-assistant/${persona}` : '/';
    setState({ route: r, persona });
    window.scrollTo(0, 0);
  };

  return [state, navigate];
}
