import { useNavigate } from 'react-router';
import { useToasts } from './toast';

/** Bottom-right notices (e.g. "BIL-4 was assigned to you"); mounted once in the workspace shell. */
export default function ProjectToasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const navigate = useNavigate();
  if (!toasts.length) return null;
  return (
    <div className="pj-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pj-toast">
          <button className="pj-toast-text" onClick={() => { if (t.href) navigate(t.href); dismiss(t.id); }}>{t.text}</button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
