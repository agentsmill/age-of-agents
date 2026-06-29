/**
 * Desktop notification helper. Uses the browser Notification API to show
 * system-level alerts when the tab is not focused.
 */

/** Request notification permission on first visit. */
export function requestPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** Fire a desktop notification if the tab is hidden and permission is granted. */
export function desktopNotify(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body, tag: title });
    }
  } catch {
    // Safari throws if called from a non-user gesture context; swallow.
  }
}
