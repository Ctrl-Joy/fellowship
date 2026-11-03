import { useState } from 'react';
import type { User } from '../../types';
import { Modal } from '../../components/Modal';
import { api } from '../../api';
import { useSession } from '../../store/session';

export interface StatusEditorProps {
  currentUser: User;
  onClose(): void;
}

/** Custom status editor modal. Core stub (emoji + text, no expiry UI) — owned by `presence`. */
export default function StatusEditor({ currentUser, onClose }: StatusEditorProps) {
  const [emoji, setEmoji] = useState(currentUser.statusEmoji);
  const [text, setText] = useState(currentUser.statusText);
  const save = async (clear = false) => {
    const r = await api.patch('/api/users/me', clear ? { statusEmoji: '', statusText: '', statusExpires: null } : { statusEmoji: emoji, statusText: text });
    useSession.getState().setMe(r.user);
    onClose();
  };
  return (
    <Modal title="Set a status" onClose={onClose} footer={<>
      <button className="btn" onClick={() => save(true)}>Clear</button>
      <button className="btn btn-primary" onClick={() => save()}>Save</button>
    </>}>
      <div className="row gap">
        <input className="input" style={{ width: 64 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🙂" aria-label="Status emoji" />
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="What’s your status?" aria-label="Status text" />
      </div>
    </Modal>
  );
}
