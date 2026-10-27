'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const N8N_WEBHOOK_URL = 'https://arunpandian1997.app.n8n.cloud/webhook/chat';

function BotIcon({ size = 20, color = 'white' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="10" width="18" height="11" rx="3" />
            <circle cx="8.5" cy="15.5" r="1.5" fill={color} />
            <circle cx="15.5" cy="15.5" r="1.5" fill={color} />
            <path d="M12 2v4" />
            <circle cx="12" cy="2" r="1" fill={color} />
            <path d="M10 18.5h4" />
            <path d="M1 15h2" />
            <path d="M21 15h2" />
        </svg>
    );
}

function AlertIcon({ size = 16, color = '#dc2626' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    );
}

export default function ChatWidget() {
    const pathname = usePathname();
    const [mounted, setMounted] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: "Welcome to **DISC Futura**! I am your behavioral assessment guide. I can answer questions about the DISC personality model, explain your results, or help you navigate the platform. How can I assist you today?",
        },
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [sessionId, setSessionId] = useState('');
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        setMounted(true);
        setSessionId(`session_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    }, []);

    useEffect(() => {
        if (mounted) {
            scrollToBottom();
        }
    }, [messages, isTyping, mounted]);

    useEffect(() => {
        if (mounted && isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen, mounted]);

    // Never render on server or during assessment
    if (!mounted || pathname?.startsWith('/assessment')) {
        return null;
    }

    const sendMessage = async (text) => {
        if (!text.trim()) return;

        const userMessage = { role: 'user', content: text };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsTyping(true);

        const userName  = (typeof window !== 'undefined' && localStorage.getItem('disc_user_name')) || 'User';
        const userEmail = (typeof window !== 'undefined' && localStorage.getItem('disc_user_email')) || '';
        const userPhone = (typeof window !== 'undefined' && localStorage.getItem('disc_user_phone')) || '';
        const userId    = (typeof window !== 'undefined' && localStorage.getItem('disc_user_id')) || '';

        // Helper to attempt fetch with retry for transient n8n LLM rate limits
        const postWithRetry = async (retries = 2) => {
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    const turnSessionId = `turn_${userId || 'guest'}_${Date.now()}`;
                    const response = await fetch(N8N_WEBHOOK_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'sendMessage',
                            message: text,
                            chatInput: text,
                            sessionId: turnSessionId,
                            user: {
                                id: userId,
                                name: userName,
                                email: userEmail,
                                phone: userPhone,
                            },
                        }),
                    });

                    if (response.ok) {
                        return response;
                    }

                    if (attempt < retries) {
                        await new Promise(res => setTimeout(res, 1500));
                        continue;
                    }

                    const errText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errText}`);
                } catch (err) {
                    if (attempt < retries) {
                        await new Promise(res => setTimeout(res, 1500));
                    } else {
                        throw err;
                    }
                }
            }
        };

        try {
            const response = await postWithRetry();
            const rawText = await response.text();
            let reply = rawText;
            try {
                const data = JSON.parse(rawText);
                reply =
                    data?.output ||
                    data?.message ||
                    data?.text ||
                    data?.response ||
                    (Array.isArray(data) && (data[0]?.output || data[0]?.message)) ||
                    rawText;
            } catch {
                // n8n returns plain text / markdown directly
                reply = rawText;
            }

            setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [
                ...prev,
                {
                    role: 'assistant',
                    content: 'I am having trouble connecting right now. Please try again in a moment.',
                },
            ]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    const formatMessage = (text) => {
        if (!text) return '';
        return text
            .replace(/### (.*?)\n/g, '<h4 style="font-weight:700;margin:6px 0 2px;color:#065f46;">$1</h4>')
            .replace(/## (.*?)\n/g, '<h3 style="font-weight:700;margin:8px 0 4px;color:#065f46;">$1</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^- (.*)/gm, '<div style="margin-left:8px;display:flex;gap:6px;"><span style="color:#059669">•</span><span>$1</span></div>')
            .replace(/\n\n/g, '<div style="height:6px"></div>')
            .replace(/\n/g, '<br/>');
    };

    const quickPrompts = [
        'What is DISC?',
        'What does a high D mean?',
        'How does the assessment work?',
        'What is D/I profile?',
    ];

    return (
        <>
            {/* Chat Window */}
            <div
                className={`fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-24px)] transition-all duration-300 ease-in-out ${
                    isOpen
                        ? 'opacity-100 translate-y-0 pointer-events-auto'
                        : 'opacity-0 translate-y-6 pointer-events-none'
                }`}
            >
                <div
                    style={{
                        background: 'rgba(255,255,255,0.97)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '24px',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(16,185,129,0.15)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        height: '520px',
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            background: 'linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%)',
                            padding: '16px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div
                                style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    background: 'rgba(255,255,255,0.2)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '20px',
                                    border: '2px solid rgba(255,255,255,0.3)',
                                }}
                            >
                                <BotIcon size={22} color="white" />
                            </div>
                            <div>
                                <div style={{ color: 'white', fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>
                                    DISC AI
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <div
                                        style={{
                                            width: '7px',
                                            height: '7px',
                                            borderRadius: '50%',
                                            background: '#4ade80',
                                            animation: 'pulse 2s infinite',
                                        }}
                                    />
                                    <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>
                                        Online · DISC Futura
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{
                                background: 'rgba(255,255,255,0.15)',
                                border: 'none',
                                borderRadius: '50%',
                                width: '32px',
                                height: '32px',
                                cursor: 'pointer',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '18px',
                                transition: 'background 0.2s',
                            }}
                            onMouseEnter={e => (e.target.style.background = 'rgba(255,255,255,0.25)')}
                            onMouseLeave={e => (e.target.style.background = 'rgba(255,255,255,0.15)')}
                        >
                            ×
                        </button>
                    </div>

                    {/* Messages */}
                    <div
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            scrollbarWidth: 'thin',
                            scrollbarColor: '#d1fae5 transparent',
                        }}
                    >
                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                style={{
                                    display: 'flex',
                                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                    gap: '8px',
                                    alignItems: 'flex-end',
                                }}
                            >
                                {msg.role === 'assistant' && (
                                    <div
                                        style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #065f46, #059669)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '14px',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <BotIcon size={16} color="white" />
                                    </div>
                                )}
                                <div
                                    style={{
                                        maxWidth: '78%',
                                        padding: '10px 14px',
                                        borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                                        background: msg.role === 'user'
                                            ? 'linear-gradient(135deg, #065f46, #059669)'
                                            : '#f0fdf4',
                                        color: msg.role === 'user' ? 'white' : '#1a2e1a',
                                        fontSize: '13.5px',
                                        lineHeight: '1.55',
                                        border: msg.role === 'assistant' ? '1px solid #d1fae5' : 'none',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
                                    }}
                                    dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                                />
                            </div>
                        ))}

                        {/* Typing indicator */}
                        {isTyping && (
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                                <div
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #065f46, #059669)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '14px',
                                    }}
                                >
                                    <BotIcon size={16} color="white" />
                                </div>
                                <div
                                    style={{
                                        padding: '12px 16px',
                                        borderRadius: '18px 18px 18px 4px',
                                        background: '#f0fdf4',
                                        border: '1px solid #d1fae5',
                                        display: 'flex',
                                        gap: '4px',
                                        alignItems: 'center',
                                    }}
                                >
                                    {[0, 1, 2].map(i => (
                                        <div
                                            key={i}
                                            style={{
                                                width: '7px',
                                                height: '7px',
                                                borderRadius: '50%',
                                                background: '#059669',
                                                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quick prompts — show only at start */}
                        {messages.length === 1 && !isTyping && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                                {quickPrompts.map((prompt, i) => (
                                    <button
                                        key={i}
                                        onClick={() => sendMessage(prompt)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '20px',
                                            border: '1px solid #a7f3d0',
                                            background: 'white',
                                            color: '#065f46',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            fontWeight: 500,
                                        }}
                                        onMouseEnter={e => {
                                            e.target.style.background = '#ecfdf5';
                                            e.target.style.borderColor = '#059669';
                                        }}
                                        onMouseLeave={e => {
                                            e.target.style.background = 'white';
                                            e.target.style.borderColor = '#a7f3d0';
                                        }}
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div
                        style={{
                            padding: '12px 16px',
                            borderTop: '1px solid #d1fae5',
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'flex-end',
                            background: 'white',
                        }}
                    >
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about DISC..."
                            rows={1}
                            style={{
                                flex: 1,
                                border: '1.5px solid #d1fae5',
                                borderRadius: '14px',
                                padding: '10px 14px',
                                fontSize: '13.5px',
                                outline: 'none',
                                resize: 'none',
                                fontFamily: 'inherit',
                                lineHeight: '1.4',
                                color: '#1a2e1a',
                                background: '#f0fdf4',
                                transition: 'border-color 0.2s',
                                maxHeight: '80px',
                                overflowY: 'auto',
                            }}
                            onFocus={e => (e.target.style.borderColor = '#059669')}
                            onBlur={e => (e.target.style.borderColor = '#d1fae5')}
                            disabled={isTyping}
                        />
                        <button
                            onClick={() => sendMessage(input)}
                            disabled={!input.trim() || isTyping}
                            style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: input.trim() && !isTyping
                                    ? 'linear-gradient(135deg, #065f46, #059669)'
                                    : '#e5e7eb',
                                border: 'none',
                                cursor: input.trim() && !isTyping ? 'pointer' : 'not-allowed',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s',
                                flexShrink: 0,
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                                    stroke={input.trim() && !isTyping ? 'white' : '#9ca3af'}
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(prev => !prev)}
                style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    zIndex: 50,
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    background: isOpen
                        ? 'linear-gradient(135deg, #374151, #111827)'
                        : 'linear-gradient(135deg, #065f46, #059669)',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 30px rgba(5,150,105,0.4), 0 4px 12px rgba(0,0,0,0.15)',
                    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    transform: isOpen ? 'scale(0.95)' : 'scale(1)',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
                onMouseLeave={e => (e.currentTarget.style.transform = isOpen ? 'scale(0.95)' : 'scale(1)')}
                title="Chat with DISC AI"
            >
                <div style={{ transition: 'all 0.3s', transform: isOpen ? 'rotate(0deg)' : 'rotate(0deg)' }}>
                    {isOpen ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <path d="M18 6L6 18M6 6L18 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.1)" />
                        </svg>
                    )}
                </div>
            </button>

            {/* Pulse ring on button */}
            {!isOpen && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: '24px',
                        right: '24px',
                        zIndex: 49,
                        width: '60px',
                        height: '60px',
                        borderRadius: '50%',
                        border: '2px solid rgba(5,150,105,0.4)',
                        animation: 'chatPulse 2.5s ease-out infinite',
                        pointerEvents: 'none',
                    }}
                />
            )}

            <style>{`
                @keyframes bounce {
                    0%, 60%, 100% { transform: translateY(0); }
                    30% { transform: translateY(-6px); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                @keyframes chatPulse {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(1.8); opacity: 0; }
                }
            `}</style>
        </>
    );
}
