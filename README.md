# Codeeaq AI Tutor — Phase 1 MVP

## Getting Started

Requirements: Node.js 22+ (`nvm use` reads `.nvmrc`), a Gemini API key, and Java 21+ for the local database emulator. No Docker needed yet.

```bash
npm install              # also builds packages/shared-types
cp apps/tutor-functions/.secret.local.example apps/tutor-functions/.secret.local   # then set GEMINI_API_KEY
npm run dev:backend      # Firebase emulators: functions :5001, sign-in :9099, database :8080, UI on http://localhost:4000
npm run dev:web          # Next.js app on http://localhost:3000
```

The project ID `demo-ceeq` (`.firebaserc`) is emulator-only, so no Firebase account is needed to develop. While editing functions, run `npm run watch:functions` alongside the emulators so they reload. For deployed functions, set the key with `npx firebase functions:secrets:set GEMINI_API_KEY`. Models and voice can be overridden in `apps/tutor-functions/.env` (see `.env.example`).

Signing in locally works with any mobile number: the first code used with a number becomes its code. Accounts and progress in the emulators last until they are stopped. If the machine's default Java is older than 21, `dev:backend` uses a newer one it finds (Android Studio ships one) for that run only; set `CEEQ_JAVA_HOME` to choose one.

Other scripts: `npm test` (all three workspaces), `npm run build`.

Going live also needs, once per Firebase project: Authentication with the Email/Password provider switched on and sign-up switched off (Authentication > Settings > User actions > untick "Enable create"); a Firestore database (`asia-south1`); and `npx firebase deploy --only firestore:rules,functions --project prod`. The Phone provider is not used and should stay off, so that no text can ever be sent or billed.

Sign-in is by invitation, with a mobile number and a 6-digit code that the student is given; nothing is sent by text. To add a student, open the Firebase console at Authentication > Users > Add user and enter:

- **Email:** the student's ten-digit mobile number followed by `@ceeq.student`, for example `9876543210@ceeq.student`. It is only the account's name; no email is sent to it. For a number outside India, write `00`, the country code and the number instead, for example `0016505551234@ceeq.student`.
- **Password:** the 6-digit code to give the student.

The same page changes a student's code (reset password), switches a student off (disable account) and removes one. Earlier, Firebase's phone sign-in was tried with numbers registered as test numbers: it allows only ten, and blocking texts to a country blocks that country's test numbers too.

| Path | Contents |
|---|---|
| `apps/tutor-web` | Next.js app: sign-in by number and code, setup (board, class, stream, language), syllabus with revision reminders, chapter page with modules, live lesson and revision lesson with whiteboard, quizzes |
| `apps/tutor-functions` | Cloud Functions `getSyllabus`, `getChapterPlan` (chapter → modules), `getQuiz` (module quiz) and `createVoiceSession` (locked Gemini Live token for a module's lesson or revision). All require a signed-in student |
| `packages/shared-types` | Profile, syllabus, chapter plan, quiz and progress types; weak spots and revision; whiteboard blocks and validator; lesson tools |
| `firestore.rules` | Each student can read and write only their own record and progress |
| `database/migrations` | Future Postgres schema (not used yet) |

The Ceeq logo is one picture, `apps/tutor-web/public/logo-cq.svg`. The page headers, Ceeq herself in a lesson and the browser tab all take it from there (`apps/tutor-web/lib/brand.ts`), so replacing that file changes the logo everywhere. The two PNGs beside it are the same picture drawn for an iPhone's home screen and for browsers that take no SVG icon; draw them again if the logo changes.

### How it works

1. **Sign-in.** A student signs in with their mobile number and the 6-digit code they were given (`apps/tutor-web/lib/account.ts`). Underneath it is Firebase's sign-in by password, with the number as the account's name and the code as its password; students are added in the Firebase console, as described above, and the app never creates accounts. Every page and every Cloud Function requires a signed-in student.
2. **Setup.** The student picks board, class, stream (11–12) and the language Ceeq speaks. Stored with their account.
3. **Syllabus.** `getSyllabus` returns every subject and chapter. Curated syllabi (`apps/tutor-functions/src/syllabus/curated.ts`, currently CBSE Class 10) load instantly. Any other board and class is compiled by Gemini, cached on the server and on the device. The student can also type any subject and chapter.
4. **Modules.** Opening a chapter calls `getChapterPlan`, which splits it into 3–6 modules, each with a few learning goals. The plan is stored with the chapter's progress, so later visits are instant. If planning fails, the chapter is offered as a single lesson.
5. **Lesson.** Opening a module mints a one-use Gemini Live token with the module, its goals, the class and the teaching method locked into the instructions (`apps/tutor-functions/src/voice.ts`). The browser streams audio straight to Gemini: hands-free, interruptible, first sound typically under a second.
   A lesson has three parts. **Explain:** Ceeq opens with what the student will learn and why it matters, then teaches every goal in short spoken paragraphs with the board, building each idea rather than reciting it. The voice model only speaks when prompted, so while she explains the app prompts her to carry on just before each paragraph finishes (`apps/tutor-web/features/lesson/lessonFlow.ts`); the student only listens, and can interrupt with a question or pause at any time. **Practise:** she calls `start_practice`, and from then on the app waits for the student after each question. **Quiz:** she calls `finish_module`.
   The three parts are also buttons. Pressing Explain or Practise takes a running lesson to that part (Ceeq is told, and starts it) or starts a lesson there; pressing Quiz shows the quiz. The student can pause in any part, and going to the quiz of their own accord pauses the lesson too. A paused lesson carries on from the very word it stopped at, however much later: Ceeq's voice is frozen, not dropped, and if the pause outlasts two minutes the connection is closed and the lesson carried over to a new one when the student comes back (`hold`, `release` and `park` in `useCeeqVoice.ts`). What Ceeq says is written out only if the student turns the transcript on.
   The voice model has no speed setting. Ceeq is asked to speak calmly, and her voice is played as it comes, at about 155 words a minute.
   The voice service lets a lesson down in several ways, all measured against the live service, and the browser covers for each (`apps/tutor-web/features/voice/useCeeqVoice.ts`, `turnSpeech.ts`, and `lessonFlow.ts` for what a new connection is told):
   - **A connection does not last.** The service ends every connection after about ten minutes, with some 50 seconds' notice. It ends one after about five minutes if it has been sent no sound, so while the mic is off (muted, blocked, or during the quiz) silence is sent in its place. Now and then it abandons a reply part-way, or goes quiet after a tool call, and answers nothing more on that connection. In each case the lesson is carried over to a new connection with a new token: Ceeq is told where the lesson stands and what she last said, what is queued goes on playing, and she is asked to go on only if something was waiting on her. The student should not notice the join.
   - **A connection does not always open.** The attempt can be refused or left hanging, so opening one is given eight seconds and tried up to three times.
   - **Ceeq repeats herself.** A paragraph is sometimes said twice, or said again after a tool call that came late. The second telling is cut out, between sentences.
   - **A turn comes back empty.** She is asked again.
   - **"Turn complete" is unreliable.** It can come half a minute late or not at all, and her speech arrives several times faster than it is spoken. The lesson is paced by what the student has heard so far.
   A token can open a connection for ten minutes after it is minted (the lesson page fetches one as it opens, and a spare when it connects) and serves one connection only. While the student takes the quiz Ceeq does not listen, so that talk in the room is not taken for an answer. After four minutes without the student (answering the quiz counts as being there) a lesson that is not paused is stopped, and Start takes it up again from the goal it had reached.
6. **Tools, not free rein.** Ceeq acts only through her tools, all validated in the browser before anything changes: `whiteboard` (self-laying-out blocks: text with inline maths, formulas incl. chemistry, lists, tables, graphs, number lines, diagrams, and the three picture blocks described below), `update_progress`, `record_answer`, `start_practice` and `finish_module` (in a revision, `finish_revision` instead of the last two). Tool calls come before speech in a turn: called mid-sentence, they make the model restart what it was saying.
7. **Quiz.** `getQuiz` writes five multiple-choice questions for the module, each marked with the goal it tests. It is requested in the background when the lesson starts, so it is ready when Ceeq calls `finish_module` and the screen switches to it. Answers get instant feedback and an explanation; Ceeq is told the score and reacts.
8. **Revisiting.** From the chapter page any module's lesson or quiz can be reopened as often as the student likes. A quiz can be retaken as is or with new questions (earlier ones are sent along so they are not repeated). Every attempt is kept; a module is passed at 60%.
9. **A drawn board.** The board is drawn in front of the student as Ceeq speaks, the way it is in an explainer video: words are written one after another, pictures pop up, arrows and outlines trace themselves (`apps/tutor-web/features/board/reveal.ts` gives every piece its moment; the `ink-…` classes in `globals.css` do the drawing). Two blocks are laid out by the app so that Ceeq only says what is in them (`Scenes.tsx`): `panels` sets kinds or cases side by side, and `flow` is a flowchart, joining the steps of a process or a cycle with arrows that draw themselves box by box. An emoji may stand in a panel or a step only where it is that very thing (a battery, the sun); emoji standing for parts or ideas misled students and are no longer asked for (the `labelled` block, a thing in the middle with emoji around it, is no longer offered to Ceeq). Photos searched for on the web were tried first and dropped: too often they showed something else.
   - **Notes.** Beside its drawing every goal has a `notes` block: the lines a student would copy into a notebook. Ceeq sends it again in each explaining turn with one more line, and only the new line is written (`BoardState.kept`).
   - **One goal, one board.** When Ceeq reports that she has started on another goal (`update_progress` with status `learning`), the board is wiped of everything that was on it before that turn (`startTopic` in `packages/shared-types/src/board.ts`), so each goal is taught on a clean board. The module ends on a "Key points" card that sums it up.
   - **Formulas inside a figure.** The words in a diagram, on a graph's axes and on a number line are set by SVG, which cannot set a formula. Maths written there between `$…$` is shown in the plain characters closest to it, x² for `x^2` (`apps/tutor-web/features/board/plain.ts`). Everywhere else on the board it is set by KaTeX.
   - **Prepared pictures.** Real things (a leaf and its parts, the stomata, the digestive system) are shown as pictures drawn for the module and checked before any student sees them (`apps/tutor-functions/src/pictures.ts`). When a module is first opened, `getPictures` has a text model choose the things its students must see, one for each goal that has something to look at, with the textbook's names for their parts; an image model (`GEMINI_IMAGE_MODELS`, Gemini 3 Pro Image first) draws each as a textbook figure; and two other models (`GEMINI_CHECK_MODELS`) each check the drawing against the plan, and both must pass it: every name present and spelled right, each line ending on the right part, nothing wrong or extra. What it finds wrong goes into the next drawing; after three failed drawings a picture is dropped. Pictures that pass are kept in Firestore (`modulePictures`, `pictureImages`, server-only) and every later student of the module gets them at once. When Ceeq starts a goal that has one, the app puts it on the board below the heading and tells her what it shows; she can show any of them by id.
   - **Pictures that build up.** A process (a seed germinating, food passing through the gut) is planned in two to four stages. The complete picture is drawn and checked first; each earlier stage is then made from the one after it by taking away what that stage adds, so the frames match, and each frame is checked. On the board they play one after another like a short animation, with a Play again button; if any frame fails, the complete picture is shown on its own. Flowcharts are not drawn this way: the board draws those itself, so every word in them is exact.
   - **What it costs, and what it needs.** Image models have no free tier: the Gemini key's project must have billing on. Gemini 3 Pro Image costs about /usr/bin/bash.134 a picture (Gemini 3.1 Flash Image, the fallback, /usr/bin/bash.067); a module with three pictures, a build-up and a few redrawings costs well under a dollar, once, for all its students. Without image quota, `getPictures` answers "unavailable", tries again half an hour later, and lessons go on without pictures. On the emulators, `CEEQ_STAND_IN_PICTURES=1` draws plain stand-in cards instead, for trying the flow without an image model.
10. **Progress.** Goals, answers, misconceptions and quiz attempts are saved per module and fed back when the student returns, so Ceeq continues where they left off. The app works from a copy on the device, kept under the student's id, so everything shows at once. Each change is also saved to their account in Firestore (`students/{uid}` and `students/{uid}/chapters/{chapter}`, `apps/tutor-web/lib/sync.ts`); at sign-in the two copies are combined, the later change winning, so progress follows the student to any device.
11. **Weak spots.** A wrong spoken answer, or a missed quiz question, marks the goal it was about as a weak spot, with a note of what went wrong (`packages/shared-types/src/revision.ts`). The home page reminds the student what they have to revise across every subject, and the chapter page marks the modules concerned.
12. **Revision.** "Revise" opens a short lesson on one module's weak spots. Ceeq is given only those goals and what went wrong, explains each again in a different way and checks it with a question; the app waits for the student throughout. A goal the student now gets right is checked once more three days later and comes off the list when that check is passed; a wrong answer at any point puts it back.
13. **The camera.** A lesson needs the student's camera, so that Ceeq can tell whether they are with her; without it Start does not begin the lesson. What the camera shows never leaves the device and nothing is recorded: Google's MediaPipe face detector runs in the browser twice a second (`apps/tutor-web/features/attention/`; its 230 KB model is in `public/models`, its 3.5 MB engine comes from jsDelivr and is cached for a year) and reports only whether a face is facing the screen, has turned well aside, or is not there. Looking down to write notes counts as being there. Out of view for 20 seconds, Ceeq checks in with one kind sentence (while explaining, in place of her next step; in conversation, as soon as she has finished speaking) and the lesson waits for the student. Out of view for a minute, the lesson pauses, and carries on when they are back in view, Ceeq welcoming them back and recapping her last point. Going to another app or tab pauses the lesson at once; coming back carries it on, with a welcome only after 20 seconds or more away. If the camera goes off, the lesson pauses until it is turned back on. Speaking or typing always counts as being there. Only Ceeq is told any of this, in the moment; none of it is stored. The student sees their own picture, ringed green when they are in view and amber when not. The camera is turned off when the lesson ends.

Reminders outside the app (text or push), limits on misuse (App Check, per-student rate limits) and RAG over textbooks come next.

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

## How to teach/explain
- Verbal & Visual
- Whiteboard - draw and explain
- Real-world examples
- Interactive exercise
- Practice question (same question asked in different way)

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

- Recording, storing or sending camera video (the camera is now used during lessons, but only on the student's device and only to tell whether they are in view: see item 13 under how the app works)
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
