import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import heroImg from '../assets/hero-clouds.jpg';
import Icon from '../components/Icon.jsx';
import { Button, LogoMark, Field, EASE, smooth } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { guessTimezone } from '../lib/helpers.js';

export default function Auth({ mode, query }) {
  const signup = useStore((s) => s.signup);
  const login = useStore((s) => s.login);
  const isSignup = mode === 'signup';
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = (() => { try { return sessionStorage.getItem('assign:pending_task') || ''; } catch { return ''; } })();
  useEffect(() => { setErr(''); }, [mode]);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (isSignup && !f.name.trim()) return setErr('What should we call you?');
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Enter a valid email address');
    if (f.password.length < (isSignup ? 8 : 1)) return setErr(isSignup ? 'Use at least 8 characters for your password' : 'Enter your password');
    setBusy(true);
    try {
      if (isSignup) await signup({ ...f, timezone: guessTimezone(), pending_task: pending || undefined });
      else await login({ email: f.email, password: f.password });
      // Root redirects — signup goes to onboarding once, login goes straight to the app
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const strength = Math.min(4, [f.password.length >= 8, /[A-Z]/.test(f.password) && /[a-z]/.test(f.password), /\d/.test(f.password), /[^A-Za-z0-9]/.test(f.password) || f.password.length >= 14].filter(Boolean).length);

  return (
    <div className="auth">
      <aside className="auth-side">
        <img className="bg" src={heroImg} alt="" />
        <a href="#/" className="wordmark"><LogoMark size={24} />assign</a>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 2.5, ease: EASE }} style={{ maxWidth: 460 }}>
          <div className="h1" style={{ fontSize: 64 }}>{isSignup ? <>A board for your <em>agents.</em></> : <>Welcome <em>back.</em></>}</div>
          <p className="lede" style={{ color: 'rgba(245,245,247,.75)', marginTop: 18 }}>Claude Code, Cursor, Codex and friends — each pulling its own tasks over MCP, never stepping on each other.</p>
        </motion.div>
        <span className="label" style={{ color: 'rgba(245,245,247,.6)' }}>Model Context Protocol · 2025-06-18</span>
      </aside>
      <main className="auth-main">
        <div className="row"><a href="#/" className="btn btn-quiet btn-sm"><Icon name="left" size={16} />Home</a></div>
        <AnimatePresence mode="wait">
          <motion.form key={mode} className="auth-card" onSubmit={submit} noValidate initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={smooth}>
            <div className="col" style={{ gap: 12 }}>
              <span className="label">{isSignup ? 'Step 1 of 7 · Account' : 'Sign in'}</span>
              <h1 className="h2" style={{ fontSize: 44 }}>{isSignup ? <>Create your <em>workspace.</em></> : <>Sign in to <em>assign.</em></>}</h1>
            </div>
            {isSignup && pending ? (
              <div className="infobox"><Icon name="sparkles" size={16} style={{ flex: 'none', marginTop: 2 }} /><span>Your first task is saved: <span className="head">“{pending}”</span>. We’ll add it once you’re set up.</span></div>
            ) : null}
            {query?.next && !isSignup ? <div className="infobox"><Icon name="lock" size={16} style={{ flex: 'none', marginTop: 2 }} />Sign in to continue.</div> : null}
            {isSignup && <Field label="Your name"><input className="input lg" autoComplete="name" value={f.name} onChange={set('name')} placeholder="Ada Lovelace" autoFocus /></Field>}
            <Field label="Email"><input className="input lg" type="email" autoComplete="email" value={f.email} onChange={set('email')} placeholder="you@company.com" autoFocus={!isSignup} /></Field>
            <Field label="Password" right={!isSignup ? null : <span className="row" style={{ gap: 3 }}>{[0, 1, 2, 3].map((i) => <i key={i} style={{ width: 14, height: 2, borderRadius: 2, background: i < strength ? '#fff' : 'rgba(255,255,255,.15)', transition: 'background .2s ease' }} />)}</span>}>
              <div style={{ position: 'relative' }}>
                <input className="input lg" type={show ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} placeholder={isSignup ? 'At least 8 characters' : '••••••••'} style={{ paddingRight: 48 }} />
                <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 10, top: 11 }}><Icon name={show ? 'eyeOff' : 'eye'} size={16} /></button>
              </div>
            </Field>
            <AnimatePresence>{err ? <motion.div className="err" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{err}</motion.div> : null}</AnimatePresence>
            <Button type="submit" size="lg" block loading={busy}>{isSignup ? 'Create account' : 'Sign in'}</Button>
            {isSignup ? <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>By creating an account you agree to the <a className="link" href="#/terms">Terms of Service</a>.</p> : null}
            <p className="small muted center" style={{ margin: 0 }}>
              {isSignup ? <>Already have an account? <a className="link" href={`#/login`}>Sign in</a></> : <>New to assign? <a className="link" href="#/signup">Create a workspace</a></>}
            </p>
          </motion.form>
        </AnimatePresence>
      </main>
    </div>
  );
}
