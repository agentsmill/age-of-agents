import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/security/origin.js';

describe('isAllowedOrigin', () => {
  it('allows missing origin (non-browser callers, same-origin GET)', () => {
    expect(isAllowedOrigin(undefined, 8123)).toBe(true);
    expect(isAllowedOrigin('', 8123)).toBe(true);
  });
  it('allows loopback on the server port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:8123', 8123)).toBe(true);
    expect(isAllowedOrigin('http://localhost:8123', 8123)).toBe(true);
  });
  it('allows the dev Vite ports', () => {
    expect(isAllowedOrigin('http://localhost:5173', 8123)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4173', 8123)).toBe(true);
  });
  it('rejects foreign origins and ports', () => {
    expect(isAllowedOrigin('https://evil.com', 8123)).toBe(false);
    expect(isAllowedOrigin('http://localhost:9999', 8123)).toBe(false);
    expect(isAllowedOrigin('http://evil.localhost.example', 8123)).toBe(false);
    expect(isAllowedOrigin('null', 8123)).toBe(false);
  });
});
