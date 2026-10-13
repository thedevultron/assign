import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/newsreader/300.css';
import '@fontsource/newsreader/300-italic.css';
import '@fontsource/roboto-mono/400.css';
import '@fontsource/roboto-mono/500.css';
import './styles/tailwind.css';
import './styles.css';
import Root from './Root.jsx';

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div className="empty">
            <div className="h2">Something <em>slipped.</em></div>
            <p className="muted" style={{ margin: 0, maxWidth: 420 }}>{String(this.state.err.message || this.state.err)}</p>
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload <span className="arr">→</span></button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<Boundary><Root /></Boundary>);
