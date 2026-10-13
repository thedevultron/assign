import { useEffect } from 'react';
import { motion } from 'motion/react';
import { LogoMark, EASE } from '../components/ui.jsx';

const SECTIONS = [
  ['Acceptance of these terms', [
    'By creating an account, accessing, or using assign (“the Service”) you agree to these Terms of Service. If you use the Service on behalf of an organisation, you represent that you have authority to bind it, and “you” refers to that organisation.',
    'If you do not agree, do not use the Service. We may update these terms; continued use after a change is published on this page constitutes acceptance.',
  ]],
  ['The Service', [
    'assign is a project board that lets you delegate work to AI coding agents. Agents connect over the Model Context Protocol (MCP), claim tasks you approve or schedule, and hand results back for your review.',
    'The Service includes a built-in AI assistant that can read and write workspace data at your direction, by text chat or real-time voice.',
  ]],
  ['Accounts and security', [
    'You must provide a valid email address and keep your credentials confidential. You are responsible for all activity under your account and under any agent token you issue.',
    'Agent tokens and pairing codes are secrets. Treat them like passwords: do not commit them to public repositories, and rotate them immediately if they leak. You can revoke a token at any time from the agent’s Connect panel.',
    'Sessions are bearer tokens stored in your browser. Sign out on shared devices.',
  ]],
  ['AI features and your provider keys', [
    'The assistant can use third-party AI providers (Google, OpenAI, Anthropic, OpenRouter, Groq, xAI, Mistral, DeepSeek). You supply your own API keys in Settings → AI.',
    'Keys you paste are stored encrypted on the server and are never returned to any client. They are used solely to fulfil requests you initiate. Your use of third-party AI models is additionally governed by that provider’s terms and acceptable-use policies, and their consumption is billed by them, not by the Service.',
    'Actions the assistant considers risky — deleting tasks or agents, moving work to Done, rotating tokens, changing workspace settings — require your explicit confirmation before they execute. You may turn confirmations off; you then accept sole responsibility for what the assistant does.',
    'AI output can be wrong. Review agent work and assistant actions before shipping them. Do not use the Service for decisions that legally require a human.',
  ]],
  ['Voice sessions', [
    'Voice sessions stream microphone audio from your browser to the AI provider you configured, in real time, using an ephemeral token. Audio is not recorded or stored by the Service itself; the provider’s own data terms apply.',
    'You are responsible for complying with call-recording and consent laws that apply to you and to anyone captured by the microphone.',
  ]],
  ['Agents act in your environment', [
    'Coding agents run on machines you control, with credentials you give them, against code you own. The Service routes instructions; it does not execute code. You are solely responsible for what your agents read, write, build, and deploy.',
  ]],
  ['Acceptable use', [
    'You may not use the Service to: break any law; infringe intellectual-property or privacy rights; distribute malware; probe, overload, or disrupt the Service or others’ systems; mine credentials; or have agents act on systems you are not authorised to modify.',
    'We may suspend accounts that abuse the Service, attack other users, or generate disproportionate load.',
  ]],
  ['Your data', [
    'You own your workspace data — tasks, agents, comments, activity. We claim no intellectual-property rights over it. Exported workspace archives contain your data in open formats.',
    'If you self-host, your data never leaves your own infrastructure. If the Service is hosted for you, data is stored on the host’s volume until you delete it or delete the workspace from Settings.',
    'You can export everything, or permanently delete the workspace, at any time from Settings → Data. Deletion is irreversible.',
  ]],
  ['Termination', [
    'You may stop using the Service and delete your workspace at any time. These terms survive where their nature requires (ownership, disclaimers, liability).',
  ]],
  ['Disclaimers and liability', [
    'THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE, OR ANY AI MODEL OR AGENT, WILL BE ACCURATE, UNINTERRUPTED, OR ERROR-FREE.',
    'TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL assign, ITS DEVELOPERS, OR ITS CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES — INCLUDING LOST PROFITS, LOST DATA, OR DAMAGE CAUSED BY AI AGENTS OR AI OUTPUT — ARISING FROM YOUR USE OF THE SERVICE. OUR AGGREGATE LIABILITY WILL NOT EXCEED THE GREATER OF US $100 OR THE AMOUNT YOU PAID FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM.',
  ]],
  ['Indemnity', [
    'You agree to indemnify and hold harmless the Service’s operators from claims arising from your content, your agents’ actions, your violation of these terms, or your violation of any law or third-party right.',
  ]],
  ['Miscellaneous', [
    'If any provision is found unenforceable, the remainder stays in force. Failure to enforce a term is not a waiver. These terms are the entire agreement between you and the Service about its subject matter.',
    'Contact: open an issue in the project repository, or email the address shown on the landing page.',
  ]],
];

export default function Terms() {
  useEffect(() => { window.scrollTo(0, 0); document.title = 'Terms of Service — assign'; return () => { document.title = 'assign — the board your coding agents work from'; }; }, []);
  return (
    <div className="docs terms">
      <header className="d-nav">
        <div className="d-nav-in">
          <a href="#/home" className="wordmark"><LogoMark size={22} />assign</a>
          <span className="row" style={{ gap: 10 }}><a className="link small" href="#/docs">Docs</a><a className="link small" href="#/login">Sign in</a></span>
        </div>
      </header>
      <main className="d-main terms-main">
        <motion.div className="d-hero" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, ease: EASE }}>
          <span className="label">Legal</span>
          <h1 className="display" style={{ margin: 0 }}>Terms of <em>Service.</em></h1>
          <p className="lede" style={{ margin: 0 }}>Last updated October 11, 2026. The short version: assign routes your instructions to AI agents; you stay in charge of what they do, you keep your data, and the Service comes with no warranty.</p>
        </motion.div>
        {SECTIONS.map(([title, paras], i) => (
          <motion.section key={title} className="terms-sec" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.7, ease: EASE }}>
            <h2 className="h2" style={{ margin: 0 }}><span className="terms-num">{String(i + 1).padStart(2, '0')}</span>{title}</h2>
            {paras.map((p, j) => <p key={j} className={/[A-Z ]{40,}/.test(p.slice(0, 40)) ? 'terms-caps' : ''}>{p}</p>)}
          </motion.section>
        ))}
        <div className="terms-foot row">
          <a className="link" href="#/home">← Back to assign</a>
          <span className="label">© {new Date().getFullYear()} assign · built by Amir Bagawan</span>
        </div>
      </main>
    </div>
  );
}
