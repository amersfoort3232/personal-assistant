import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { ChatMessage } from '../../shared/domain';

export type ChatPanelProps = {
  messages: ChatMessage[];
  busy: boolean;
  onSend(text: string): Promise<void>;
};

export function ChatPanel({ messages, busy, onSend }: ChatPanelProps) {
  const [text, setText] = useState('');
  const mounted = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy || submitting.current) return;

    submitting.current = true;
    try {
      await onSend(message);
      if (mounted.current) setText('');
    } catch {
      // App renders the bridge's structured public error. Keep the draft for retry.
    } finally {
      submitting.current = false;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <section className="chat-panel" aria-labelledby="conversation-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Conversation</p>
          <h2 id="conversation-title">Describe your day</h2>
        </div>
      </div>

      {messages.length > 0 ? (
        <ol className="message-list" aria-label="Conversation messages">
          {messages.map((message) => (
            <li
              aria-label={`${message.role === 'user' ? 'User' : 'Assistant'} message`}
              className={`message message-${message.role}`}
              key={message.id}
            >
              <span className="message-role" aria-hidden="true">
                {message.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">
          Add goals, deadlines, and rough durations. You can correct the interpretation afterwards.
        </p>
      )}

      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="daily-goals">Daily goals and tasks</label>
        <textarea
          aria-describedby="composer-help"
          id="daily-goals"
          maxLength={5000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to get done?"
          rows={4}
          value={text}
        />
        <div className="composer-footer">
          <p className="field-note" id="composer-help">Enter to send · Shift+Enter for a new line</p>
          <button
            className="button button-primary"
            disabled={busy || text.trim().length === 0}
            type="submit"
          >
            Send
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="true" className="status-message" role="status">
        {busy ? 'DeepSeek is working…' : ''}
      </div>
    </section>
  );
}
