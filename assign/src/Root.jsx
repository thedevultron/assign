import { useEffect, useState, lazy, Suspense } from 'react';
import { useStore } from './lib/store.js';
import { LogoMark, Spinner, Button, KanbanLoader } from './components/ui.jsx';
import ClickSpark from './components/reactbits/ClickSpark';

const Landing = lazy(() => import('./pages/Landing.jsx'));
const Auth = lazy(() => import('./pages/Auth.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const App = lazy(() => import('./App.jsx'));
const Docs = lazy(() => import('./pages/Docs.jsx'));
const Terms = lazy(() => import('./pages/Terms.jsx'));

export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts, query, path: '/' + parts.join('/') };
}

function useHash() {
  const [h, setH] = useState(() => parseHash());
  useEffect(() => {
    const on = () => setH(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export const go = (path) => { if (location.hash !== '#' + path) location.hash = path; };

export function Splash({ label }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0f1011' }}>
      <div className="col" style={{ alignItems: 'center', gap: 18 }}>
        <KanbanLoader label={label || 'Loading'} />
      </div>
    </div>
  );
}

const PUBLIC = new Set(['', 'home', 'login', 'signup', 'docs', 'terms']);

export default function Root() {
  const auth = useStore((s) => s.auth);
  const checkSession = useStore((s) => s.checkSession);
  const route = useHash();
  const head = route.parts[0] || '';

  useEffect(() => { checkSession(); }, [checkSession]);

  // Authed users are NEVER forced into onboarding or bounced between auth pages.
  useEffect(() => {
    if (auth.status === 'checking') return;
    if (auth.status === 'anon') {
      if (!PUBLIC.has(head)) go(`/login?next=${encodeURIComponent(route.path)}`);
      return;
    }
    if (auth.status !== 'authed') return;
    if (head === 'login' || head === 'signup') {
      // already signed in → go to the app (or where they meant to go). No forms ever again.
      go(route.query.next && route.query.next !== route.path && !['login', 'signup'].includes(route.query.next?.split('/')[1] || '') ? route.query.next : '/');
    }
    // setup is done but the URL still points at the wizard (stale hash, back button) → leave it
    if (head === 'onboarding' && auth.workspace?.onboarded) go('/');
  }, [auth.status, head]); // eslint-disable-line

  // landing scrolls the window; the app owns its own scroll containers
  const appMode = auth.status === 'authed' && !['home', 'login', 'signup', 'onboarding', 'docs', 'terms'].includes(head);
  useEffect(() => { document.body.classList.toggle('app-mode', !!appMode); }, [appMode]);

  let view;
  if (auth.status === 'checking') view = <Splash />;
  else if (auth.status === 'offline') {
    view = (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="empty"><div className="h2">Can’t reach <em>assign.</em></div><p className="muted" style={{ margin: 0 }}>The server didn’t answer. It may be restarting.</p><Button onClick={checkSession}>Try again</Button></div>
      </div>
    );
  } else if (head === 'docs') view = <Docs section={route.path.split('/').filter(Boolean)[1]} />;
  else if (head === 'terms') view = <Terms />;
  else if (head === 'home' || (head === '' && auth.status === 'anon')) view = <Landing />;
  else if (auth.status === 'anon') view = head === 'login' || head === 'signup' ? <Auth mode={head} query={route.query} /> : <Splash />;
  else if (head === 'onboarding') view = <Onboarding />;
  else if (head === 'login' || head === 'signup') view = <Splash />;
  else view = <App route={route} />;

  return (
    <ClickSpark sparkColor="#ffffff" sparkSize={7} sparkRadius={16} sparkCount={7} duration={420}>
      <Suspense fallback={<Splash />}>{view}</Suspense>
    </ClickSpark>
  );
}
