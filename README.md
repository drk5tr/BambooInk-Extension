# BambooInk

A Chrome extension that provides real-time grammar, punctuation, and tone checking for customer support agents. Built for teams using Gmail, Slack, and Salesforce. Powered by GPT-4.1 mini.

## How It Works

After a configurable pause (default 1 second) in typing, BambooInk sends the full text to GPT-4.1 mini for grammar, spelling, punctuation, and tone checking. Before the text leaves the extension, all PII is scrubbed and replaced with safe placeholders. The AI response is parsed, PII is restored, and issues are displayed in a floating panel anchored to the active text field.

Each issue shows the original text, the suggested fix, and a plain-English explanation. Agents can Accept (auto-replaces the text) or Dismiss each suggestion.

## Features

- **Real-time inline UI** -- Shadow DOM isolated overlay that works inside Gmail compose, Slack message boxes, and Salesforce case editors without style conflicts
- **Channel-aware checking** -- Automatically detects Gmail (email), Slack (chat), and Salesforce (email or internal note) and adjusts checking strictness. Chat mode is lenient with contractions and fragments; internal notes skip tone checking entirely.
- **PII scrubbing** -- Before any text reaches the OpenAI API, sensitive data (SSNs, credit cards, bank accounts, phone numbers, emails, EINs, dates of birth, routing numbers) is replaced with safe placeholders. Original values are restored in the response before display. PII never leaves the extension.
- **CKEditor and iframe support** -- Detects and attaches to editors inside iframes and shadow DOM trees, with a polling fallback for edge cases
- **Proper noun and acronym handling** -- The AI is instructed to skip capitalized proper nouns, URLs, email addresses, and a curated list of HR/payroll acronyms (PTO, FMLA, W-2, COBRA, etc.)
- **Response caching** -- AI responses are cached in-memory with a 5-minute TTL to avoid redundant API calls
- **Dismiss list** -- Dismissed suggestions are tracked per session and passed to subsequent AI calls to prevent re-flagging

## Installation

### Prerequisites

- Node.js and npm
- An OpenAI API key with access to `gpt-4.1-mini`

### Build

```bash
# Install dependencies
npm install

# Development build (watch mode, source maps)
npm run dev

# Production build (minified)
npm run build
```

Both commands output to the `dist/` directory.

### Load in Chrome

1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

### Configure

Open the extension's **Options** page to:
- Enter your OpenAI API key
- Toggle checking on or off
- Adjust the AI idle delay (how long to wait after typing stops before sending to the API)

## Supported Sites

- Gmail (`mail.google.com`)
- Slack (`*.slack.com`)
- Salesforce (`*.salesforce.com`, `*.force.com`, `*.salesforceliveagent.com`)

## Architecture

```
src/
  background/
    service-worker.ts     # Message router for all chrome.runtime handlers
    ai-grammar.ts         # OpenAI integration, caching, change gate
    pii-scrubber.ts       # Regex PII detection and placeholder substitution

  content/
    content-script.ts     # Entry point: wires observers to message sends
    shadow-hook.ts        # Injects main-world script for shadow DOM access
    observer.ts           # Input, focus, mutation, and iframe polling observers
    overlay.ts            # Shadow DOM container for the floating UI
    injector.ts           # Text field detection, extraction, and replacement
    ui/
      floating-icon.ts    # Bamboo icon with issue count badge
      suggestions-panel.ts # Issue cards with Accept/Dismiss actions
      styles.ts           # Shadow DOM stylesheet

  popup/
    popup.tsx             # React: on/off toggle and settings link

  options/
    options.tsx           # React: all user-facing settings

  shared/
    types.ts              # TypeScript interfaces for issues, settings, messages
    constants.ts          # Default settings and brand colors
    storage.ts            # chrome.storage.sync wrapper
```

### Data Flow

```
User types in Gmail/Slack/Salesforce
  |
  observer.ts -- detects input, starts idle timer
  |
  content-script.ts -- sends "check-grammar-ai" message to service worker
  |
  service-worker.ts -> pii-scrubber.ts -> ai-grammar.ts -> OpenAI API
  |
  Response parsed, PII restored, issues returned with positions
  |
  overlay.ts -- renders issues in floating panel
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Master on/off toggle |
| `aiGrammar` | `true` | AI-powered grammar and tone checking |
| `openaiApiKey` | `""` | OpenAI API key (entered by user) |
| `aiIdleMs` | `1000` | Milliseconds of idle time before AI check fires |
| `maxTextLength` | `5000` | Maximum text length to check |

## Tech Stack

- TypeScript 5.5 (strict mode, ES2020 target)
- React 18 (popup and options pages)
- Webpack 5
- Tailwind CSS 3 + PostCSS
- Chrome Manifest V3
- OpenAI GPT-4.1 mini

## Privacy

Text is sent to the OpenAI API for grammar checking, but all PII is scrubbed before transmission. The API key is stored in `chrome.storage.sync` and never leaves the browser except in API request headers. No data is collected or sent to any other service.

## License

All rights reserved.
