import { useState } from 'react';

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  isSystem?: boolean;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onCloseMobile?: () => void;
  isMobileModal?: boolean;
}

export function ChatPanel({
  messages,
  onSendMessage,
  onCloseMobile,
  isMobileModal,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  return (
    <div className={`room-chat-panel ${isMobileModal ? 'mobile-chat-modal' : ''}`}>
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Chat</span>
        {isMobileModal && (
          <button
            type="button"
            onClick={onCloseMobile}
            style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.25rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty-hint">
            <span>💬</span> No messages yet
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="chat-msg-row">
              {m.isSystem ? (
                <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.75rem' }}>
                  {m.text}
                </span>
              ) : (
                <>
                  <span className="chat-sender">{m.sender}:</span>
                  <span className="chat-text">{m.text}</span>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          type="text"
          className="chat-input"
          placeholder="Say something..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          maxLength={100}
        />
        <button type="submit" className="chat-send-btn" disabled={!inputText.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
