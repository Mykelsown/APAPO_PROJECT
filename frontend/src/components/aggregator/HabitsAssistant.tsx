import { useEffect, useRef, useState } from 'react'
import { Button, Card } from '../ui'
import { cx } from '../ui/cx'

interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: string
}

const WELCOME: ChatMessage = {
  id: 'msg-welcome',
  sender: 'assistant',
  text: 'Hello, I am your Apapo Spending Habits Assistant. I continuously monitor your multi-bank accounts, cash flow, and velocity patterns. Ask me anything about where your money goes or select a prompt below.',
  timestamp: 'Just now',
}

const RESET_WELCOME: ChatMessage = {
  ...WELCOME,
  text: 'Hello, I am your Apapo Spending Habits Assistant. Ask me anything about where your money goes across accounts.',
}

const QUICK_PROMPTS = [
  'What is my highest expense?',
  'Which bank is draining fastest?',
  'What are my recurring bills?',
  'Break down food and dining',
  'Weekend vs weekday habits',
]

let messageSeq = 0
const nextId = (prefix: string) => `${prefix}-${++messageSeq}`

interface Props {
  /** Turns a question into an answer using the user's own numbers. */
  answer: (question: string) => string
}

export function HabitsAssistant({ answer }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([WELCOME])
  const [userInput, setUserInput] = useState('')
  const [assistantTyping, setAssistantTyping] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [chatMessages, assistantTyping])

  function handleSendMessage(queryText?: string) {
    const text = (queryText || userInput).trim()
    if (!text) return

    setChatMessages((prev) => [...prev, { id: nextId('usr'), sender: 'user', text, timestamp: 'Just now' }])
    setUserInput('')
    setAssistantTyping(true)

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { id: nextId('ast'), sender: 'assistant', text: answer(text), timestamp: 'Just now' },
      ])
      setAssistantTyping(false)
    }, 600)
  }

  return (
    <Card className="flex flex-col h-[560px] p-0 overflow-hidden border-slate-200 dark:border-slate-800 dark:bg-slate-900">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 p-4 text-slate-900 dark:text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400 font-bold">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.502 49.188 49.188 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Spending Habits Assistant</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Multi-bank financial chat intelligence</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setChatMessages([RESET_WELCOME])}
          className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          title="Restart chat"
        >
          Reset
        </button>
      </div>

      {/* Quick Prompt Chips */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar p-2 bg-slate-100/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800">
        {QUICK_PROMPTS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => handleSendMessage(chip)}
            className="shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {chatMessages.map((msg) => (
          <div key={msg.id} className={cx('flex flex-col', msg.sender === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={cx(
                'max-w-[85%] rounded-2xl p-3 leading-relaxed',
                msg.sender === 'user'
                  ? 'bg-teal-700 text-white rounded-br-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs border border-slate-200 dark:border-slate-700',
              )}
            >
              {msg.text}
            </div>
            <span className="mt-1 px-1 text-[9px] text-slate-500 dark:text-slate-400 font-medium">
              {msg.sender === 'user' ? 'You' : 'Apapo Assistant'} · {msg.timestamp}
            </span>
          </div>
        ))}

        {assistantTyping && (
          <div className="flex items-center gap-2 rounded-2xl bg-slate-100 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 w-fit">
            <span className="size-2 rounded-full bg-teal-600" />
            <span>Analyzing multi-rail ledger...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Chat Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSendMessage()
        }}
        className="flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 p-2.5 bg-white dark:bg-slate-900"
      >
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Ask about spending habits, merchants, or velocity..."
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-teal-600"
        />
        <Button
          type="submit"
          disabled={!userInput.trim() || assistantTyping}
          className="h-8 px-3.5 text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white shrink-0"
        >
          Send
        </Button>
      </form>
    </Card>
  )
}
