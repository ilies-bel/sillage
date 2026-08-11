/**
 * Ported from `vendor/anarlog-editor/src/editor-error-boundary.tsx`
 * (fastrepl/anarlog, MIT). Recovery behaviour is upstream's, unchanged: remount
 * once automatically, then offer a manual reload and stop.
 *
 * Adapted in three places, all for the same reason — this component is the last
 * thing standing between a ProseMirror crash and a rep who is *in a call*:
 *
 *  1. **The copy is French, and it says the recording is still running.** That
 *     sentence is the whole point (DEC-26): the capture path has no dependency
 *     on the renderer, so an editor that dies loses the notepad and nothing
 *     else. A rep who does not know that will hang up.
 *  2. **`onError` replaces `console.error`.** The app routes it to
 *     `modules/diagnostics`, where DEC-27 can find it later. A crash that only
 *     ever reached a devtools console nobody had open is a crash we never hear
 *     about.
 *  3. **Blume tokens** instead of upstream's `bg-muted`/`text-muted-foreground`.
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

type EditorErrorBoundaryProps = {
  children: ReactNode;
  /** Changing it resets the boundary — pass the meeting id. */
  resetKey?: string;
  /** Where a render failure is reported. The app wires this to diagnostics. */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type EditorErrorBoundaryState = {
  hasError: boolean;
  recoveryAttempts: number;
  recoveryKey: number;
};

/**
 * One. A second automatic remount of a component that just threw twice is a
 * render loop, and a render loop during a meeting is worse than a visible
 * error with a button under it.
 */
const MAX_AUTO_RECOVERY_ATTEMPTS = 1;

export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  constructor(props: EditorErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, recoveryAttempts: 0, recoveryKey: 0 };
  }

  static getDerivedStateFromError(): Partial<EditorErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);

    if (this.state.recoveryAttempts < MAX_AUTO_RECOVERY_ATTEMPTS) {
      this.setState((state) => ({
        hasError: false,
        recoveryAttempts: state.recoveryAttempts + 1,
        recoveryKey: state.recoveryKey + 1,
      }));
    }
  }

  componentDidUpdate(prevProps: EditorErrorBoundaryProps) {
    if (prevProps.resetKey === this.props.resetKey) {
      return;
    }

    this.setState((state) => ({
      hasError: false,
      recoveryAttempts: 0,
      recoveryKey: state.recoveryKey + 1,
    }));
  }

  private retry = () => {
    this.setState((state) => ({
      hasError: false,
      recoveryAttempts: 0,
      recoveryKey: state.recoveryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="border-card bg-card-soft text-body flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>
            L’éditeur n’a pas pu s’afficher. L’enregistrement continue.
          </span>
          <button
            type="button"
            onClick={this.retry}
            className="border-card bg-inner text-body hover:bg-subtle shrink-0 rounded-md border px-2 py-1 text-xs font-medium"
          >
            Recharger l’éditeur
          </button>
        </div>
      );
    }

    return (
      <Fragment key={this.state.recoveryKey}>{this.props.children}</Fragment>
    );
  }
}
