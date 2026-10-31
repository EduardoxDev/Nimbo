const WELCOME_OPENED_KEY = "nimbo-welcome-opened";
const WELCOME_DONE_KEY = "nimbo-welcome-done";

function read(key: string) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true;
  }
}

function write(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
}

export function welcomeOpeningDue() {
  return !read(WELCOME_OPENED_KEY);
}

export function markWelcomeOpened() {
  write(WELCOME_OPENED_KEY);
}

export function welcomePending() {
  return !read(WELCOME_DONE_KEY);
}

export function finishWelcome() {
  write(WELCOME_DONE_KEY);
}
