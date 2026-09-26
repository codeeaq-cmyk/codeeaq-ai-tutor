# Codeeaq AI Tutor — Phase 1 MVP

## Getting Started

Requirements: Node.js 22+ (`nvm use` reads `.nvmrc`) and Docker for Postgres/Redis.

```bash
nvm use
npm install            # also builds packages/shared-types
cp .env.example .env   # fill in keys as features need them
npm run db:up          # Postgres + pgvector and Redis; applies database/migrations on first start
npm run dev:api        # NestJS API on http://localhost:4000 (health: /api/health)
npm run dev:web        # Next.js tutor screen on http://localhost:3000
```

Other scripts: `npm test` (API unit tests), `npm run test:e2e -w tutor-api`, `npm run build`.

| Path | Contents |
|---|---|
| `apps/tutor-web` | Next.js tutor screen: character, SVG whiteboard, conversation |
| `apps/tutor-api` | NestJS API: tutor orchestrator (stubbed), whiteboard action validation |
| `packages/shared-types` | Tutor response contract, whiteboard actions, teaching states/strategies |
| `database/migrations` | Phase 1 schema and fractions seed data |

The tutor orchestrator currently returns a scripted response for the fractions demo. Gemini, RAG, auth and progress come in the milestones below.

## 1. Purpose

Build the first working version of **Ceeq**, a conversational AI tutor that can:

- Talk with a learner using voice
- Listen to learner questions and answers
- Teach from a defined curriculum/knowledge base
- Explain concepts conversationally
- Ask questions and evaluate answers
- Draw explanations on an interactive whiteboard
- Maintain basic student learning progress
- Adapt the next interaction based on the learner's recent answers

### Core product principle

> **Ceeq should not just give answers. Ceeq should teach and check whether the learner understood.**

Phase 1 is an MVP. It should prove the complete teaching loop before adding advanced camera/vision, parent dashboards, school administration, or complex adaptive-learning algorithms.

---

# 2. Phase 1 Scope

## Included

1. Ceeq character
2. Voice conversation
3. Curriculum knowledge / RAG
4. AI explanation
5. Question and answer
6. Interactive whiteboard drawing
7. Student progress
8. Basic teaching-state management
9. Session history
10. Basic authentication

## Explicitly NOT included in Phase 1

- Continuous camera monitoring
- Emotion detection
- Facial-expression analysis
- Handwriting recognition
- Parent dashboard
- Teacher dashboard
- School administration
- Payments/subscriptions
- Full mobile application
- Multi-school SaaS administration
- Automated grading of arbitrary homework
- AI-generated video lessons
- Fine-tuning an LLM
- Training a custom foundation model

These can be Phase 2+ features.

---

# 3. Recommended MVP Subject

Do not start with all subjects.

### Recommended pilot

**Grade 6–8 Mathematics**

### First demonstration topic

**Fractions**

The first complete end-to-end demo should support:

```text
Student:
"I don't understand fractions."

        ↓

Ceeq talks

        ↓

Ceeq explains

        ↓

Ceeq draws a visual example

        ↓

Ceeq asks a question

        ↓

Student answers

        ↓

Ceeq evaluates the answer

        ↓

If incorrect:
    Explain differently

If correct:
    Increase difficulty

        ↓

Update student progress
```

Once this loop works reliably, add additional topics.

---

# 4. Product Experience

## 4.1 Main Tutor Screen

```text
┌─────────────────────────────────────────────┐
│                                             │
│                  CEEQ                       │
│               AI TUTOR                      │
│                                             │
│          [ Animated Character ]             │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│             DIGITAL WHITEBOARD              │
│                                             │
│          [ drawings / diagrams ]            │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│ Ceeq: "What is one fourth?"                 │
│                                             │
│              🎤 Speak                        │
│                                             │
└─────────────────────────────────────────────┘
```

The character and whiteboard should be separate UI components.

---

# 5. High-Level Architecture

```text
                        STUDENT
                           │
                 Camera / Mic / Browser
                           │
                           ▼
                ┌─────────────────────┐
                │     Next.js App     │
                │                     │
                │  Ceeq Character     │
                │  Conversation UI    │
                │  Whiteboard         │
                │  Progress UI        │
                └──────────┬──────────┘
                           │
                    WebSocket / API
                           │
                           ▼
                ┌─────────────────────┐
                │   Tutor Backend     │
                │      NestJS         │
                │                     │
                │ Tutor Orchestrator  │
                │ Session Manager     │
                │ Assessment Engine   │
                │ Drawing Controller  │
                │ Progress Service    │
                │ Knowledge Service   │
                └──────────┬──────────┘
                           │
            ┌──────────────┼───────────────┐
            │              │               │
            ▼              ▼               ▼
       PostgreSQL       Redis          Knowledge
       + pgvector                        Base
            │                              │
            └──────────────┬───────────────┘
                           │
                           ▼
                     Gemini / LLM
                           │
                  Voice / AI Response
```

---

# 6. Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS or project-specific SCSS
- Web Audio APIs
- WebSocket/WebRTC as appropriate
- SVG/Canvas for whiteboard

## Character

Recommended Phase 1:

- Rive OR Live2D

Character states:

```text
idle
listening
thinking
talking
happy
encouraging
celebrating
```

The LLM should return a character state, for example:

```json
{
  "characterState": "talking"
}
```

The frontend controls the actual animation.

---

## Backend

- NestJS
- TypeScript
- REST APIs
- WebSocket for real-time tutor events

Keep the first release as a modular monolith.

Do NOT create many microservices in Phase 1.

Suggested modules:

```text
auth
students
tutor
sessions
assessment
knowledge
whiteboard
progress
curriculum
```

---

## Database

### PostgreSQL

Use PostgreSQL for:

- users
- students
- curriculum
- topics
- lessons
- tutor sessions
- messages
- questions
- answers
- assessments
- progress

### pgvector

Use pgvector for curriculum embeddings/RAG.

---

## Cache

Redis:

- session state
- short-lived conversation state
- rate limiting
- temporary tutor state

---

## File Storage

Use S3-compatible storage or Firebase Storage for:

- curriculum documents
- PDFs
- images
- future student uploads

---

## Authentication

Firebase Authentication initially.

Support:

- Email/password
- Google login if required later

For child accounts, design authentication and consent flows carefully before production deployment.

---

# 7. Repository Structure

Recommended monorepo:

```text
codeeaq-ai-tutor/
│
├── apps/
│   │
│   ├── tutor-web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── character/
│   │   │   ├── voice/
│   │   │   ├── whiteboard/
│   │   │   ├── tutor/
│   │   │   └── progress/
│   │   └── public/
│   │
│   └── tutor-api/
│       └── src/
│           ├── auth/
│           ├── students/
│           ├── tutor/
│           ├── sessions/
│           ├── assessment/
│           ├── knowledge/
│           ├── curriculum/
│           ├── whiteboard/
│           └── progress/
│
├── packages/
│   ├── shared-types/
│   ├── tutor-engine/
│   ├── whiteboard-engine/
│   └── ui/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── docs/
│
├── .env.example
├── package.json
└── README.md
```

---

# 8. Core Tutor Architecture

Do NOT send every student message directly to Gemini.

Use a **Tutor Orchestrator**.

```text
Student input
     │
     ▼
Tutor Orchestrator
     │
     ├── Identify intent
     ├── Get current lesson
     ├── Get student progress
     ├── Retrieve curriculum
     ├── Determine teaching state
     ├── Call LLM
     ├── Validate response
     ├── Execute drawing actions
     └── Save progress
```

The LLM generates teaching content.

The application controls what actions are allowed.

---

# 9. Tutor State Machine

Phase 1 should use a simple explicit state machine.

```text
START
  │
  ▼
INTRODUCTION
  │
  ▼
EXPLAIN
  │
  ▼
CHECK_UNDERSTANDING
  │
  ├───────────────┐
  │               │
CORRECT        INCORRECT
  │               │
  ▼               ▼
PRACTICE       RE_EXPLAIN
  │               │
  └───────┬───────┘
          ▼
   CHECK_UNDERSTANDING
          │
          ▼
       COMPLETE
```

Possible states:

```text
INTRODUCTION
EXPLAINING
ASKING
LISTENING
ASSESSING
RE_EXPLAINING
PRACTICING
COMPLETED
```

---

# 10. Teaching Strategies

Create controlled strategies rather than relying only on a system prompt.

```text
EXPLAIN
SIMPLIFY
EXAMPLE
ANALOGY
VISUALIZE
DEMONSTRATE
GUIDED_QUESTION
PRACTICE
RECAP
INCREASE_DIFFICULTY
```

Example:

```text
Student does not understand
        ↓
SIMPLIFY
        ↓
Still incorrect
        ↓
VISUALIZE
        ↓
Still incorrect
        ↓
EXAMPLE
        ↓
Correct
        ↓
PRACTICE
```

---

# 11. LLM Response Contract

The LLM should return structured JSON.

Example:

```json
{
  "message": {
    "text": "Let's look at fractions using a pizza."
  },
  "teachingStrategy": "VISUALIZE",
  "characterState": "talking",
  "assessmentRequired": true,
  "whiteboardActions": [
    {
      "type": "draw_circle",
      "id": "pizza",
      "x": 400,
      "y": 250,
      "radius": 120
    },
    {
      "type": "divide_circle",
      "targetId": "pizza",
      "parts": 4
    }
  ],
  "nextExpectedInput": "student_answer"
}
```

Never allow arbitrary JavaScript/code from the LLM.

Only support predefined whiteboard actions.

---

# 12. Whiteboard Engine

The whiteboard should be an application-controlled drawing surface.

## Supported Phase 1 actions

```text
clear
draw_circle
draw_rectangle
draw_line
draw_arrow
draw_text
draw_number
draw_fraction
draw_grid
highlight
erase
```

Example:

```json
{
  "type": "draw_fraction",
  "numerator": 1,
  "denominator": 4,
  "x": 400,
  "y": 250,
  "size": 200
}
```

Frontend executes the action.

The LLM does NOT directly manipulate the DOM.

---

# 13. Curriculum Knowledge

Phase 1 should use a controlled curriculum.

Example:

```text
Curriculum
└── Grade 7
    └── Mathematics
        └── Fractions
            ├── Lesson 1
            ├── Lesson 2
            ├── Lesson 3
            └── Practice
```

Each knowledge chunk should contain metadata:

```text
curriculum
grade
subject
chapter
topic
lesson
difficulty
source
page
language
```

---

# 14. RAG Pipeline

```text
PDF / DOC / Curriculum
        │
        ▼
Text extraction
        │
        ▼
Chunking
        │
        ▼
Metadata
        │
        ▼
Embeddings
        │
        ▼
PostgreSQL + pgvector
        │
        ▼
Student question
        │
        ▼
Semantic search
        │
        ▼
Relevant curriculum chunks
        │
        ▼
Gemini
        │
        ▼
Tutor response
```

The tutor should prioritize curriculum material over generic model knowledge.

---

# 15. Voice Conversation

## MVP flow

```text
Student speaks
      ↓
Voice input
      ↓
Speech recognition / realtime voice model
      ↓
Tutor Orchestrator
      ↓
Gemini
      ↓
Tutor response
      ↓
Text + speech
      ↓
Ceeq talking animation
```

The system should support interruption:

```text
Ceeq speaking
      ↓
Student starts speaking
      ↓
Stop/interrupt Ceeq
      ↓
Listen to student
```

This is important for making Ceeq feel like a real tutor rather than a voice chatbot.

---

# 16. Character Controller

Character animation should be driven by events.

```text
LISTENING
    ↓
THINKING
    ↓
TALKING
    ↓
WAITING_FOR_ANSWER
    ↓
CELEBRATING
```

Example event:

```json
{
  "type": "CHARACTER_STATE",
  "state": "encouraging"
}
```

Character animation remains a frontend responsibility.

---

# 17. Student Progress

Phase 1 does not need sophisticated educational science.

Track:

```text
student
lesson
topic
attempts
correct_answers
incorrect_answers
questions
time_spent
last_activity
current_state
```

Example:

```json
{
  "studentId": "123",
  "topic": "fractions",
  "attempts": 10,
  "correct": 7,
  "incorrect": 3,
  "mastery": 0.7,
  "lastStrategy": "VISUALIZE",
  "commonMistakes": [
    "numerator_denominator_confusion"
  ]
}
```

`mastery` should be treated as an internal estimate, not a definitive psychological or educational measurement.

---

# 18. Database Model

## users

```text
id
email
role
created_at
```

## students

```text
id
user_id
display_name
grade
curriculum_id
created_at
```

## curricula

```text
id
name
board
country
language
version
```

## subjects

```text
id
curriculum_id
name
```

## topics

```text
id
subject_id
name
parent_topic_id
```

## lessons

```text
id
topic_id
title
content
difficulty
```

## sessions

```text
id
student_id
lesson_id
started_at
ended_at
```

## messages

```text
id
session_id
role
content
strategy
created_at
```

## questions

```text
id
lesson_id
question
answer
difficulty
```

## answers

```text
id
session_id
question_id
student_answer
is_correct
created_at
```

## progress

```text
id
student_id
topic_id
attempts
correct
incorrect
mastery
last_strategy
updated_at
```

---

# 19. API Specification

## Authentication

```text
POST /api/auth/session
```

## Student

```text
GET /api/students/:id
GET /api/students/:id/progress
```

## Curriculum

```text
GET /api/curriculum
GET /api/curriculum/:id
GET /api/topics/:id
GET /api/lessons/:id
```

## Tutor

```text
POST /api/tutor/session
POST /api/tutor/message
POST /api/tutor/answer
POST /api/tutor/complete
```

## Progress

```text
GET  /api/progress/:studentId
POST /api/progress/update
```

## Knowledge

```text
POST /api/knowledge/documents
POST /api/knowledge/index
POST /api/knowledge/search
```

---

# 20. Example Tutor Request

```http
POST /api/tutor/message
```

```json
{
  "sessionId": "session_123",
  "studentId": "student_001",
  "message": "I don't understand fractions",
  "lessonId": "fractions_01"
}
```

---

# 21. Example Tutor Response

```json
{
  "message": {
    "text": "That's okay. Let's understand fractions using a pizza."
  },
  "voice": {
    "enabled": true
  },
  "character": {
    "state": "talking"
  },
  "teaching": {
    "strategy": "VISUALIZE",
    "state": "EXPLAINING"
  },
  "whiteboard": {
    "actions": [
      {
        "type": "draw_fraction",
        "numerator": 1,
        "denominator": 4
      }
    ]
  },
  "assessment": {
    "required": true
  }
}
```

---

# 22. Environment Variables

Create `.env.example`:

```env
# Application
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
API_URL=http://localhost:4000

# Database
DATABASE_URL=

# Redis
REDIS_URL=

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Gemini
GEMINI_API_KEY=

# Storage
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=

# Security
JWT_SECRET=
```

Never commit real keys.

---

# 23. Security Requirements

Minimum Phase 1:

- HTTPS
- Authentication
- Authorization
- API rate limiting
- Input validation
- Server-side API key protection
- Database encryption at rest where available
- Secure session handling
- No LLM API keys in frontend
- No arbitrary code execution from LLM output
- Audit logging for tutor actions

Because the product is intended for children, privacy and child-safety requirements must be considered from the beginning.

Do not collect camera/video data unless the feature genuinely requires it.

---

# 24. Observability

Track:

```text
AI response latency
voice latency
LLM latency
RAG latency
database latency
whiteboard rendering errors
failed sessions
API errors
token usage
cost per session
```

Use:

- Sentry
- CloudWatch
- structured backend logs

Every tutor session should have a trace/session ID.

---

# 25. Performance Targets

Initial targets:

| Metric | Target |
|---|---:|
| Web app initial load | < 3 sec |
| API normal response | < 500 ms excluding LLM |
| Curriculum search | < 300 ms |
| Whiteboard action | < 100 ms |
| Tutor response start | < 2 sec target |
| Voice interruption | < 500 ms target |
| UI animation | 60 FPS target |

Voice response should be streamed rather than waiting for the entire answer.

---

# 26. Development Milestones

## Milestone 1 — Application shell

- [ ] Next.js project
- [ ] NestJS project
- [ ] PostgreSQL
- [ ] Firebase authentication
- [ ] Basic student login
- [ ] Tutor screen

### Deliverable

Student can log in and open the tutor.

---

## Milestone 2 — Ceeq character

- [ ] Select/create Ceeq character
- [ ] Integrate Rive/Live2D
- [ ] Idle animation
- [ ] Listening animation
- [ ] Thinking animation
- [ ] Talking animation
- [ ] Encouraging animation
- [ ] Celebration animation

### Deliverable

Ceeq appears and reacts to tutor events.

---

## Milestone 3 — Voice

- [ ] Microphone permission
- [ ] Voice input
- [ ] Speech recognition/realtime AI
- [ ] AI voice response
- [ ] Ceeq lip/talking animation
- [ ] Interrupt Ceeq while speaking

### Deliverable

Student can have a natural voice conversation with Ceeq.

---

## Milestone 4 — Curriculum

- [ ] Curriculum database
- [ ] Lesson structure
- [ ] Upload curriculum documents
- [ ] Text extraction
- [ ] Chunking
- [ ] Embeddings
- [ ] pgvector
- [ ] Semantic search
- [ ] RAG prompt

### Deliverable

Ceeq can answer questions using the selected curriculum.

---

## Milestone 5 — Teaching Engine

- [ ] Tutor Orchestrator
- [ ] Teaching states
- [ ] Teaching strategies
- [ ] Question generation
- [ ] Answer evaluation
- [ ] Re-explanation
- [ ] Difficulty adjustment

### Deliverable

Ceeq behaves like a tutor instead of a generic chatbot.

---

## Milestone 6 — Whiteboard

- [ ] Canvas/SVG
- [ ] Drawing API
- [ ] Basic shapes
- [ ] Text
- [ ] Arrows
- [ ] Number line
- [ ] Fractions
- [ ] Clear/erase
- [ ] LLM action schema

### Deliverable

Ceeq can explain a concept visually.

---

## Milestone 7 — Student Progress

- [ ] Session tracking
- [ ] Questions
- [ ] Answers
- [ ] Correct/incorrect tracking
- [ ] Topic progress
- [ ] Basic mastery estimate
- [ ] Learning history

### Deliverable

Ceeq remembers what the student has practiced and uses recent progress in the next session.

---

# 27. End-to-End Acceptance Test

The MVP is considered successful when this exact scenario works:

### Student

> "Ceeq, I don't understand fractions."

### Ceeq

Speaks:

> "That's okay. Let me show you."

### Whiteboard

Ceeq draws a circle divided into four equal parts.

### Ceeq

> "If we take one of these four pieces, what fraction do we have?"

### Student

> "One third."

### Ceeq

Does NOT simply say "wrong."

It responds:

> "You're close. Let's count the pieces together."

### Whiteboard

Highlights the four pieces.

### Ceeq

> "How many equal pieces are there?"

### Student

> "Four."

### Ceeq

> "Right. And how many did we take?"

### Student

> "One."

### Ceeq

> "Exactly. So we have one out of four — one fourth."

### Progress

```text
Fractions
Attempts: 2
Correct: 1
Previous mistake:
  denominator confusion

Next strategy:
  visual + guided question
```

This is the **minimum proof that Ceeq is actually tutoring**.

---

# 28. Phase 1 Definition of Done

Phase 1 is complete when:

- [ ] Student can authenticate
- [ ] Student can select a lesson
- [ ] Ceeq character is visible
- [ ] Ceeq can speak
- [ ] Student can speak
- [ ] Student can interrupt Ceeq
- [ ] Ceeq retrieves curriculum information
- [ ] Ceeq explains a concept
- [ ] Ceeq asks questions
- [ ] Student answers verbally
- [ ] AI evaluates the answer
- [ ] Ceeq can re-explain an incorrect answer
- [ ] Ceeq can choose a different teaching strategy
- [ ] Ceeq can draw on the whiteboard
- [ ] Whiteboard actions are controlled by the application
- [ ] Student progress is saved
- [ ] A subsequent session can retrieve recent progress
- [ ] Complete fractions demo works end-to-end
- [ ] Basic latency and cost metrics are recorded

---

# 29. Phase 1 Success Criteria

The primary question is NOT:

> "Can Gemini answer the student's question?"

It should be:

> **"Can Ceeq take a learner who does not understand a concept and guide them toward understanding?"**

Measure:

```text
Question asked
        ↓
Explanation
        ↓
Student attempt
        ↓
Assessment
        ↓
Adaptation
        ↓
New attempt
        ↓
Improvement
```

The MVP should demonstrate this loop reliably.

---

# 30. Phase 2 Candidates

After Phase 1 is stable:

- Camera/vision
- Handwritten homework recognition
- More sophisticated learner modelling
- Adaptive curriculum
- Multiple subjects
- Multiple curricula
- Parent dashboard
- Teacher dashboard
- School dashboard
- Mobile app
- Multilingual tutoring
- Advanced analytics
- Personalized learning paths
- Gamification

---

# 31. Product Positioning

Working product description:

> **Ceeq is an AI tutor that doesn't just give students answers. It talks with them, explains concepts, draws them out visually, asks questions, learns from their responses, and changes the way it teaches when they don't understand.**

Core message:

> **Don't just ask AI. Learn with AI.**

Alternative:

> **AI that teaches until you understand.**

---

# 32. Recommended First Build Order

Do NOT start with the complete infrastructure.

Build vertically:

```text
1. Next.js tutor screen
        ↓
2. Ceeq character
        ↓
3. Voice conversation
        ↓
4. Gemini integration
        ↓
5. One fractions lesson
        ↓
6. Whiteboard drawing
        ↓
7. Question/answer
        ↓
8. Assessment
        ↓
9. Progress database
        ↓
10. RAG / curriculum
        ↓
11. Complete end-to-end demo
```

The first technical goal should be:

> **One learner + one lesson + one concept + one successful adaptive teaching loop.**

Once that works, scale the architecture rather than prematurely building the entire platform.
