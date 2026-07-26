/**
 * Proof that .tsx tests run at all.
 *
 * Five component test files sat in src/__tests__ for months without ever
 * executing: the vitest `include` pattern matched only `*.test.ts`. They read
 * as coverage on every file listing and were worth exactly nothing — worse
 * than absent, because absent is visible.
 *
 * Turning the glob on revealed the second half of the problem: `environment`
 * was 'node', so React Testing Library failed inside user-event with an error
 * naming an internal symbol and saying nothing about the cause.
 *
 * This file is the smallest thing that proves both are fixed — the glob picks
 * up .tsx, and a DOM exists when it does. If someone tightens the include
 * pattern or drops the jsdom mapping again, this goes red immediately rather
 * than silently taking the component tests with it.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('the .tsx test path', () => {
  it('executes at all', () => {
    expect(true).toBe(true);
  });

  it('has a DOM', () => {
    expect(typeof document).toBe('object');
    expect(document.body).toBeTruthy();
  });

  it('can render a component and query it', () => {
    render(<Greeting name="world" />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });
});
