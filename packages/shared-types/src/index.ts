// Contracts shared by tutor-web and tutor-functions.

/** Where the Cloud Functions run: Mumbai, close to the students. The web app must call the same region. */
export const FUNCTIONS_REGION = 'asia-south1';

export * from './profile.js';
export * from './syllabus.js';
export * from './board.js';
export * from './lesson.js';
