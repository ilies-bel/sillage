/**
 * Ported from `vendor/anarlog-editor/src/editor-error-boundary.test.tsx`
 * (fastrepl/anarlog, MIT). Upstream's three cases kept; the console spy is gone
 * because the port reports through `onError` instead, and there is one added
 * case asserting that it does.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorErrorBoundary } from "./editor-error-boundary";

const renderOptions = {
  onCaughtError: () => {},
  onRecoverableError: () => {},
} satisfies Parameters<typeof render>[1];

afterEach(() => {
  cleanup();
});

describe("EditorErrorBoundary", () => {
  it("automatically remounts the editor once after a render failure", async () => {
    let renderCount = 0;

    function FlakyEditor() {
      renderCount += 1;
      if (renderCount === 1) {
        throw new Error("first render failed");
      }

      return <div>editor ready</div>;
    }

    render(
      <EditorErrorBoundary>
        <FlakyEditor />
      </EditorErrorBoundary>,
      renderOptions,
    );

    await waitFor(() => {
      expect(screen.getByText("editor ready")).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a manual reload path after repeated render failures", async () => {
    function BrokenEditor(): never {
      throw new Error("render failed");
    }

    render(
      <EditorErrorBoundary>
        <BrokenEditor />
      </EditorErrorBoundary>,
      renderOptions,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("L’éditeur n’a pas pu s’afficher");

    fireEvent.click(
      screen.getByRole("button", { name: "Recharger l’éditeur" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("resets after the editor identity changes", async () => {
    function BrokenEditor(): never {
      throw new Error("render failed");
    }

    const view = render(
      <EditorErrorBoundary resetKey="session-a">
        <BrokenEditor />
      </EditorErrorBoundary>,
      renderOptions,
    );

    await screen.findByRole("alert");

    view.rerender(
      <EditorErrorBoundary resetKey="session-b">
        <div>new editor</div>
      </EditorErrorBoundary>,
    );

    await waitFor(() => {
      expect(screen.getByText("new editor")).toBeTruthy();
    });
  });

  /*
   * Added. Upstream logged to the console; we report, because DEC-27's
   * diagnostics bundle is the only place a crash during someone else's meeting
   * can be read afterwards.
   */
  it("reports the failure rather than logging it into a console nobody read", async () => {
    const onError = vi.fn();

    function BrokenEditor(): never {
      throw new Error("render failed");
    }

    render(
      <EditorErrorBoundary onError={onError}>
        <BrokenEditor />
      </EditorErrorBoundary>,
      renderOptions,
    );

    await screen.findByRole("alert");

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe("render failed");
  });

  /*
   * The sentence the rep reads while their call is still running. It is load
   * bearing (DEC-26) — the capture path does not depend on the renderer, and
   * someone who does not know that will hang up to "fix" it.
   */
  it("tells the rep the recording survived the crash", async () => {
    function BrokenEditor(): never {
      throw new Error("render failed");
    }

    render(
      <EditorErrorBoundary>
        <BrokenEditor />
      </EditorErrorBoundary>,
      renderOptions,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("L’enregistrement continue");
  });
});
