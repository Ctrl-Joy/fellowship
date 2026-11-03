import { useEffect, useRef } from 'react';

export interface EmojiPickerProps {
  onPick(emoji: string): void;
  onClose(): void;
}

const QUICK = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '✅', '🔥', '😮', '😢', '🚀', '💯'];

/** Emoji picker popover (positioned by its parent). Core stub — owned by `reactions`. */
export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Pick an emoji">
      {QUICK.map((e) => (
        <button key={e} type="button" onClick={() => { onPick(e); onClose(); }}>{e}</button>
      ))}
    </div>
  );
}
