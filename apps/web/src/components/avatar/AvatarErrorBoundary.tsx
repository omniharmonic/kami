"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { fallback: ReactNode; onError?: (error: unknown, info: ErrorInfo) => void; children: ReactNode };
type State = { failed: boolean };

/** A runtime throw inside the Rive tree must never take the page down: show the SVG. */
export class AvatarErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
