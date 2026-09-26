import type { TutorMessageRequest, TutorResponse } from "@codeeaq/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function startSession(studentId: string, lessonId: string) {
  return post<{ sessionId: string }>("/tutor/session", { studentId, lessonId });
}

export function sendMessage(request: TutorMessageRequest) {
  return post<TutorResponse>("/tutor/message", request);
}
