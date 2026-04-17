import { createContext, useContext, useState, useCallback, useEffect } from "react";

interface RouterCtx {
  path: string;
  params: Record<string, string>;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterCtx>({ path: "/", params: {}, navigate: () => {} });

export function useRouter() { return useContext(RouterContext); }

// Simple pattern matcher: "/b/:code" -> params
function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(":")) {
      params[patParts[i].slice(1)] = pathParts[i];
    } else if (patParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function Router({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    function onPop() { setPath(window.location.pathname); }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
  }, []);

  // Resolve params for the current path
  const boardParams = matchRoute("/b/:code", path);
  const params = boardParams ?? {};

  return (
    <RouterContext.Provider value={{ path, params, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}
