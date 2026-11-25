import {
  useCallback,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

/**
 * The client-side router (ADR-0003): a minimal History-API router — no
 * dependency, no server. `routes.ts` owns the route table; this module owns
 * the two DOM concerns: reading the current location, and turning plain
 * left-clicks on <Link> anchors into history.pushState navigations so the
 * URL bar, the back/forward buttons, and direct navigation all behave like
 * a multi-page site.
 */

type LocationListener = () => void;

const locationListeners = new Set<LocationListener>();

function notifyLocationChanged(): void {
  for (const listener of locationListeners) {
    listener();
  }
}

/**
 * Navigates client-side: pushes a history entry, scrolls to the top, and
 * notifies subscribed components. Navigating to the current URL is a no-op
 * (no duplicate history entries).
 */
export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) {
    return;
  }
  window.history.pushState({}, "", to);
  window.scrollTo(0, 0);
  notifyLocationChanged();
}

/** The current pathname, kept in sync with the History API (popstate). */
export function useLocation(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    function update(): void {
      setPathname(window.location.pathname);
    }
    locationListeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      locationListeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  return pathname;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  children: ReactNode;
}

/**
 * An anchor to a route in this app. It renders a real <a href> — middle
 * clicks, modifier clicks, and "copy link address" all behave natively —
 * and plain left-clicks become client-side navigation.
 */
export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigate(to);
    },
    [to, onClick],
  );

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
