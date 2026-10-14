import { useEffect, useState } from 'react';

export type Route = 'home' | 'ai-assistant';

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => {
    const hash = window.location.hash.slice(1);
    return hash === '/ai-assistant' ? 'ai-assistant' : 'home';
  });

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      setRoute(hash === '/ai-assistant' ? 'ai-assistant' : 'home');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r === 'ai-assistant' ? '/ai-assistant' : '/';
    setRoute(r);
    window.scrollTo(0, 0);
  };

  return [route, navigate];
}
