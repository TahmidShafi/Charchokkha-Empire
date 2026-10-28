import { useState, useEffect, useRef } from 'react';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = inputText.trim();
    if (cleanText) {
      onSendMessage(cleanText);
      setInputText('');
    }
  };

  return (
    <div
      className={`room-chat-panel ${isMobileModal ? 'mobile-chat-modal' : ''}`}
      role="region"
      aria-label="Table Chat"
    >
      {/* Header */}
      <div className="chat-header-bar">
        <div className="chat-header-left">
          <span className="chat-header-icon" aria-hidden="true">💬</span>
          <span className="chat-header-title">Table Chat</span>
          <span className="chat-message-count-badge">{messages.length}</span>
        </div>
        {isMobileModal && (
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onCloseMobile}
            aria-label="Close chat"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div className="chat-messages-container" tabIndex={0} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty-hint">
            <span className="chat-empty-icon" aria-hidden="true">💭</span>
            <span>No messages yet. Say hello to the table!</span>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`chat-msg-row ${m.isSystem ? 'msg-system' : 'msg-player'}`}
            >
              {m.isSystem ? (
                <div className="chat-system-bubble">
                  <span className="system-dot" aria-hidden="true">•</span>
                  <span className="system-text">{m.text}</span>
                </div>
              ) : (
                <div className="chat-player-bubble">
                  <span className="chat-sender-name">{m.sender}</span>
                  <span className="chat-bubble-text">{m.text}</span>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          type="text"
          className="chat-text-input"
          placeholder="Say something to table..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          maxLength={120}
          aria-label="Type message"
        />
        <button
          type="submit"
          className="chat-send-submit-btn"
          disabled={!inputText.trim()}
          title="Send message"
          aria-label="Send message"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
